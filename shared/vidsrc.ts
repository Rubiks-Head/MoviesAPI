import type { Cfg } from "./config.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function vs(
  cfg: Cfg,
  tmdb: string,
  kind = "movie",
  season?: string,
  episode?: string,
): Promise<string | null> {
  const base = cfg.domains.vidsrc.replace(/\/$/, "");
  let api = `${base}/vs_src.php?type=${kind === "series" ? "tv" : "movie"}&id=${encodeURIComponent(tmdb)}`;
  if (kind === "series" && season && episode) api += `&season=${season}&episode=${episode}`;
  const emb =
    kind === "series"
      ? `${base}/embed/tv?tmdb=${encodeURIComponent(tmdb)}&season=${season ?? "1"}&episode=${episode ?? "1"}`
      : `${base}/embed/movie?tmdb=${encodeURIComponent(tmdb)}`;
  try {
    const r = await fetch(api, {
      headers: { "User-Agent": UA, Referer: emb },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { src?: string };
    return body.src ?? null;
  } catch {
    return null;
  }
}
