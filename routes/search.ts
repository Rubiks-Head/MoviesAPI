import type { Eng } from "../shared/engine.ts";
import { vT, vM, type RT, type RM } from "../shared/enrich.ts";
import { fail, out, type Route } from "../shared/http.ts";

interface SB {
  query?: string;
  titles?: RT[];
  errors?: Record<string, string>;
}

function h(eng: Eng, full: boolean): Route["handler"] {
  return async (_req, res, params, query) => {
    const q = query.get("q");
    if (!q) {
      return out(res, 400, {
        error: { code: "missing_query", message: "query parameter 'q' is required" },
      });
    }
    const limit = Math.min(Math.max(Number(query.get("limit")) || 10, 1), 25);
    const pg = Math.min(Math.max(Number(query.get("pg")) || 1, 1), 10);
    const type = query.get("type") ?? "all";
    const source = params?.source ?? query.get("source") ?? "";
    try {
      const body = (await eng.srch(q, type, source, limit, (pg - 1) * limit)) as SB;
      const base = full
        ? "/v1/search/~/"
        : source
          ? `/v1/search/${source}/`
          : "/v1/search/";
      const qs = `q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`;
      const titles = full
        ? await Promise.all(
            (body.titles ?? []).map((t) =>
              eng
                .meta(t.source, t.type === "series" ? "series" : "movie", t.id)
                .then((m) => vM(m as RM))
                .catch(() => vT(t)),
            ),
          )
        : (body.titles ?? []).map(vT);
      out(res, 200, {
        query: body.query ?? q,
        page: pg,
        titles,
        next: pg < 10 && titles.length ? `${base}?${qs}&pg=${pg + 1}` : null,
        ...(body.errors ? { errors: body.errors } : {}),
        powered_by: "powered by Rubik's Head <3, made by Roadsign (road.ts)",
      });
    } catch (e) {
      fail(res, e);
    }
  };
}

export function srch(eng: Eng): Route[] {
  const fn = h(eng, false);
  const full = h(eng, true);
  return [
    { method: "GET", pattern: new URLPattern({ pathname: "/v1/search/~/" }), handler: full },
    { method: "GET", pattern: new URLPattern({ pathname: "/v1/search/~/:source" }), handler: full },
    { method: "GET", pattern: new URLPattern({ pathname: "/v1/search/" }), handler: fn },
    { method: "GET", pattern: new URLPattern({ pathname: "/v1/search/:source" }), handler: fn },
    { method: "GET", pattern: new URLPattern({ pathname: "/v1/search/:source/" }), handler: fn },
  ];
}
