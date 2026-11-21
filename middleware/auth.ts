import type { IncomingMessage, ServerResponse } from "node:http";
import type { Cfg } from "../shared/config.ts";
import { out } from "../shared/http.ts";

function ip(cfg: Cfg, req: IncomingMessage): boolean {
  const { ips } = cfg.auth;
  if (!ips.length) return true;
  const a = req.socket.remoteAddress ?? "";
  const v = a.startsWith("::ffff:") ? a.slice(7) : a;
  return ips.includes(v === "::1" ? "127.0.0.1" : v);
}

export function gate(cfg: Cfg, req: IncomingMessage, res: ServerResponse): boolean {
  const { token } = cfg.auth;
  const u = URL.parse(req.url ?? "/", "http://localhost");
  if (!u) {
    out(res, 400, { error: { code: "bad_request", message: "malformed request target" } });
    return false;
  }
  if (u.pathname === "/healthz") return true;
  if (!token && !cfg.auth.ips.length) return true;
  if (!ip(cfg, req)) {
    out(res, 403, { error: { code: "forbidden", message: "ip not allowed" } });
    return false;
  }
  if (token) {
    const t = u.searchParams.get("tkn") ?? u.searchParams.get("key") ?? req.headers["x-api-key"];
    if (t !== token) {
      out(res, 401, { error: { code: "unauthorized", message: "missing or bad token" } });
      return false;
    }
  }
  return true;
}
