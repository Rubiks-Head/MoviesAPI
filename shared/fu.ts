import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import sodium from "libsodium-wrappers-sumo";
import type { Cfg } from "./config.ts";
import { EE } from "./engine.ts";
import { readBody } from "./egress.ts";

const FP = "bin/fu.wasm";

let ready: Promise<void> | null = null;

async function dl(cfg: Cfg): Promise<Buffer> {
  if (existsSync(FP)) return readFileSync(FP);
  const r = await fetch(`${cfg.domains.vidlink}/fu.wasm`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new EE("upstream_error", `fu.wasm download: ${r.status}`);
  const buf = await readBody(r, 32 * 1024 * 1024);
  if (!buf) throw new EE("upstream_error", "fu.wasm too large");
  mkdirSync("bin", { recursive: true });
  writeFileSync(FP, buf);
  return buf;
}

async function up(cfg: Cfg): Promise<void> {
  createRequire(import.meta.url)("../.Out/wasm_exec.js");
  await sodium.ready;
  (globalThis as any).sodium = sodium;
  const go = new (globalThis as any).Go();
  const res = await WebAssembly.instantiate(await dl(cfg), go.importObject);
  go.run((res as any).instance);
  for (let i = 0; i < 100 && typeof (globalThis as any).getAdv !== "function"; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (typeof (globalThis as any).getAdv !== "function") {
    throw new EE("resolve_failed", "fu.wasm did not export getAdv");
  }
}

export function fuOk(): boolean {
  return typeof (globalThis as any).getAdv === "function";
}

export async function adv(cfg: Cfg, id: string): Promise<string> {
  ready ??= up(cfg).catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  const tok = (globalThis as any).getAdv(id);
  if (typeof tok !== "string" || !tok) {
    throw new EE("resolve_failed", `fu.wasm could not seal id '${id}'`);
  }
  return tok;
}
