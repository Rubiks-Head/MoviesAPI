import { existsSync, readFileSync } from "node:fs";
import { parse } from "smol-toml";

export interface Cfg {
  addr: string;
  domains: Record<string, string>;
  auth: { token: string; ips: string[] };
  egress: { allow_private: boolean };
}

export function loadCfg(path = "config.toml"): Cfg {
  if (!existsSync(path)) console.warn(`${path} missing - using defaults`);
  const file = existsSync(path) ? (parse(readFileSync(path, "utf8")) as Record<string, any>) : {};
  return {
    addr: (file.addr as string) ?? ":9980",
    domains: {
      cinemeta: "https://v3-cinemeta.strem.io",
      vidlink: "https://vidlink.pro",
      vidsrc: "https://vidsrc.me",
      ...(file.domains as object),
    },
    auth: { token: "", ips: [] as string[], ...(file.auth as object) },
    egress: { allow_private: false, ...(file.egress as object) },
  };
}
