import type { VercelResponse } from "@vercel/node";

/**
 * Redact credentials that upstream APIs sometimes echo back in error bodies
 * (LiteLLM/Bonzai gateways, misconfigured proxies). Run this BEFORE truncation
 * and on anything logged, not just on what is returned to the plugin.
 */
export function redactSecrets(raw: string): string {
  return String(raw)
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ****")
    .replace(/\bsk-[A-Za-z0-9_\-]{8,}\b/g, "sk-****")
    .replace(/(api[-_]?key["':\s=]+)[A-Za-z0-9._\-]+/gi, "$1****");
}

/** Send the standard `{ ok: false, error }` envelope with a redacted message. */
export function errorResponse(
  res: VercelResponse,
  err: unknown,
  code = 500
): void {
  const message = err instanceof Error ? err.message : String(err);
  res.status(code).json({ ok: false, error: redactSecrets(message) });
}
