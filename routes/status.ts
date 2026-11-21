import type { Eng } from "../shared/engine.ts";
import { fuOk } from "../shared/fu.ts";
import { out, type Route } from "../shared/http.ts";

export function stat(eng: Eng): Route[] {
  return [
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/healthz" }),
      handler(_req, res) {
        out(res, 200, { status: "ok" });
      },
    },
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/v1/status" }),
      async handler(_req, res) {
        const s = (await eng.stat()) as object;
        out(res, 200, {
          ...s,
          streams: { vidlink: { fu_loaded: fuOk() }, vidsrc: { embed: true } },
        });
      },
    },
  ];
}
