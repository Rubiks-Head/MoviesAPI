import type { IncomingMessage, ServerResponse } from "node:http";
import { out } from "../shared/http.ts";

export function logReq(
  next: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const t = Date.now();
    res.on("finish", () => {
      const p = URL.parse(req.url ?? "/", "http://x")?.pathname ?? req.url ?? "/";
      console.log(`${req.method} ${p} ${res.statusCode} ${Date.now() - t}ms`);
    });
    try {
      await next(req, res);
    } catch (e) {
      console.error(e);
      if (res.headersSent) res.destroy();
      else out(res, 500, { error: { code: "internal", message: "internal error" } });
    }
  };
}
