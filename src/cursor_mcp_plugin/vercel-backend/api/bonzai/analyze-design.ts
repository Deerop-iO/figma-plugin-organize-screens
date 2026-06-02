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
    const model =
      (typeof body.model === "string" && body.model) ||
      process.env.BONZAI_DEFAULT_MODEL ||
      "gpt-4o";

    // Optional, clamped token ceiling. Design Review keeps the 1200 default;
    // the Functional Analysis "Create Documentation" mode requests more because
    // an 8-section functional doc can otherwise truncate. Clamp to a sane band
    // so a bad client value cannot blow up token spend.
    const DEFAULT_MAX_TOKENS = 1200;
    const MAX_TOKENS_CEILING = 2500;
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
    const payload = {
      model,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: maxTokens,
    };

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
      errorResponse(
        res,
        new Error(
          "Bonzai HTTP " + upstream.status + ": " + redactSecrets(raw).slice(0, 500)
        ),
        502
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
        content: normalizeModelJsonContent(content),
        model: (json && json.model) || model,
        usage: json && json.usage,
      },
    });
  } catch (err) {
    errorResponse(res, err, 500);
  }
}
