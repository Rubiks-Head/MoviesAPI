import { EE, type Eng } from "../shared/engine.ts";
import type { Cfg } from "../shared/config.ts";
import { vl, type Rsv, type Src } from "../shared/vidlink.ts";
import { vs } from "../shared/vidsrc.ts";
import { mint } from "../shared/enrich.ts";
import { fail, out, pipe, type Route } from "../shared/http.ts";

interface MS {
  tmdb_id?: number;
}

export async function ids(eng: Eng, id: string, kind: string): Promise<{ imdb: string; tmdb: string }> {
  if (/^tt\d+$/.test(id)) {
    const m = (await eng.meta("cinemeta", kind, id)) as MS;
    return { imdb: id, tmdb: m.tmdb_id ? String(m.tmdb_id) : "" };
  }
  if (/^\d+$/.test(id)) return { imdb: "", tmdb: id };
  if (id.startsWith("tmdb:")) return { imdb: "", tmdb: id.slice(5) };
  if (id.startsWith("imdb:")) {
    const imdb = id.slice(5);
    const m = (await eng.meta("cinemeta", kind, imdb)) as MS;
    return { imdb, tmdb: m.tmdb_id ? String(m.tmdb_id) : "" };
  }
  throw new EE("bad_id", "id must be an imdb or tmdb id");
}

async function all(
  eng: Eng,
  cfg: Cfg,
  id: string,
  kind: string,
  season?: string,
  episode?: string,
) {
  const { imdb, tmdb } = await ids(eng, id, kind);
  const errors: Record<string, string> = {};
  let rsv: Rsv | undefined;
  try {
    rsv = await vl(cfg, imdb || tmdb, kind);
  } catch (e) {
    errors.vidlink = e instanceof Error ? e.message : String(e);
  }
  const emb: Src[] = [];
  if (tmdb) {
    const s = await vs(cfg, tmdb, kind, season, episode);
    if (s) emb.push({ provider: "vidsrc", kind: "embed", quality: "player", url: s });
    else errors.vidsrc = "no embed returned";
  }
  return { rsv, emb, errors };
}

export function streams(eng: Eng, cfg: Cfg): Route[] {
  return [
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/v1/streams/:id" }),
      async handler(_req, res, params, query) {
        const kind = query.get("type") === "series" ? "series" : "movie";
        try {
          const { rsv, emb, errors } = await all(
            eng,
            cfg,
            params.id!,
            kind,
            query.get("season") ?? undefined,
            query.get("episode") ?? undefined,
          );
          const sources = [...(rsv?.sources ?? []), ...emb];
          if (!sources.length) {
            return out(res, 404, {
              error: { code: "not_found", message: "no streams found", detail: errors },
            });
          }
          const tok = mint(params.id!, kind);
          out(res, 200, {
            id: params.id,
            type: kind,
            files: {
              mp4: `/v1/video/${tok}/file.mp4`,
              m3u8: `/v1/video/${tok}/file.m3u8`,
              vtt: `/v1/subtitle/${tok}/file.vtt`,
              srt: `/v1/subtitle/${tok}/file.srt`,
            },
            sources,
            captions: rsv?.captions ?? [],
            subtitles: (rsv?.captions ?? []).map((c, i) => ({
              lang: c.lang ?? null,
              url: `/v1/sub/${params.id}?i=${i}&type=${kind}`,
            })),
            ...(Object.keys(errors).length ? { errors } : {}),
          });
        } catch (e) {
          fail(res, e);
        }
      },
    },
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/v1/play/:id" }),
      async handler(_req, res, params, query) {
        const kind = query.get("type") === "series" ? "series" : "movie";
        const want = query.get("q") ?? "best";
        try {
          const { rsv, emb } = await all(
            eng,
            cfg,
            params.id!,
            kind,
            query.get("season") ?? undefined,
            query.get("episode") ?? undefined,
          );
          const sources = [...(rsv?.sources ?? []), ...emb];
          if (!sources.length) {
            return out(res, 404, { error: { code: "not_found", message: "no streams found" } });
          }
          let pick: Src | undefined;
          if (want === "hls") pick = sources.find((s) => s.kind === "hls");
          else if (want !== "best") pick = sources.find((s) => s.quality === want);
          pick ??=
            sources
              .filter((s) => s.kind === "mp4")
              .sort((a, b) => Number(b.quality ?? 0) - Number(a.quality ?? 0))[0] ?? sources[0];
          if (pick.kind === "mp4") {
            await pipe(_req, res, pick.url, pick.headers, cfg.egress.allow_private);
            return;
          }
          if (!/^https?:\/\//.test(pick.url)) {
            return out(res, 502, {
              error: { code: "upstream_error", message: "refusing non-http redirect target" },
            });
          }
          res.writeHead(302, { Location: pick.url });
          res.end();
        } catch (e) {
          fail(res, e);
        }
      },
    },
  ];
}
