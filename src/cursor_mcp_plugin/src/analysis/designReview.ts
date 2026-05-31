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
 * Validate + coerce raw model output (a JSON string or an already-parsed
 * object) into a `DesignReviewAnalysisV1`. Empty list items are dropped, lists
 * are clamped, and a declared `skippedReason` short-circuits to a non-ok
 * result so the caller writes nothing to the canvas.
 */
export function validateDesignReviewAnalysis(raw: unknown): ValidationResult {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
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

const SYSTEM_CONTEXT = [
  "You are a senior product designer participating in a design review of a single screen.",
  "You are given a screenshot of one screen/frame from a Figma board.",
  "Write concise, specific, professional review feedback as if leaving comments for the design team.",
  "",
  "Rules:",
  "- Base every observation on what is visible in the screenshot. Do not invent business context, data, or flows you cannot see.",
  "- Prefer questions over assumptions when intent is unclear.",
  "- Be concrete and actionable. No marketing language, no generic filler, no praise padding.",
  "- Keep each bullet to a single short sentence. Use at most three bullets per list.",
  "- The card description is documentation tone: 1-3 sentences describing what this screen is and does.",
  "",
  "Return ONLY a JSON object with this exact shape (no markdown, no prose outside the JSON):",
  "{",
  '  "cardDescription": string,',
  '  "workingWell": string[],   // what works well in the design',
  '  "questions": string[],     // open questions for the team',
  '  "concerns": string[],      // risks, usability or clarity issues',
  '  "ideas": string[],         // concrete improvement ideas',
  '  "notes": string,           // optional, any additional feedback',
  '  "meta": { "confidence": "low" | "medium" | "high", "skippedReason": string }',
  "}",
  'If the screenshot is unreadable or not a UI screen, return meta.skippedReason explaining why and leave the other fields empty.',
].join("\n");

export function buildDesignReviewSystemContext(): string {
  return SYSTEM_CONTEXT;
}

export function buildDesignReviewInstruction(ctx?: AnalysisContext): string {
  const lines: string[] = [
    "Review the attached screen and produce the JSON described in the system instructions.",
  ];
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
  buildSystemContext(): string;
  buildInstruction(ctx?: AnalysisContext): string;
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

export const ANALYSIS_MODES = {
  designReview: designReviewMode,
};
