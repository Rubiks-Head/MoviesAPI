import type { Eng } from "../shared/engine.ts";
import { vM, vT, type RM } from "../shared/enrich.ts";
import { fail, out, type Route } from "../shared/http.ts";

export function lookup(eng: Eng): Route[] {
  const h =
    (sp: "fixed" | "param", full = false): Route["handler"] =>
    async (_req, res, params) => {
      try {
        const source = sp === "param" ? params.source! : "cinemeta";
        const m = (await eng.meta(source, params.type!, params.id!)) as RM;
        out(res, 200, full ? vM(m) : vT(m));
      } catch (e) {
        fail(res, e);
      }
    };
  return [
    { method: "GET", pattern: new URLPattern({ pathname: "/v1/meta/~/:type/:id" }), handler: h("fixed", true) },
    { method: "GET", pattern: new URLPattern({ pathname: "/v1/meta/:type/:id" }), handler: h("fixed") },
    { method: "GET", pattern: new URLPattern({ pathname: "/v1/meta/:source/:type/:id" }), handler: h("param", true) },
  ];
}
