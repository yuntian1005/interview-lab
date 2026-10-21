import { NextRequest, NextResponse } from "next/server";
import type { RawData } from "ws";
import { buildXfyunSignedUrl, getSparkCredentials, normalizeSparkWsUrl } from "@/lib/xfyunSpark";

export const runtime = "nodejs";

const DEFAULT_SPARK_TTS_URL = "wss://cbm01.cn-huabei-1.xf-yun.com/v1/private/mcd9m97e6";

type SparkTtsMessage = {
  header?: {
    code?: number;
    message?: string;
    status?: number;
  };
  payload?: {
    audio?: {
      audio?: string;
      status?: number;
    };
  };
};

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();
    const content = String(text ?? "").trim();

    if (!content) {
      return NextResponse.json({ error: "缺少需要播报的文本。" }, { status: 400 });
    }

    const credentials = getSparkCredentials();
    if (!credentials) {
      return NextResponse.json(
        { error: "星火 TTS 环境变量未配置完整，请配置 SPARK_APPID、SPARK_API_KEY、SPARK_API_SECRET。" },
        { status: 500 }
      );
    }

    const audio = await synthesizeWithSparkTts({ credentials, text: content.slice(0, 900) });
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "星火语音合成失败";
    console.error("[spark-tts] failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function synthesizeWithSparkTts(params: {
  credentials: NonNullable<ReturnType<typeof getSparkCredentials>>;
  text: string;
}) {
  process.env.WS_NO_BUFFER_UTIL = "1";
  const { default: WebSocket } = await import("ws");
  const url = buildXfyunSignedUrl(
    normalizeSparkWsUrl(process.env.SPARK_TTS_URL, DEFAULT_SPARK_TTS_URL),
    params.credentials
  );

  return new Promise<Buffer>((resolve, reject) => {
    const ws = new WebSocket(url, { insecureHTTPParser: true });
    const chunks: Buffer[] = [];
    let settled = false;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();

      if (error) {
        reject(error);
        return;
      }

      resolve(Buffer.concat(chunks));
    };

    timeoutTimer = setTimeout(() => settle(new Error("星火语音合成超时，请稍后重试。")), 30000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          header: {
            app_id: params.credentials.appId,
            status: 2
          },
          parameter: {
            oral: {
              spark_assist: 1,
              oral_level: "mid"
            },
            tts: {
              vcn: process.env.SPARK_TTS_VOICE || "x5_lingxiaoxuan_flow",
              speed: Number(process.env.SPARK_TTS_SPEED || 50),
              volume: Number(process.env.SPARK_TTS_VOLUME || 50),
              pitch: Number(process.env.SPARK_TTS_PITCH || 50),
              bgs: 0,
              reg: 0,
              rdn: 0,
              audio: {
                encoding: "lame",
                sample_rate: 16000,
                channels: 1,
                bit_depth: 16,
                frame_size: 0
              }
            }
          },
          payload: {
            text: {
              encoding: "utf8",
              compress: "raw",
              format: "plain",
              status: 2,
              text: Buffer.from(params.text, "utf8").toString("base64")
            }
          }
        })
      );
    });

    ws.on("message", (raw: RawData) => {
      let message: SparkTtsMessage;
      try {
        message = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
      } catch {
        return;
      }

      const code = message.header?.code ?? 0;
      if (code !== 0) {
        settle(new Error(message.header?.message || `星火 TTS 返回错误码 ${code}`));
        return;
      }

      const audio = message.payload?.audio?.audio;
      if (audio) chunks.push(Buffer.from(audio, "base64"));

      if (message.header?.status === 2 || message.payload?.audio?.status === 2) {
        settle();
      }
    });

    ws.on("error", (error) => settle(error instanceof Error ? error : new Error("星火 TTS WebSocket 连接失败。")));
    ws.on("close", () => settle());
  });
}
