import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import type { Cfg } from "./config.ts";

export class EE extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Eng {
  srch(q: string, kind: string, source: string, limit: number, offset: number): Promise<unknown>;
  meta(source: string, kind: string, id: string): Promise<unknown>;
  stat(): Promise<unknown>;
}

function call(name: string, ...args: (string | number)[]): Promise<unknown> {
  return (globalThis as any)[name](...args.map(String)).then((s: string) => {
    const env = JSON.parse(s);
    if (!env.ok) throw new EE(env.error.code, env.error.message);
    return env.data;
  });
}

export async function load(cfg: Cfg, outDir = ".Out"): Promise<Eng> {
  createRequire(import.meta.url)(`../${outDir}/wasm_exec.js`);
  const wasm = readdirSync(outDir)
    .filter((f) => f.startsWith("build-") && f.endsWith(".wasm"))
    .sort((a, b) => statSync(`${outDir}/${b}`).mtimeMs - statSync(`${outDir}/${a}`).mtimeMs)[0];
  if (!wasm) throw new Error(`no build-*.wasm in ${outDir} - run: node build.mjs`);
  const go = new (globalThis as any).Go();
  const { instance } = (await WebAssembly.instantiate(
    readFileSync(`${outDir}/${wasm}`),
    go.importObject,
  )) as any;
  go.run(instance);
  while (!(globalThis as any).__movieReady) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await call("mInit", JSON.stringify({ domains: cfg.domains }));
  return {
    srch: (q, kind, source, limit, offset) => call("mSrch", q, kind, source, limit, offset),
    meta: (source, kind, id) => call("mMeta", source, kind, id),
    stat: () => call("mStat"),
  };
}
