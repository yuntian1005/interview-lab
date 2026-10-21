import { NextRequest, NextResponse } from "next/server";
import type { RawData } from "ws";
import { buildXfyunSignedUrl, getSparkCredentials, normalizeSparkWsUrl } from "@/lib/xfyunSpark";

export const runtime = "nodejs";

const DEFAULT_SPARK_ASR_URL = "wss://iat.cn-huabei-1.xf-yun.com/v1";
const SAMPLE_RATE = 16000;
const FRAME_BYTES = 1280;
const FRAME_INTERVAL_MS = 40;

type SparkAsrMessage = {
  header?: {
    code?: number;
    message?: string;
    status?: number;
    sid?: string;
  };
  payload?: {
    result?: {
      text?: string;
    };
  };
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio_file");

    if (!(audioFile instanceof File)) {
      return NextResponse.json({ error: "缺少音频文件 audio_file" }, { status: 400 });
    }

    const credentials = getSparkCredentials();
    if (!credentials) {
      return NextResponse.json(
        { error: "星火 ASR 环境变量未配置完整，请配置 SPARK_APPID、SPARK_API_KEY、SPARK_API_SECRET。" },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const pcmBuffer = stripWavHeader(buffer);

    if (pcmBuffer.length < FRAME_BYTES) {
      return NextResponse.json({ error: "录音太短，请至少说 1 秒后再停止识别。" }, { status: 400 });
    }

    const transcript = await transcribeWithSpark({ credentials, pcmBuffer });
    if (!transcript) {
      return NextResponse.json({ error: "没有识别到语音内容，请靠近麦克风后重试。" }, { status: 400 });
    }

    return NextResponse.json({ transcript });
  } catch (error) {
    const message = error instanceof Error ? error.message : "星火语音识别失败";
    console.error("[spark-asr] failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function transcribeWithSpark(params: {
  credentials: NonNullable<ReturnType<typeof getSparkCredentials>>;
  pcmBuffer: Buffer;
}) {
  process.env.WS_NO_BUFFER_UTIL = "1";
  const { default: WebSocket } = await import("ws");
  const url = buildXfyunSignedUrl(
    normalizeSparkWsUrl(process.env.SPARK_ASR_URL, DEFAULT_SPARK_ASR_URL),
    params.credentials
  );

  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(url, { insecureHTTPParser: true });
    const segmentText = new Map<number, string>();
    let mergedText = "";
    let settled = false;
    let sendTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (sendTimer) clearTimeout(sendTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();

      if (error) {
        reject(error);
        return;
      }

      resolve(
        (segmentText.size
          ? Array.from(segmentText.entries())
          .sort(([left], [right]) => left - right)
          .map(([, text]) => text)
              .join("")
          : mergedText
        )
          .trim()
      );
    };

    timeoutTimer = setTimeout(() => settle(new Error("星火语音识别超时，请稍后重试。")), 30000);

    ws.on("open", () => {
      let offset = 0;
      let frameIndex = 0;

      const sendNext = () => {
        if (settled || ws.readyState !== WebSocket.OPEN) return;
        const nextOffset = Math.min(offset + FRAME_BYTES, params.pcmBuffer.length);
        const isFirst = offset === 0;
        const isLast = nextOffset >= params.pcmBuffer.length;
        const frame = params.pcmBuffer.subarray(offset, nextOffset);

        ws.send(
          JSON.stringify({
            header: {
              app_id: params.credentials.appId,
              status: isLast ? 2 : isFirst ? 0 : 1
            },
            parameter: isFirst
              ? {
                  iat: {
                    language: "zh_cn",
                    domain: "slm",
                    accent: "mandarin",
                    eos: 1800,
                    dwa: "wpgs",
                    result: {
                      encoding: "utf8",
                      compress: "raw",
                      format: "json"
                    }
                  }
                }
              : undefined,
            payload: {
              audio: {
                encoding: "raw",
                sample_rate: SAMPLE_RATE,
                channels: 1,
                bit_depth: 16,
                seq: frameIndex,
                status: isLast ? 2 : isFirst ? 0 : 1,
                audio: frame.toString("base64")
              }
            }
          }),
          (error) => {
            if (error) settle(error instanceof Error ? error : new Error("星火音频帧发送失败。"));
          }
        );

        offset = nextOffset;
        frameIndex += 1;
        if (!isLast) sendTimer = setTimeout(sendNext, FRAME_INTERVAL_MS);
      };

      sendNext();
    });

    ws.on("message", (raw: RawData) => {
      let message: SparkAsrMessage;
      try {
        message = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
      } catch {
        return;
      }

      const code = message.header?.code ?? 0;
      if (code !== 0) {
        settle(new Error(message.header?.message || `星火 ASR 返回错误码 ${code}`));
        return;
      }

      const result = decodeAsrResult(message.payload?.result?.text);
      if (result.text) {
        if (typeof result.sn === "number") {
          segmentText.set(result.sn, result.text);
        } else {
          mergedText = mergeTranscriptText(mergedText, result.text);
        }
      }

      if (message.header?.status === 2) settle();
    });

    ws.on("error", (error) => settle(error instanceof Error ? error : new Error("星火 WebSocket 连接失败。")));
    ws.on("close", () => settle());
  });
}

function decodeAsrResult(encoded: string | undefined): { sn?: number; text: string } {
  if (!encoded) return { text: "" };

  try {
    const json = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    const text =
      json.ws
        ?.flatMap((ws: { cw?: Array<{ w?: string }> }) => ws.cw ?? [])
        .map((cw: { w?: string }) => cw.w ?? "")
        .join("")
        .trim() ?? "";
    return { sn: typeof json.sn === "number" ? json.sn : undefined, text };
  } catch {
    return { text: "" };
  }
}

function mergeTranscriptText(current: string, incoming: string) {
  if (!current) return incoming;
  if (!incoming || current.endsWith(incoming)) return current;
  if (incoming.endsWith(current) || incoming.includes(current)) return incoming;

  const maxOverlap = Math.min(current.length, incoming.length);
  for (let length = maxOverlap; length >= 4; length -= 1) {
    if (current.endsWith(incoming.slice(0, length))) {
      return `${current}${incoming.slice(length)}`;
    }
  }

  return `${current}${incoming}`;
}

function stripWavHeader(buffer: Buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    return buffer;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "data") {
      return buffer.subarray(chunkStart, chunkStart + chunkSize);
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  return buffer.subarray(44);
}
