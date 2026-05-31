import type { VercelResponse } from "@vercel/node";

/**
 * Figma plugins send a `null` origin, so the starter policy is permissive.
 * Combine with a shared-secret header (see README "Production hardening") when
 * the route uses a paid API such as Bonzai.
 */
export function applyCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Plugin-Token");
}
