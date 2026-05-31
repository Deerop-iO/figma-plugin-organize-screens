/**
 * Analyze Design backend client (plugin runtime side).
 *
 * All network access for Analyze Design lives here in `code.ts` land, never in
 * the UI. The plugin talks ONLY to its own Vercel backend route; the backend
 * holds the Bonzai key and talks to Bonzai. Per the kit networking rules:
 *  - no `new URL(...)` (the QuickJS sandbox has no URL constructor) — host
 *    checks use a regex helper and hardcoded literals
 *  - no `signal` / AbortController in fetch init — timeouts use Promise.race
 *  - response bodies are redacted before they surface anywhere
 *
 * Switching environments: keep `API_BASE` on `http://localhost:3000` while
 * running `vercel dev`; set it to the deployed origin for production. Both
 * hostnames are listed in `ALLOWED_HOSTS` below and must stay in sync with
 * `manifest.json` (`devAllowedDomains` for localhost, `allowedDomains` for the
 * production origin).
 */

// Dev default. Set to the deployed Vercel origin for production builds.
const API_BASE = "http://localhost:3000";

// Hardcoded host allowlist (sandbox-safe — never derived from API_BASE at
// runtime). Mirror of manifest allowedDomains ∪ devAllowedDomains hostnames.
const ALLOWED_HOSTS = ["localhost", "cursor-figma-analyze.vercel.app"];

const REQUEST_TIMEOUT_MS = 45000;

export interface AnalyzeDesignBackendRequest {
  imageBase64: string;
  mimeType: string;
  systemContext: string;
  instruction: string;
  model?: string;
}

export interface AnalyzeDesignBackendData {
  content: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

/** Extract a hostname without the (absent) URL constructor. */
function hostnameOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(url);
  return match ? match[1] : "";
}

function assertAllowedHost(url: string): void {
  const host = hostnameOf(url);
  if (ALLOWED_HOSTS.indexOf(host) === -1) {
    throw new Error("Blocked request to non-allowlisted host: " + host);
  }
}

/** Last-line redaction in case a token slips through the backend envelope. */
function redactSecrets(raw: string): string {
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ****")
    .replace(/\bsk-[A-Za-z0-9_\-]{8,}\b/g, "sk-****")
    .replace(/(api[-_]?key["':\s=]+)[A-Za-z0-9._\-]+/gi, "$1****");
}

/**
 * Race a promise against a timer. The sandbox rejects `signal` in fetch init,
 * so AbortController is not available; the underlying fetch keeps running if
 * the timer wins, but the caller gets a clean rejection.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Analyze request timed out.")), ms);
    }),
  ]);
}

export async function requestAnalyzeDesign(
  body: AnalyzeDesignBackendRequest
): Promise<AnalyzeDesignBackendData> {
  const url = API_BASE + "/api/bonzai/analyze-design";
  assertAllowedHost(url);

  let response: Response;
  try {
    response = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      REQUEST_TIMEOUT_MS
    );
  } catch (error: any) {
    throw new Error(
      redactSecrets((error && error.message) || "Could not reach the analysis backend.")
    );
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(
      "Analysis backend HTTP " +
        response.status +
        ": " +
        redactSecrets(text).slice(0, 300)
    );
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error("Analysis backend returned a non-JSON response.");
  }

  if (!json || json.ok !== true) {
    throw new Error(
      redactSecrets((json && json.error) || "Analysis backend returned an error.")
    );
  }

  const data = json.data || {};
  if (typeof data.content !== "string" || !data.content) {
    throw new Error("Analysis backend response was missing content.");
  }
  return data as AnalyzeDesignBackendData;
}
