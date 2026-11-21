import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { EE } from "./engine.ts";
import { safeFetch } from "./egress.ts";

export interface Route {
  method: string;
  pattern: URLPattern;
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string | undefined>,
    query: URLSearchParams,
  ) => Promise<void> | void;
}

export function out(res: ServerResponse, status: number, v: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(v));
}

export function bind(a: string): { host?: string; port: number } {
  const m = /^(?:(.*):)?(\d+)$/.exec(a);
  return { host: m?.[1] || undefined, port: Number(m?.[2]) || 9980 };
}

const STALL_MS = 30_000;

export async function pipe(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  headers: Record<string, string> = {},
  allowPrivate = false,
) {
  const range = req.headers.range;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), STALL_MS);
  let r: Response;
  try {
    r = await safeFetch(
      url,
      {
        headers: { ...headers, ...(range ? { Range: range } : {}) },
        signal: ctl.signal,
      },
      { allowPrivate },
    );
  } finally {
    clearTimeout(t);
  }
  if (!r.ok && r.status !== 206) {
    return out(res, 502, { error: { code: "upstream", message: `upstream ${r.status}` } });
  }
  const h: Record<string, string> = {
    "Content-Type": r.headers.get("content-type") ?? "video/mp4",
    "Accept-Ranges": "bytes",
  };
  const cl = r.headers.get("content-length");
  if (cl) h["Content-Length"] = cl;
  const cr = r.headers.get("content-range");
  if (cr) h["Content-Range"] = cr;
  res.writeHead(r.status === 206 ? 206 : 200, h);
  if (!r.body) return res.end();
  const body = Readable.fromWeb(r.body as any);
  let stall = setTimeout(() => ctl.abort(), STALL_MS);
  body.on("data", () => {
    clearTimeout(stall);
    stall = setTimeout(() => ctl.abort(), STALL_MS);
  });
  body.once("error", () => res.destroy());
  body.once("close", () => clearTimeout(stall));
  res.once("close", () => ctl.abort());
  body.pipe(res);
}

const codes: Record<string, number> = {
  missing_query: 400,
  missing_params: 400,
  bad_id: 400,
  bad_url: 400,
  unknown_source: 400,
  not_found: 404,
  gone: 410,
  provider_unconfigured: 503,
  no_providers: 503,
  unsupported: 501,
  upstream_error: 502,
  resolve_failed: 502,
};

export function fail(res: ServerResponse, e: unknown) {
  const code = e instanceof EE ? e.code : (e as { code?: unknown })?.code;
  if (typeof code === "string") {
    const message =
      e instanceof Error ? e.message : ((e as { message?: unknown })?.message ?? code);
    out(res, codes[code] ?? 500, { error: { code, message: String(message) } });
    return;
  }
  console.error(e);
  out(res, 500, { error: { code: "internal", message: "internal error" } });
}
