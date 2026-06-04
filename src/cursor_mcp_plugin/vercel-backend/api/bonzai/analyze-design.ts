import type { VercelRequest, VercelResponse } from "@vercel/node";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyCors } from "../_lib/cors";
import { errorResponse, redactSecrets } from "../_lib/errors";
import { normalizeModelJsonContent } from "../_lib/normalizeModelContent";

/**
 * Analyze Design (Bonzai vision) route.
 *
 * The plugin sends a base64 screenshot plus the prompt pieces it built from its
 * shared analysis module. This route attaches the server-side Bonzai key,
 * composes an OpenAI-compatible multimodal chat request (text + image_url) with
 * `response_format: json_object`, and returns the model's raw JSON content for
 * the plugin to validate. The Bonzai key never reaches the plugin.
 *
 * Contract: `{ ok: true, data: { content, model, usage } }` | `{ ok: false, error }`.
 */

const DEFAULT_SYSTEM_PROMPT =
  "You are an AI assistant integrated into a Figma plugin. Exercise sound " +
  "design, UX, and accessibility judgment. When asked for a specific JSON " +
  "shape, return exactly that and nothing else. Do not invent context you " +
  "cannot see.";

function resolveGlobalSystemPrompt(): string {
  if (process.env.BONZAI_SYSTEM_PROMPT) {
    return process.env.BONZAI_SYSTEM_PROMPT;
  }
  const candidates = [
    join(process.cwd(), "bonzai-system-prompt.txt"),
    join(process.cwd(), "vercel-backend", "bonzai-system-prompt.txt"),
    join(__dirname, "..", "..", "bonzai-system-prompt.txt"),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return readFileSync(candidate, "utf8");
    } catch (e) {
      // fall through to the next candidate
    }
  }
  return DEFAULT_SYSTEM_PROMPT;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    errorResponse(res, new Error("Method not allowed."), 405);
    return;
  }

  // Optional shared-secret gate (production hardening). Only enforced when the
  // env var is set, so local dev stays frictionless.
  const requiredToken = process.env.PLUGIN_SECRET;
  if (requiredToken) {
    const provided = req.headers["x-plugin-token"];
    if (provided !== requiredToken) {
      errorResponse(res, new Error("Unauthorized."), 401);
      return;
    }
  }

  try {
    const apiKey = process.env.BONZAI_API_KEY;
    const baseUrl = process.env.BONZAI_BASE_URL;
    if (!apiKey || !baseUrl) {
      errorResponse(
        res,
        new Error("Server is missing BONZAI_API_KEY or BONZAI_BASE_URL."),
        500
      );
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const imageBase64 = body.imageBase64;
    const mimeType =
      typeof body.mimeType === "string" ? body.mimeType : "image/png";
    const systemContext =
      typeof body.systemContext === "string" ? body.systemContext : "";
    const instruction =
      typeof body.instruction === "string" ? body.instruction : "";
    // Model resolution: explicit per-request model wins, then the
    // BONZAI_DEFAULT_MODEL env var (only when non-empty), then a hardcoded
    // vision-capable default. The hardcoded default is the source of truth so an
    // empty/unset env var can never silently fall back to a different model.
    const model =
      (typeof body.model === "string" && body.model) ||
      (process.env.BONZAI_DEFAULT_MODEL || "").trim() ||
      "claude-sonnet-4-6";
    // Output mode. Default "json" preserves every existing caller (Design
    // Review, Basic functional, section summary), which consume structured
    // JSON. "text" is for single long-form outputs (Advanced functional doc):
    // forcing a big markdown report into one JSON string makes the model emit
    // invalid JSON (unescaped newlines/quotes) or truncate unparseably, so we
    // skip response_format and take the raw markdown instead.
    const responseFormat = body.responseFormat === "text" ? "text" : "json";

    // Optional, clamped token ceiling. Design Review keeps the 1200 default;
    // Functional Analysis "Create Documentation" requests more because the
    // long-form single-document report can otherwise truncate. Clamp to a sane
    // band so a bad client value cannot blow up token spend.
    const DEFAULT_MAX_TOKENS = 1200;
    // The functional report is a long-form markdown document; too low a ceiling
    // truncates it mid-sentence. Keep generous headroom (well within the default
    // model's practical output cap) while still bounding worst-case token spend.
    // Must stay in step with the client's FUNCTIONAL_ADVANCED_MAX_TOKENS.
    const MAX_TOKENS_CEILING = 16000;
    const requestedMaxTokens =
      typeof body.max_tokens === "number" && isFinite(body.max_tokens)
        ? Math.floor(body.max_tokens)
        : DEFAULT_MAX_TOKENS;
    const maxTokens = Math.max(
      256,
      Math.min(MAX_TOKENS_CEILING, requestedMaxTokens)
    );

    if (!instruction) {
      errorResponse(res, new Error("Missing instruction."), 400);
      return;
    }
    const hasImage = typeof imageBase64 === "string" && imageBase64.length > 0;

    const globalPrompt = resolveGlobalSystemPrompt();
    const systemContent = systemContext
      ? globalPrompt + "\n\nPlugin-specific instructions:\n" + systemContext
      : globalPrompt;

    // Vision request when an image is supplied; text-only otherwise (used by
    // the section-summary synthesis, which reasons over screen descriptions).
    const userContent = hasImage
      ? [
          { type: "text", text: instruction },
          {
            type: "image_url",
            image_url: { url: "data:" + mimeType + ";base64," + imageBase64 },
          },
        ]
      : [{ type: "text", text: instruction }];
    const payload: {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
      temperature: number;
      max_tokens: number;
      response_format?: { type: "json_object" };
    } = {
      model,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    };
    if (responseFormat === "json") {
      payload.response_format = { type: "json_object" };
    }

    const endpoint = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify(payload),
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      // Forward rate-limit / transient upstream statuses (429, 503) verbatim so
      // the plugin client can honor retry-after and back off. The shared Bonzai
      // org key makes 429 a real possibility under concurrent section runs.
      // Everything else collapses to a generic 502. Pass through upstream
      // retry-after when present so the client waits the suggested interval.
      const status =
        upstream.status === 429 || upstream.status === 503
          ? upstream.status
          : 502;
      if (status !== 502) {
        const retryAfter = upstream.headers.get("retry-after");
        if (retryAfter) {
          res.setHeader("retry-after", retryAfter);
        }
      }
      errorResponse(
        res,
        new Error(
          "Bonzai HTTP " + upstream.status + ": " + redactSecrets(raw).slice(0, 500)
        ),
        status
      );
      return;
    }

    let json: any;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      errorResponse(res, new Error("Bonzai returned a non-JSON response."), 502);
      return;
    }

    const content =
      json &&
      json.choices &&
      json.choices[0] &&
      json.choices[0].message &&
      json.choices[0].message.content;
    if (typeof content !== "string" || !content) {
      errorResponse(res, new Error("Bonzai response had no content."), 502);
      return;
    }

    res.status(200).json({
      ok: true,
      data: {
        // Text mode returns the raw model output (markdown); JSON mode is
        // fence-normalized so the plugin's parser sees clean JSON.
        content:
          responseFormat === "text" ? content : normalizeModelJsonContent(content),
        model: (json && json.model) || model,
        usage: json && json.usage,
      },
    });
  } catch (err) {
    errorResponse(res, err, 500);
  }
}
