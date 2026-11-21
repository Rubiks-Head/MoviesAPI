import type { Eng } from "../shared/engine.ts";
import type { Cfg } from "../shared/config.ts";
import { vl } from "../shared/vidlink.ts";
import { cap, vtt } from "../shared/sub.ts";
import { ids } from "./streams.ts";
import { fail, out, type Route } from "../shared/http.ts";

export function sub(eng: Eng, cfg: Cfg): Route {
  return {
    method: "GET",
    pattern: new URLPattern({ pathname: "/v1/sub/:id" }),
    async handler(_req, res, params, query) {
      const kind = query.get("type") === "series" ? "series" : "movie";
      try {
        const { imdb, tmdb } = await ids(eng, params.id!, kind);
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
        const fmt = query.get("fmt") === "srt" ? "srt" : "vtt";
        res.writeHead(200, {
          "Content-Type": fmt === "vtt" ? "text/vtt; charset=utf-8" : "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${params.id}.${fmt}"`,
          "Cache-Control": "public, max-age=3600",
        });
        res.end(fmt === "vtt" ? vtt(srt) : srt);
      } catch (e) {
        fail(res, e);
      }
    },
  };
}
