/**
 * Functional Analysis — analysis mode for the "Create Documentation" feature.
 *
 * Pure module (no Figma APIs, no DOM, no `fetch`), sibling to `designReview.ts`.
 * It owns the v1 functional-doc schema, the validator/coercion, the prompt
 * builders, and the field map to the engine's `osFuncField` keys. It rides the
 * exact same transport spine (shared `requestAnalyzeDesign` client + the generic
 * Bonzai vision route) — only the prompt and schema differ from design review.
 *
 * Nested concepts (inputs/outputs, states) are intentionally flattened into a
 * single `string[]` of labelled lines per section, because each functional
 * section maps to exactly one editable TEXT node on the canvas (matching the
 * Review Card precedent). The prompt instructs the model to emit labelled lines
 * like "Inputs: …" / "Loading: …" rather than nested objects.
 */

import {
  parseModelJsonContent,
  registerAnalysisMode,
  type AnalysisMode,
  type AnalysisScope,
  type AnalysisContext,
} from "./designReview";

export const FUNCTIONAL_ANALYSIS_MODE = "functionalAnalysis";
export const FUNCTIONAL_ANALYSIS_VERSION = 1;

/**
 * Max lines retained per section. Slightly higher than the design-review clamp
 * because flattened sections (States, Inputs/Outputs) legitimately need ~5
 * labelled lines (loading / empty / success / error / edge). Kept bounded so an
 * 8-section doc stays inside the backend token budget and the card stays
 * scannable.
 */
export const MAX_LINES_PER_FUNCTIONAL_FIELD = 6;

/** Ordered functional section keys (mirror engine OS_FUNCTIONAL_SECTION_KEYS). */
export const FUNCTIONAL_SECTION_KEYS = [
  "purpose",
  "userActions",
  "systemBehavior",
  "inputOutput",
  "states",
  "businessRules",
  "missingFunctionality",
  "openQuestions",
] as const;

export type FunctionalSectionKey = (typeof FUNCTIONAL_SECTION_KEYS)[number];

export interface FunctionalAnalysisV1 {
  purpose: string[];
  userActions: string[];
  systemBehavior: string[];
  inputOutput: string[];
  states: string[];
  businessRules: string[];
  missingFunctionality: string[];
  openQuestions: string[];
  meta?: {
    confidence?: "low" | "medium" | "high";
    skippedReason?: string;
  };
}

export const FUNCTIONAL_FIELD_LABELS: Record<string, string> = {
  purpose: "Screen Purpose",
  userActions: "User Actions",
  systemBehavior: "System Behavior",
  inputOutput: "Inputs / Outputs",
  states: "States",
  businessRules: "Business Rules",
  missingFunctionality: "Missing Functionality",
  openQuestions: "Open Questions",
};

export type FunctionalValidationResult =
  | { ok: true; value: FunctionalAnalysisV1 }
  | { ok: false; error: string; skippedReason?: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asLineList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    // Tolerate a single string (model occasionally returns one block) by
    // splitting on newlines.
    const single = asString(value);
    if (!single) return [];
    return single
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_LINES_PER_FUNCTIONAL_FIELD);
  }
  const out: string[] = [];
  for (const item of value) {
    const s = asString(item);
    if (s) out.push(s);
    if (out.length >= MAX_LINES_PER_FUNCTIONAL_FIELD) break;
  }
  return out;
}

/**
 * Validate + coerce raw model output (JSON string or parsed object) into a
 * `FunctionalAnalysisV1`. Fence-tolerant (reuses `parseModelJsonContent`), drops
 * empties, clamps lists, and short-circuits on a declared `skippedReason` so the
 * caller writes nothing. Mirrors `validateDesignReviewAnalysis`.
 */
export function validateFunctionalAnalysis(
  raw: unknown
): FunctionalValidationResult {
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
    return { ok: false, error: "Model declined to document.", skippedReason };
  }

  const value: FunctionalAnalysisV1 = {
    purpose: asLineList(obj.purpose),
    userActions: asLineList(obj.userActions),
    systemBehavior: asLineList(obj.systemBehavior),
    inputOutput: asLineList(obj.inputOutput),
    states: asLineList(obj.states),
    businessRules: asLineList(obj.businessRules),
    missingFunctionality: asLineList(obj.missingFunctionality),
    openQuestions: asLineList(obj.openQuestions),
  };

  let hasAnything = false;
  for (let i = 0; i < FUNCTIONAL_SECTION_KEYS.length; i++) {
    if (value[FUNCTIONAL_SECTION_KEYS[i]].length > 0) {
      hasAnything = true;
      break;
    }
  }
  if (!hasAnything) {
    return { ok: false, error: "Documentation came back empty." };
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
  "You are a senior product/systems analyst documenting the functionality of a single screen for a workshop-style functional review.",
  "You are given a screenshot of one screen/frame from a Figma board.",
  "",
  "Rules:",
  "- Document FUNCTIONALITY, not visual style: what the screen does, how it behaves, and what is missing.",
  "- Base every statement on what is visible in the screenshot plus the provided context. Do not invent business logic you cannot infer.",
  "- Prefer short, scannable bullet lines (a few words to one sentence each). No prose paragraphs, no marketing language.",
  "- When a behavior is inferred rather than certain, prefix the line with \"(assumption)\".",
  "- Prefer adding an item to openQuestions over inventing an answer.",
  "- For nested concepts, emit labelled lines inside the same list:",
  '  - inputOutput: lines like "Inputs: …" and "Outputs: …".',
  '  - states: lines like "Loading: …", "Empty: …", "Success: …", "Error: …", "Edge: …".',
  "",
  "Return ONLY a JSON object with this exact shape (no markdown, no prose outside the JSON):",
  "{",
  '  "purpose": string[],                 // what this screen is for',
  '  "userActions": string[],             // actions a user can take',
  '  "systemBehavior": string[],          // how the system responds',
  '  "inputOutput": string[],             // labelled "Inputs: …" / "Outputs: …" lines',
  '  "states": string[],                  // labelled loading/empty/success/error/edge lines',
  '  "businessRules": string[],           // rules, constraints, validations',
  '  "missingFunctionality": string[],    // gaps or unfinished behavior',
  '  "openQuestions": string[],           // assumptions and unresolved questions',
  '  "meta": { "confidence": "low" | "medium" | "high", "skippedReason": string }',
  "}",
  "Keep at most 6 lines per list.",
  "If the screenshot is unreadable or not a UI screen, set meta.skippedReason explaining why and leave the section lists empty.",
];

export function buildFunctionalSystemContext(_scope?: AnalysisScope): string {
  return SYSTEM_CONTEXT.join("\n");
}

export function buildFunctionalInstruction(
  _scope?: AnalysisScope,
  ctx?: AnalysisContext
): string {
  const lines: string[] = [
    "Document the attached screen and produce the JSON described in the system instructions.",
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

export const functionalMode: AnalysisMode<FunctionalAnalysisV1> = {
  id: FUNCTIONAL_ANALYSIS_MODE,
  version: FUNCTIONAL_ANALYSIS_VERSION,
  buildSystemContext: buildFunctionalSystemContext,
  buildInstruction: buildFunctionalInstruction,
  validate: validateFunctionalAnalysis,
  // Section keys map 1:1 to the engine's osFuncField tag keys.
  fieldMap: {
    purpose: "purpose",
    userActions: "userActions",
    systemBehavior: "systemBehavior",
    inputOutput: "inputOutput",
    states: "states",
    businessRules: "businessRules",
    missingFunctionality: "missingFunctionality",
    openQuestions: "openQuestions",
  },
};

// Self-register so ANALYSIS_MODES carries this mode once this module is loaded,
// without creating a circular import back into designReview.ts.
registerAnalysisMode(functionalMode as unknown as AnalysisMode<unknown>);
