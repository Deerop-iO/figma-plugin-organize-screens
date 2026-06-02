/**
 * Analyze Design — shared, environment-agnostic analysis core.
 *
 * This module is pure: no Figma APIs, no DOM, no `fetch`. It owns the v1
 * output schema, the validator/coercion, the field map to the engine's
 * `osReviewField` keys, and the prompt builders. Both the plugin runtime
 * (which validates the model output before writing to canvas) and the prompt
 * construction (sent to the Bonzai vision backend) consume it, so the contract
 * lives in exactly one place.
 *
 * Future analysis modes (accessibility, consistency, variant comparison) are
 * added as new entries in `ANALYSIS_MODES` without touching the runtime or UI.
 */

export const ANALYZE_DESIGN_MODE = "designReview";
export const ANALYZE_DESIGN_VERSION = 1;

/** Max bullets retained per list field (keeps review cards readable). */
export const MAX_BULLETS_PER_FIELD = 3;

/**
 * v1 structured output. Maps 1:1 to the `standard` review framework plus the
 * Screen Column's Card Description. `notes` is optional (included in v1 per
 * product decision). `meta.skippedReason` lets the model decline cleanly — the
 * runtime then writes nothing instead of inventing placeholder filler.
 */
export interface DesignReviewAnalysisV1 {
  cardDescription: string;
  workingWell: string[];
  questions: string[];
  concerns: string[];
  ideas: string[];
  notes?: string;
  meta?: {
    confidence?: "low" | "medium" | "high";
    skippedReason?: string;
  };
}

/** Review-field tag keys this mode writes (mirrors REVIEW_FRAMEWORKS.standard). */
export const DESIGN_REVIEW_LIST_FIELDS = [
  "workingWell",
  "questions",
  "concerns",
  "ideas",
] as const;

/** Human-readable labels for applied/skipped reporting in the UI. */
export const DESIGN_REVIEW_FIELD_LABELS: Record<string, string> = {
  cardDescription: "Card description",
  workingWell: "What's good",
  questions: "Questions",
  concerns: "Concerns",
  ideas: "Ideas",
  notes: "Notes",
};

export interface AnalysisContext {
  frameName?: string;
  cardTitle?: string;
  existingDescription?: string;
}

export type ValidationResult =
  | { ok: true; value: DesignReviewAnalysisV1 }
  | { ok: false; error: string; skippedReason?: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = asString(item);
    if (s) out.push(s);
    if (out.length >= MAX_BULLETS_PER_FIELD) break;
  }
  return out;
}

/**
 * Parse model text that may be raw JSON, fenced markdown, or JSON embedded in
 * prose. Bonzai often returns ```json ... ``` even when `response_format:
 * json_object` is set.
 */
export function parseModelJsonContent(raw: string): unknown {
  let text = raw.trim();
  const fenced = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i.exec(text);
  if (fenced) {
    text = fenced[1].trim();
  } else if (text.indexOf("```") === 0) {
    text = text
      .replace(/^```(?:json)?\s*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/i, "")
      .trim();
  }

  try {
    return JSON.parse(text);
  } catch (firstError) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw firstError;
  }
}

/**
 * Validate + coerce raw model output (a JSON string or an already-parsed
 * object) into a `DesignReviewAnalysisV1`. Empty list items are dropped, lists
 * are clamped, and a declared `skippedReason` short-circuits to a non-ok
 * result so the caller writes nothing to the canvas.
 */
export function validateDesignReviewAnalysis(raw: unknown): ValidationResult {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = parseModelJsonContent(raw);
    } catch (e) {
      return { ok: false, error: "Response was not valid JSON." };
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Response was not a JSON object." };
  }

  const obj = parsed as Record<string, unknown>;

  const meta =
    obj.meta && typeof obj.meta === "object"
      ? (obj.meta as Record<string, unknown>)
      : undefined;
  const skippedReason = meta ? asString(meta.skippedReason) : "";
  if (skippedReason) {
    return { ok: false, error: "Model declined to analyze.", skippedReason };
  }

  const value: DesignReviewAnalysisV1 = {
    cardDescription: asString(obj.cardDescription),
    workingWell: asStringList(obj.workingWell),
    questions: asStringList(obj.questions),
    concerns: asStringList(obj.concerns),
    ideas: asStringList(obj.ideas),
  };

  const notes = asString(obj.notes);
  if (notes) value.notes = notes;

  const hasAnything =
    value.cardDescription.length > 0 ||
    value.workingWell.length > 0 ||
    value.questions.length > 0 ||
    value.concerns.length > 0 ||
    value.ideas.length > 0 ||
    (value.notes ? value.notes.length > 0 : false);

  if (!hasAnything) {
    return { ok: false, error: "Analysis came back empty." };
  }

  if (meta) {
    const confidence = asString(meta.confidence);
    if (
      confidence === "low" ||
      confidence === "medium" ||
      confidence === "high"
    ) {
      value.meta = { confidence };
    }
  }

  return { ok: true, value };
}

/**
 * Analysis scope. The UI exposes two AI actions backed by the same schema and
 * validator: `describe` fills only the Card Description; `review` fills only the
 * review section. Scoping is prompt-only so the model returns just what each
 * action needs (lower token cost, less chance of hallucinating the other half).
 */
export type AnalysisScope = "describe" | "review";

const SYSTEM_CONTEXT_HEADER = [
  "You are a senior product designer participating in a design review of a single screen.",
  "You are given a screenshot of one screen/frame from a Figma board.",
  "",
  "Rules:",
  "- Base every observation on what is visible in the screenshot. Do not invent business context, data, or flows you cannot see.",
  "- Prefer questions over assumptions when intent is unclear.",
  "- Be concrete and actionable. No marketing language, no generic filler, no praise padding.",
];

const DESCRIBE_BODY = [
  "Your task: write a documentation-tone description of what this screen is and does (1-3 sentences).",
  "",
  "Return ONLY a JSON object with this exact shape (no markdown, no prose outside the JSON):",
  "{",
  '  "cardDescription": string,   // 1-3 sentences describing the screen',
  '  "meta": { "confidence": "low" | "medium" | "high", "skippedReason": string }',
  "}",
  "Leave the review fields out entirely; this action only documents the screen.",
  'If the screenshot is unreadable or not a UI screen, return meta.skippedReason explaining why and leave cardDescription empty.',
];

const REVIEW_BODY = [
  "Your task: write concise, specific review feedback as if leaving comments for the design team.",
  "- Keep each bullet to a single short sentence. Use at most three bullets per list.",
  "",
  "Return ONLY a JSON object with this exact shape (no markdown, no prose outside the JSON):",
  "{",
  '  "workingWell": string[],   // what works well in the design',
  '  "questions": string[],     // open questions for the team',
  '  "concerns": string[],      // risks, usability or clarity issues',
  '  "ideas": string[],         // concrete improvement ideas',
  '  "notes": string,           // optional, any additional feedback',
  '  "meta": { "confidence": "low" | "medium" | "high", "skippedReason": string }',
  "}",
  "Do not include a cardDescription; this action only fills the review section.",
  'If the screenshot is unreadable or not a UI screen, return meta.skippedReason explaining why and leave the review fields empty.',
];

export function buildDesignReviewSystemContext(scope: AnalysisScope = "review"): string {
  const body = scope === "describe" ? DESCRIBE_BODY : REVIEW_BODY;
  return SYSTEM_CONTEXT_HEADER.concat("").concat(body).join("\n");
}

export function buildDesignReviewInstruction(
  scope: AnalysisScope = "review",
  ctx?: AnalysisContext
): string {
  const lead =
    scope === "describe"
      ? "Describe the attached screen and produce the JSON described in the system instructions."
      : "Review the attached screen and produce the JSON described in the system instructions.";
  const lines: string[] = [lead];
  if (ctx) {
    const meta: string[] = [];
    if (ctx.frameName) meta.push('Frame name: "' + ctx.frameName + '"');
    if (ctx.cardTitle) meta.push('Card title: "' + ctx.cardTitle + '"');
    if (ctx.existingDescription) {
      meta.push('Existing description (for context): "' + ctx.existingDescription + '"');
    }
    if (meta.length) {
      lines.push("");
      lines.push("Context (may be incomplete; trust the image first):");
      for (const m of meta) lines.push("- " + m);
    }
  }
  return lines.join("\n");
}

export interface AnalysisMode<T> {
  id: string;
  version: number;
  buildSystemContext(scope?: AnalysisScope): string;
  buildInstruction(scope?: AnalysisScope, ctx?: AnalysisContext): string;
  validate(raw: unknown):
    | { ok: true; value: T }
    | { ok: false; error: string; skippedReason?: string };
  /** AI field -> engine review field tag key (or "cardDescription"/"notes"). */
  fieldMap: Record<string, string>;
}

export const designReviewMode: AnalysisMode<DesignReviewAnalysisV1> = {
  id: ANALYZE_DESIGN_MODE,
  version: ANALYZE_DESIGN_VERSION,
  buildSystemContext: buildDesignReviewSystemContext,
  buildInstruction: buildDesignReviewInstruction,
  validate: validateDesignReviewAnalysis,
  fieldMap: {
    cardDescription: "cardDescription",
    workingWell: "workingWell",
    questions: "questions",
    concerns: "concerns",
    ideas: "ideas",
    notes: "notes",
  },
};

/**
 * Registry of analysis modes keyed by id. Seeded with `designReview`; other
 * modes self-register via `registerAnalysisMode` from their own module (e.g.
 * `functionalAnalysis.ts`). Registration is done this way — rather than
 * importing every mode here — so `designReview.ts` stays free of imports from
 * its sibling modes and there is no circular dependency.
 */
export const ANALYSIS_MODES: Record<string, AnalysisMode<unknown>> = {
  designReview: designReviewMode as AnalysisMode<unknown>,
};

export function registerAnalysisMode(mode: AnalysisMode<unknown>): void {
  ANALYSIS_MODES[mode.id] = mode;
}

// ---------------------------------------------------------------------------
// Section summary (text-only synthesis).
//
// After section-scope "Describe" fills each screen's Card Description, the
// runtime sends the collected per-screen descriptions to this text-only call
// (no image) to produce a Section Title + Section Description for the board's
// Overview Header. Same fence-tolerant parsing; its own tiny schema/validator.
// ---------------------------------------------------------------------------

export interface SectionMetaV1 {
  sectionTitle: string;
  sectionDescription: string;
  meta?: {
    confidence?: "low" | "medium" | "high";
    skippedReason?: string;
  };
}

export interface SectionScreenSummary {
  name: string;
  description: string;
}

export type SectionMetaValidationResult =
  | { ok: true; value: SectionMetaV1 }
  | { ok: false; error: string; skippedReason?: string };

export function buildSectionMetaSystemContext(): string {
  return [
    "You are a senior product designer summarizing a section of related screens for a design review board.",
    "You are given short descriptions of each screen in the section (no images).",
    "",
    "Rules:",
    "- Base the summary only on the provided screen descriptions. Do not invent flows, data, or business context you cannot infer from them.",
    "- The section title is a short label (2-5 words) naming the flow or theme these screens share.",
    "- The section description is 1-2 sentences explaining what this group of screens covers.",
    "- No marketing language, no filler.",
    "",
    "Return ONLY a JSON object with this exact shape (no markdown, no prose outside the JSON):",
    "{",
    '  "sectionTitle": string,',
    '  "sectionDescription": string,',
    '  "meta": { "confidence": "low" | "medium" | "high", "skippedReason": string }',
    "}",
    "If the descriptions are too sparse to summarize, set meta.skippedReason and leave the other fields empty.",
  ].join("\n");
}

export function buildSectionMetaInstruction(screens: SectionScreenSummary[]): string {
  const lines: string[] = [
    "Summarize the following " + screens.length + " screens into a section title and description.",
    "",
    "Screens:",
  ];
  for (let i = 0; i < screens.length; i++) {
    const name = asString(screens[i] && screens[i].name) || "Screen " + (i + 1);
    const desc = asString(screens[i] && screens[i].description);
    lines.push("- " + name + (desc ? ": " + desc : ""));
  }
  return lines.join("\n");
}

export function validateSectionMeta(raw: unknown): SectionMetaValidationResult {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = parseModelJsonContent(raw);
    } catch (e) {
      return { ok: false, error: "Response was not valid JSON." };
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Response was not a JSON object." };
  }

  const obj = parsed as Record<string, unknown>;
  const meta =
    obj.meta && typeof obj.meta === "object"
      ? (obj.meta as Record<string, unknown>)
      : undefined;
  const skippedReason = meta ? asString(meta.skippedReason) : "";
  if (skippedReason) {
    return { ok: false, error: "Model declined to summarize.", skippedReason };
  }

  const value: SectionMetaV1 = {
    sectionTitle: asString(obj.sectionTitle),
    sectionDescription: asString(obj.sectionDescription),
  };

  if (!value.sectionTitle && !value.sectionDescription) {
    return { ok: false, error: "Section summary came back empty." };
  }

  if (meta) {
    const confidence = asString(meta.confidence);
    if (confidence === "low" || confidence === "medium" || confidence === "high") {
      value.meta = { confidence };
    }
  }

  return { ok: true, value };
}
