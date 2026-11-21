import type { Cfg } from "./config.ts";
import { adv } from "./fu.ts";
import { stash } from "./hls.ts";
import { EE } from "./engine.ts";

export interface Src {
  provider: string;
  kind: "mp4" | "hls" | "dash" | "embed";
  quality?: string;
  url: string;
  proxy_url?: string;
  size?: number;
  codec?: string;
  headers?: Record<string, string>;
}

export interface Cap {
  id: string;
  url: string;
  lang?: string;
}

export interface Rsv {
  id: string;
  sources: Src[];
  captions: Cap[];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function b64(s: string): string {
  return Buffer.from(new TextEncoder().encode(s))
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fp(url: string, headers: Record<string, string> | undefined): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const sid = stash(headers ?? {}, u.origin);
  return `/v1/seg/${sid}/${b64(url)}`;
}

interface VQ {
  type?: string;
  url?: string;
  codecName?: string;
  size?: string;
  headers?: Record<string, string>;
  requiresProxy?: boolean;
}

interface Vl {
  sourceId?: string;
  stream?: {
    id?: string;
    type?: string;
    deliveryType?: string;
    qualities?: Record<string, VQ>;
    playlist?: string;
    playlistHeaders?: Record<string, string>;
    requiresProxy?: boolean;
    alternates?: Record<
      string,
      { type?: string; playlist?: string; headers?: Record<string, string>; requiresProxy?: boolean }
    >;
    captions?: { id?: string; url?: string; language?: string; lang?: string }[];
  };
}

export async function vl(cfg: Cfg, id: string, kind = "movie"): Promise<Rsv> {
  const base = cfg.domains.vidlink.replace(/\/$/, "");
  const tok = await adv(cfg, id);
  const path =
    kind === "series" ? `/api/b/tv/${tok}?multiLang=0` : `/api/b/movie/${tok}?multiLang=0`;
  const r = await fetch(base + path, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "X-Playback-Environment": "hls",
      "User-Agent": UA,
      Accept: "*/*",
      Referer: `${base}/${kind === "series" ? "tv" : "movie"}/${id}`,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  if (!r.ok) throw new EE("upstream_error", `vidlink api: ${r.status}`);
  const body = (await r.json()) as Vl | null;
  const st = body?.stream;
  if (!st) throw new EE("not_found", `no ${kind} stream on vidlink for '${id}'`);

  const out: Rsv = { id, sources: [], captions: [] };
  for (const [q, qual] of Object.entries(st.qualities ?? {})) {
    if (!qual.url || qual.type !== "mp4") continue;
    const s: Src = {
      provider: "vidlink",
      kind: "mp4",
      quality: q,
      url: qual.url,
      ...(qual.size ? { size: Number(qual.size) } : {}),
      ...(qual.codecName ? { codec: qual.codecName } : {}),
      ...(qual.headers && Object.keys(qual.headers).length ? { headers: qual.headers } : {}),
    };
    if (qual.requiresProxy) {
      const p = fp(qual.url, qual.headers);
      if (p) s.proxy_url = p;
    }
    out.sources.push(s);
  }
  if (st.playlist) {
    const k = st.deliveryType === "dash" ? "dash" : "hls";
    const s: Src = {
      provider: "vidlink",
      kind: k,
      quality: "auto",
      url: st.playlist,
      ...(st.playlistHeaders ? { headers: st.playlistHeaders } : {}),
    };
    if (st.requiresProxy) {
      const p = fp(st.playlist, st.playlistHeaders);
      if (p) s.proxy_url = p;
    }
    out.sources.push(s);
  }
  for (const [name, alt] of Object.entries(st.alternates ?? {})) {
    if (!alt.playlist) continue;
    const s: Src = {
      provider: "vidlink",
      kind: alt.type === "dash" ? "dash" : "hls",
      quality: `alt:${name}`,
      url: alt.playlist,
      ...(alt.headers ? { headers: alt.headers } : {}),
    };
    if (alt.requiresProxy) {
      const p = fp(alt.playlist, alt.headers);
      if (p) s.proxy_url = p;
    }
    out.sources.push(s);
  }
  for (const c of st.captions ?? []) {
    if (c.url) out.captions.push({ id: c.id ?? "", url: c.url, lang: c.language ?? c.lang });
  }
  return out;
}
