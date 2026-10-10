import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { config } from "../config.js";

/** Bearer Token 鉴权，单用户场景用固定令牌。 */
export const auth = (): MiddlewareHandler => async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const given = Buffer.from(token);
  const expected = Buffer.from(config.token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};
