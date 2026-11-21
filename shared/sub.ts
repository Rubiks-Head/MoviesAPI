import { EE } from "./engine.ts";
import { readBody, safeFetch } from "./egress.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function vtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return "WEBVTT\n\n" + body.trim() + "\n";
}

export async function cap(url: string, allowPrivate = false): Promise<string> {
  const r = await safeFetch(
    url,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) },
    { allowPrivate },
  );
  if (!r.ok) throw new EE("upstream_error", `caption fetch: ${r.status}`);
  const buf = await readBody(r, 5 * 1024 * 1024);
  if (!buf) throw new EE("upstream_error", "caption too large");
  return buf.toString("utf8");
}
