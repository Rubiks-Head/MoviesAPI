import type { Eng } from "../shared/engine.ts";
import type { Cfg } from "../shared/config.ts";
import { dash, mstr, media, rep, sHdrs, ub64 } from "../shared/hls.ts";
import { ids } from "./streams.ts";
import { fail, out, pipe, type Route } from "../shared/http.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type Res = Parameters<Route["handler"]>[1];

function send(res: Res, body: string) {
  res.writeHead(200, {
    "Content-Type": "application/vnd.apple.mpegurl",
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

export function hls(eng: Eng, cfg: Cfg): Route[] {
  return [
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/v1/hls/:id" }),
      async handler(_req, res, params, query) {
        try {
          const { imdb, tmdb } = await ids(eng, params.id!, "movie");
          const nid = imdb || tmdb;
          const d = await dash(cfg, nid);
          const r = rep(d, query.get("rep"));
          send(res, r ? media(d, r) : mstr(d, nid));
        } catch (e) {
          fail(res, e);
        }
      },
    },
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/v1/seg/:sid/:u" }),
      async handler(req, res, params) {
        const sess = sHdrs(params.sid!);
        if (!sess) {
          return out(res, 410, {
            error: { code: "gone", message: "stream session expired, refetch playlist" },
          });
        }
        let u: URL;
        try {
          u = new URL(ub64(params.u!));
          if (u.protocol !== "https:" && u.protocol !== "http:") throw 0;
        } catch {
          return out(res, 400, { error: { code: "bad_url", message: "bad segment url" } });
        }
        if (u.origin !== sess.origin) {
          return out(res, 400, {
            error: { code: "bad_url", message: "segment url off playlist origin" },
          });
        }
        try {
          await pipe(req, res, u.toString(), { ...sess.h, "User-Agent": UA }, cfg.egress.allow_private);
        } catch (e) {
          fail(res, e);
        }
      },
    },
  ];
}
