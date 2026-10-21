import { createHmac } from "crypto";
import { isDemoMode } from "@/lib/runtimeMode";

export type SparkCredentials = {
  appId: string;
  apiKey: string;
  apiSecret: string;
};

export function getSparkCredentials(): SparkCredentials | null {
  if (isDemoMode()) return null;
  const appId = process.env.SPARK_APPID || process.env.XF_APPID;
  const apiKey = process.env.SPARK_API_KEY || process.env.XF_API_KEY;
  const apiSecret = process.env.SPARK_API_SECRET || process.env.XF_API_SECRET;

  if (!appId || !apiKey || !apiSecret) return null;
  return { appId, apiKey, apiSecret };
}

export function buildXfyunSignedUrl(rawUrl: string, credentials: SparkCredentials): string {
  const parsed = new URL(rawUrl);
  const date = new Date().toUTCString();
  const signatureOrigin = [`host: ${parsed.host}`, `date: ${date}`, `GET ${parsed.pathname} HTTP/1.1`].join("\n");
  const signatureSha = createHmac("sha256", credentials.apiSecret).update(signatureOrigin).digest("base64");
  const authorizationOrigin =
    `api_key="${credentials.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");

  parsed.searchParams.set("authorization", authorization);
  parsed.searchParams.set("date", date);
  parsed.searchParams.set("host", parsed.host);

  return parsed.toString();
}

export function normalizeSparkWsUrl(url: string | undefined, fallback: string): string {
  return (url || fallback).trim();
}

