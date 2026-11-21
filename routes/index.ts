import type { Eng } from "../shared/engine.ts";
import type { Cfg } from "../shared/config.ts";
import type { Route } from "../shared/http.ts";
import { srch } from "./search.ts";
import { lookup } from "./lookup.ts";
import { streams } from "./streams.ts";
import { files } from "./files.ts";
import { hls } from "./hls.ts";
import { sub } from "./sub.ts";
import { stat } from "./status.ts";
import { img } from "./img.ts";

export function routes(eng: Eng, cfg: Cfg): Route[] {
  return [
    ...stat(eng),
    ...files(eng, cfg),
    ...hls(eng, cfg),
    sub(eng, cfg),
    ...srch(eng),
    ...lookup(eng),
    ...streams(eng, cfg),
    img(),
  ];
}
