import { createHmac, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { RawData } from "ws";

export const runtime = "nodejs";

const DEFAULT_XF_ASR_URL = "wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1";
const SAMPLE_RATE = 16000;
const FRAME_BYTES = 1280;
const FRAME_INTERVAL_MS = 40;

type XfResultMessage = {
  msg_type?: string;
  action?: string;
  code?: string | number;
  desc?: string;
  sid?: string;
  data?: {
    seg_id?: number;
    ls?: boolean;
    desc?: string;
    cn?: {
      st?: {
        type?: string;
        rt?: Array<{
          ws?: Array<{
            cw?: Array<{
              w?: string;
            }>;
          }>;
        }>;
      };
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

    const appId = process.env.XF_APPID;
    const accessKeyId = process.env.XF_API_KEY;
    const accessKeySecret = process.env.XF_API_SECRET;

    if (!appId || !accessKeyId || !accessKeySecret) {
      return NextResponse.json({ error: "讯飞 ASR 环境变量未配置完整" }, { status: 500 });
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const pcmBuffer = stripWavHeader(buffer);
    console.info(`[xfyun-asr] received wav=${buffer.length} bytes pcm=${pcmBuffer.length} bytes`);

    if (pcmBuffer.length < FRAME_BYTES) {
      return NextResponse.json({ error: "录音太短，请至少说 1 秒后再停止识别" }, { status: 400 });
    }

    const transcript = await transcribeWithXfyun({
      appId,
      accessKeyId,
      accessKeySecret,
      pcmBuffer
    });

    return NextResponse.json({ transcript });
  } catch (error) {
    const message = error instanceof Error ? error.message : "语音识别失败";
    console.error("[xfyun-asr] failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function transcribeWithXfyun(params: {
  appId: string;
  accessKeyId: string;
  accessKeySecret: string;
  pcmBuffer: Buffer;
}) {
  process.env.WS_NO_BUFFER_UTIL = "1";
  const { default: WebSocket } = await import("ws");

  return new Promise<string>((resolve, reject) => {
    const sessionId = randomUUID();
    const signedUrl = buildSignedUrl(params);
    console.info(`[xfyun-asr] connecting ${redactSignature(signedUrl)}`);
    const ws = new WebSocket(signedUrl, {
      insecureHTTPParser: true
    });
    const segmentText = new Map<number, string>();
    let mergedText = "";
    let sid: string = sessionId;
    let settled = false;
    let opened = false;
    let sawServerMessage = false;
    let sendTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;

      if (sendTimer) clearTimeout(sendTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }

      if (error) {
        reject(error);
        return;
      }

      const segmentedText = Array.from(segmentText.entries())
        .sort(([left], [right]) => left - right)
        .map(([, item]) => item)
        .join("")
        .trim();
      const text = pickBetterTranscript(segmentedText, mergedText.trim());

      resolve(text);
    };

    timeoutTimer = setTimeout(() => {
      settle(new Error("讯飞语音识别超时，请稍后重试"));
    }, Math.max(20000, params.pcmBuffer.length / 32 + 8000));

    ws.on("open", () => {
      opened = true;
      console.info(`[xfyun-asr] websocket opened, sending ${params.pcmBuffer.length} pcm bytes`);
      let offset = 0;

      const sendNext = () => {
        if (settled || ws.readyState !== WebSocket.OPEN) return;

        if (offset >= params.pcmBuffer.length) {
          ws.send(JSON.stringify({ end: true, sessionId: sid }));
          console.info("[xfyun-asr] sent end frame");
          return;
        }

        const nextOffset = Math.min(offset + FRAME_BYTES, params.pcmBuffer.length);
        ws.send(params.pcmBuffer.subarray(offset, nextOffset), { binary: true }, (error) => {
          if (error) {
            settle(error instanceof Error ? error : new Error("讯飞音频帧发送失败"));
          }
        });
        offset = nextOffset;
        sendTimer = setTimeout(sendNext, FRAME_INTERVAL_MS);
      };

      sendNext();
    });

    ws.on("message", (raw: RawData) => {
      sawServerMessage = true;
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      console.info(`[xfyun-asr] recv ${text.slice(0, 300)}`);
      let message: XfResultMessage;

      try {
        message = JSON.parse(text);
      } catch {
        return;
      }

      if (message.sid) sid = message.sid;

      const code = String(message.code ?? "0");
      if (message.msg_type === "error" || message.action === "error" || (code !== "0" && code !== "")) {
        const reason = message.desc || message.data?.desc || `讯飞 ASR 返回错误码 ${code}`;
        settle(new Error(reason));
        return;
      }

      const extracted = extractTextFromResult(message);
      if (extracted) {
        mergedText = mergeTranscriptText(mergedText, extracted);
        if (typeof message.data?.seg_id === "number") {
          segmentText.set(message.data.seg_id, extracted);
        }
      }

      if (message.data?.ls === true) {
        settle();
      }
    });

    ws.on("error", (error) => {
      settle(error instanceof Error ? error : new Error("讯飞 WebSocket 连接失败"));
    });

    ws.on("unexpected-response", (_request, response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8").slice(0, 800);
        settle(new Error(`讯飞握手失败：HTTP ${response.statusCode} ${response.statusMessage || ""} ${body}`.trim()));
      });
    });

    ws.on("close", (code, reason) => {
      console.info(`[xfyun-asr] websocket closed code=${code} reason=${reason.toString()}`);
      if (!settled) {
        if (!opened || !sawServerMessage) {
          settle(new Error(`讯飞连接关闭但未返回识别结果，关闭码：${code || "unknown"}`));
          return;
        }
        settle();
      }
    });
  });
}

function buildSignedUrl(params: { appId: string; accessKeyId: string; accessKeySecret: string }) {
  const queryParams: Record<string, string> = {
    accessKeyId: params.accessKeyId,
    appId: params.appId,
    audio_encode: "pcm_s16le",
    lang: "autodialect",
    samplerate: String(SAMPLE_RATE),
    utc: formatBeijingTime(),
    uuid: randomUUID().replace(/-/g, "")
  };

  const baseString = Object.entries(queryParams)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  const signature = createHmac("sha1", params.accessKeySecret).update(baseString).digest("base64");
  const search = new URLSearchParams({ ...queryParams, signature });

  const url = process.env.XF_ASR_URL || DEFAULT_XF_ASR_URL;
  return `${url}?${search.toString()}`;
}

function getXfAsrHost() {
  return new URL(process.env.XF_ASR_URL || DEFAULT_XF_ASR_URL).host;
}

function redactSignature(url: string) {
  const parsed = new URL(url);
  if (parsed.searchParams.has("signature")) {
    parsed.searchParams.set("signature", "***");
  }
  return parsed.toString();
}

function formatBeijingTime() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+0800`;
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

function extractTextFromResult(message: XfResultMessage) {
  const words = message.data?.cn?.st?.rt
    ?.flatMap((rt) => rt.ws ?? [])
    .flatMap((ws) => ws.cw ?? [])
    .map((cw) => cw.w ?? "")
    .join("");

  return words?.trim() ?? "";
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

function pickBetterTranscript(left: string, right: string) {
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}
