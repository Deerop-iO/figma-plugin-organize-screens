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

// Stable production alias (updated on every `vercel --prod`, so redeploys do
// not require touching this). Use `http://localhost:3000` while running
// `vercel dev`.
const API_BASE = "https://figma-plugin-organize-screens.vercel.app";

// Hardcoded host allowlist (sandbox-safe — never derived from API_BASE at
// runtime). Mirror of manifest allowedDomains ∪ devAllowedDomains hostnames.
const ALLOWED_HOSTS = [
  "localhost",
  "figma-plugin-organize-screens.vercel.app",
];

const REQUEST_TIMEOUT_MS = 45000;

export interface AnalyzeDesignBackendRequest {
  /** Omit for text-only requests (e.g. section-summary synthesis). */
  imageBase64?: string;
  mimeType?: string;
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

/** Map sandbox/network errors to actionable copy (e.g. Vercel SSO wall). */
function formatFetchFailure(message: string, status?: number, bodyPreview?: string): string {
  const lower = message.toLowerCase();
  const looksLikeVercelAuth =
    status === 401 ||
    (bodyPreview &&
      (bodyPreview.indexOf("Authentication Required") !== -1 ||
        bodyPreview.indexOf("vercel.com/sso-api") !== -1));

  if (looksLikeVercelAuth) {
    return (
      "The Vercel deployment is behind Deployment Protection (login required). " +
      "In the Vercel project: Settings → Deployment Protection → disable " +
      "Vercel Authentication for Production (or allow public access to API routes), " +
      "then redeploy. The Figma plugin cannot sign in to Vercel."
    );
  }

  if (
    lower.indexOf("failed to fetch") !== -1 ||
    lower.indexOf("network request failed") !== -1
  ) {
    return (
      "Could not reach the analysis backend (network or CORS). " +
      "If the Vercel URL opens a login page in the browser, turn off Deployment " +
      "Protection for Production. Otherwise confirm the plugin manifest lists " +
      API_BASE +
      " in allowedDomains and that you re-imported the manifest after changing it."
    );
  }

  return message || "Could not reach the analysis backend.";
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
    const raw = (error && error.message) || "";
    throw new Error(redactSecrets(formatFetchFailure(raw)));
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const preview = redactSecrets(text).slice(0, 300);
    throw new Error(
      formatFetchFailure(
        "Analysis backend HTTP " + response.status + ": " + preview,
        response.status,
        preview
      )
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
