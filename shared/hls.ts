import { randomBytes } from "node:crypto";
import type { Cfg } from "./config.ts";
import { adv } from "./fu.ts";
import { EE } from "./engine.ts";
import { readBody, safeFetch } from "./egress.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface Sess {
  h: Record<string, string>;
  origin: string;
  exp: number;
}

const hc = new Map<string, Sess>();

export function stash(h: Record<string, string>, origin: string, ttl = 30 * 60 * 1000): string {
  const sid = randomBytes(12).toString("base64url");
  const now = Date.now();
  for (const [k, v] of hc) if (v.exp < now) hc.delete(k);
  while (hc.size >= 500) hc.delete(hc.keys().next().value!);
  hc.set(sid, { h, origin, exp: now + ttl });
  return sid;
}

export function sHdrs(sid: string): Sess | null {
  const e = hc.get(sid);
  if (!e || e.exp < Date.now()) {
    hc.delete(sid);
    return null;
  }
  return e;
}

export function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

export function ub64(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

interface VD {
  stream?: {
    playlist?: string;
    playlistHeaders?: Record<string, string>;
    deliveryType?: string;
    expiresAt?: number;
  };
}

async function dm(cfg: Cfg, id: string) {
  const base = cfg.domains.vidlink.replace(/\/$/, "");
  const tok = await adv(cfg, id);
  const r = await fetch(`${base}/api/b/movie/${tok}?multiLang=0`, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "X-Playback-Environment": "dash-hevc",
      "User-Agent": UA,
      Accept: "*/*",
      Referer: `${base}/movie/${id}`,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  if (!r.ok) throw new EE("upstream_error", `vidlink api: ${r.status}`);
  const body = (await r.json()) as VD | null;
  const pl = body?.stream?.playlist;
  if (!pl) throw new EE("not_found", `no adaptive stream on vidlink for '${id}'`);
  const hdrs = body!.stream!.playlistHeaders ?? {};
  const m = await safeFetch(
    pl,
    {
      headers: { ...hdrs, "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    },
    { allowPrivate: cfg.egress.allow_private },
  );
  if (!m.ok) throw new EE("upstream_error", `mpd fetch: ${m.status}`);
  const raw = await readBody(m, 8 * 1024 * 1024);
  if (!raw) throw new EE("upstream_error", "mpd too large");
  return { mpd: raw.toString(), base: new URL(".", pl).toString(), hdrs };
}

export interface Rep {
  kind: string;
  id: string;
  bandwidth: number;
  width: number;
  height: number;
  codecs: string;
  timescale: number;
  init: string;
  media: string;
  startNumber: number;
  durs: number[];
}

function att(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

const MAX_SEGS = 20_000;

function tl(xml: string): number[] {
  const durs: number[] = [];
  for (const m of xml.matchAll(/<S\b([^>]*)\/>/g)) {
    const a = att(m[1]);
    const d = Number(a.d ?? 0);
    const r = Number(a.r ?? 0);
    for (let i = 0; i <= r && d > 0; i++) {
      if (durs.length >= MAX_SEGS) return durs;
      durs.push(d);
    }
  }
  return durs;
}

function mpd(x: string): Rep[] {
  const reps: Rep[] = [];
  const sets = x.match(/<AdaptationSet\b[\s\S]*?<\/AdaptationSet>/g) ?? [];
  for (const set of sets) {
    const sa = att(set.match(/<AdaptationSet\b[^>]*>/)?.[0] ?? "");
    for (const rm of set.matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/g)) {
      const ra = att(rm[1]);
      const tp = rm[2].match(/<SegmentTemplate\b([^>]*)\/?>([\s\S]*)/);
      if (!tp) continue;
      const ta = att(tp[1]);
      const st = rm[2].match(/<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>/);
      reps.push({
        kind: sa.contentType ?? "",
        id: ra.id ?? String(reps.length),
        bandwidth: Number(ra.bandwidth ?? 0),
        width: Number(ra.width ?? 0),
        height: Number(ra.height ?? 0),
        codecs: ra.codecs ?? "",
        timescale: Number(ta.timescale ?? 1) || 1,
        init: ta.initialization ?? "",
        media: ta.media ?? "",
        startNumber: Number(ta.startNumber ?? 1) || 1,
        durs: st ? tl(st[1]) : [],
      });
    }
  }
  return reps;
}

function sn(tpl: string, rid: string, n: number): string {
  return tpl
    .replaceAll("$RepresentationID$", rid)
    .replace(/\$Number(?:%0(\d+)d)?\$/g, (_m, w) =>
      w ? String(n).padStart(Number(w), "0") : String(n),
    );
}

function su(sid: string, abs: string): string {
  return `/v1/seg/${sid}/${b64(abs)}`;
}

export interface Dash {
  reps: Rep[];
  sid: string;
  base: string;
  pls: Map<string, string>;
}

const DC_MAX = 200;
const dc = new Map<string, { d: Dash; exp: number }>();
const resolving = new Map<string, Promise<Dash>>();

export async function dash(cfg: Cfg, id: string): Promise<Dash> {
  const hit = dc.get(id);
  if (hit) {
    if (hit.exp > Date.now()) return hit.d;
    dc.delete(id);
  }
  let p = resolving.get(id);
  if (!p) {
    p = (async () => {
      const { mpd: xml, base, hdrs } = await dm(cfg, id);
      const reps = mpd(xml);
      if (!reps.length) throw new EE("resolve_failed", "mpd had no representations");
      const d: Dash = {
        reps,
        sid: stash(hdrs, new URL(base).origin),
        base,
        pls: new Map(),
      };
      while (dc.size >= DC_MAX) dc.delete(dc.keys().next().value!);
      dc.set(id, { d, exp: Date.now() + 20 * 60 * 1000 });
      return d;
    })().finally(() => resolving.delete(id));
    resolving.set(id, p);
  }
  return p;
}

export function rep(d: Dash, p: string | null): Rep | undefined {
  if (!p) return undefined;
  const m = /^([av])(\d+)$/.exec(p);
  if (!m) return undefined;
  return d.reps.filter((r) => r.kind === (m[1] === "a" ? "audio" : "video"))[Number(m[2])];
}

export function mstr(d: Dash, id: string): string {
  const vids = d.reps.filter((r) => r.kind === "video");
  const auds = d.reps.filter((r) => r.kind === "audio");
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7"];
  if (auds.length) {
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="audio",DEFAULT=YES,AUTOSELECT=YES,URI="/v1/hls/${id}?rep=a0"`,
    );
  }
  vids.forEach((v, vi) => {
    const parts = [
      `BANDWIDTH=${v.bandwidth || 800000}`,
      v.width && v.height ? `RESOLUTION=${v.width}x${v.height}` : "",
      v.codecs ? `CODECS="${v.codecs},mp4a.40.2"` : "",
      auds.length ? 'AUDIO="a"' : "",
    ].filter(Boolean);
    lines.push(`#EXT-X-STREAM-INF:${parts.join(",")}`, `/v1/hls/${id}?rep=v${vi}`);
  });
  return lines.join("\n") + "\n";
}

const PL_MAX = 8;

export function media(d: Dash, r: Rep): string {
  const pk = `${r.kind}:${r.id}`;
  const hit = d.pls.get(pk);
  if (hit) return hit;
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${Math.ceil(r.durs.reduce((a, b) => Math.max(a, b), 1) / r.timescale)}`,
    `#EXT-X-MEDIA-SEQUENCE:${r.startNumber}`,
    `#EXT-X-MAP:URI="${su(d.sid, d.base + sn(r.init, r.id, r.startNumber))}"`,
  ];
  r.durs.forEach((dur, i) => {
    lines.push(
      `#EXTINF:${(dur / r.timescale).toFixed(3)},`,
      su(d.sid, d.base + sn(r.media, r.id, r.startNumber + i)),
    );
  });
  lines.push("#EXT-X-ENDLIST");
  const out = lines.join("\n") + "\n";
  while (d.pls.size >= PL_MAX) d.pls.delete(d.pls.keys().next().value!);
  d.pls.set(pk, out);
  return out;
}
