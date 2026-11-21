import { randomBytes } from "node:crypto";

const TTL = 6 * 3600_000;
const tokens = new Map<string, { id: string; kind: string; exp: number }>();

export function mint(id: string, kind = "movie"): string {
  const t = randomBytes(8).toString("hex");
  if (tokens.size >= 5000) tokens.delete(tokens.keys().next().value!);
  tokens.set(t, { id, kind, exp: Date.now() + TTL });
  return t;
}

export function unmint(t: string) {
  const v = tokens.get(t);
  if (!v) return undefined;
  if (v.exp < Date.now()) {
    tokens.delete(t);
    return undefined;
  }
  tokens.delete(t);
  tokens.set(t, v);
  return v;
}

export function img(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return `/v1/img/${Buffer.from(raw).toString("base64url")}`;
}

export interface RT {
  id: string;
  source: string;
  type?: string;
  name: string;
  year?: string;
  poster?: string;
  imdb_rating?: string;
  description?: string;
}

export function vT(t: RT) {
  const kind = t.type === "series" ? "series" : "movie";
  const tok = mint(t.id, kind);
  return {
    id: t.id,
    source: t.source,
    type: kind,
    name: t.name,
    year: t.year ?? null,
    rating: t.imdb_rating ?? null,
    description: t.description ?? null,
    banner: img(t.poster),
    poster: img(t.poster),
    video_url: `/v1/video/${tok}/file.mp4`,
    hls_url: `/v1/video/${tok}/file.m3u8`,
    subtitle_url: `/v1/subtitle/${tok}/file.vtt`,
    meta_url: `/v1/meta/${kind}/${t.id}`,
    streams_url: `/v1/streams/${t.id}?type=${kind}`,
  };
}

export interface RM extends RT {
  tmdb_id?: number;
  released?: string;
  runtime?: string;
  genres?: string[];
  cast?: string[];
  directors?: string[];
  writers?: string[];
  country?: string;
  awards?: string;
  background?: string;
  logo?: string;
  trailers?: unknown[];
  videos?: unknown[];
}

export function vM(m: RM) {
  return {
    ...vT(m),
    tmdb_id: m.tmdb_id ?? null,
    released: m.released ?? null,
    runtime: m.runtime ?? null,
    genres: m.genres ?? [],
    cast: m.cast ?? [],
    directors: m.directors ?? [],
    writers: m.writers ?? [],
    country: m.country ?? null,
    awards: m.awards ?? null,
    banner: img(m.background ?? m.poster),
    logo: img(m.logo),
    trailers: m.trailers ?? [],
    videos: m.videos ?? [],
  };
}
