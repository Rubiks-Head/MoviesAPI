import { EE, type Eng } from "../shared/engine.ts";
import type { Cfg } from "../shared/config.ts";
import { unmint } from "../shared/enrich.ts";
import { vl } from "../shared/vidlink.ts";
import { dash, mstr } from "../shared/hls.ts";
import { cap, vtt } from "../shared/sub.ts";
import { ids } from "./streams.ts";
import { fail, out, pipe, type Route } from "../shared/http.ts";

type H = Parameters<Route["handler"]>;

function tok(params: Record<string, string | undefined>) {
  const t = unmint(params.token!);
  if (!t) throw new EE("not_found", "unknown or expired media token");
  return t;
}

export function files(eng: Eng, cfg: Cfg): Route[] {
  return [
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/v1/video/:token/file.mp4" }),
      async handler(req, res, params, query) {
        try {
          const { id, kind } = tok(params);
          const { imdb, tmdb } = await ids(eng, id, kind);
          const r = await vl(cfg, imdb || tmdb, kind);
          const want = query.get("q");
          const mp4s = r.sources.filter((s) => s.kind === "mp4");
          const pick =
            (want && mp4s.find((s) => s.quality === want)) ||
            mp4s.sort((a, b) => Number(b.quality ?? 0) - Number(a.quality ?? 0))[0];
          if (!pick) {
            return out(res, 404, { error: { code: "not_found", message: "no mp4 source" } });
          }
          await pipe(req, res, pick.url, pick.headers, cfg.egress.allow_private);
        } catch (e) {
          fail(res, e);
        }
      },
    },
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/v1/video/:token/file.m3u8" }),
      async handler(_req, res, params) {
        try {
          const { id, kind } = tok(params);
          const { imdb, tmdb } = await ids(eng, id, kind);
          const nid = imdb || tmdb;
          const d = await dash(cfg, nid);
          res.writeHead(200, {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-cache",
            "Content-Disposition": `attachment; filename="${id}.m3u8"`,
          });
          res.end(mstr(d, nid));
        } catch (e) {
          fail(res, e);
        }
      },
    },
    ...(["vtt", "srt"] as const).map((fmt) => ({
      method: "GET",
      pattern: new URLPattern({ pathname: `/v1/subtitle/:token/file.${fmt}` }),
      async handler(_req: H[0], res: H[1], params: Record<string, string | undefined>, query: URLSearchParams) {
        try {
          const { id, kind } = tok(params);
          const { imdb, tmdb } = await ids(eng, id, kind);
          const r = await vl(cfg, imdb || tmdb, kind);
          if (!r.captions.length) {
            return out(res, 404, {
              error: { code: "not_found", message: "no subtitles for this title" },
            });
          }
          const lang = query.get("lang")?.toLowerCase();
          const idx = Number(query.get("i"));
          const c =
            (lang && r.captions.find((x) => x.lang?.toLowerCase().startsWith(lang))) ||
            (Number.isInteger(idx) && r.captions[idx]) ||
            r.captions[0];
          const srt = await cap(c.url, cfg.egress.allow_private);
          res.writeHead(200, {
            "Content-Type":
              fmt === "vtt" ? "text/vtt; charset=utf-8" : "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="${id}.${fmt}"`,
            "Cache-Control": "public, max-age=3600",
          });
          res.end(fmt === "vtt" ? vtt(srt) : srt);
        } catch (e) {
          fail(res, e);
        }
      },
    })),
  ];
}
