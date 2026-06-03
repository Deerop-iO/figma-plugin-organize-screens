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

// ---------------------------------------------------------------------------
// Advanced functional analysis (single-document mode).
//
// The "Advanced" Functional Analysis mode produces ONE long-form markdown
// report instead of the 8 structured fields. Because the Bonzai backend pins
// `response_format: json_object`, the markdown cannot be returned as raw fenced
// text — it is wrapped in a JSON string field (`{ document, meta }`). The
// engine renders that single string into one editable `functionalDoc` TEXT
// node on the Functional Card.
//
// The persona / source-handling / output-structure / writing-style / quality
// checklist below are an embedded copy of the readable source prompt at
// `FUNCTIONAL_ANALYST_PROMPT.md` (kept in sync by hand). Only the OUTPUT FORMAT
// section is rewritten here to demand the JSON-wrapped markdown.
// ---------------------------------------------------------------------------

export const FUNCTIONAL_ANALYSIS_ADVANCED_MODE = "functionalAnalysisAdvanced";
export const FUNCTIONAL_ANALYSIS_ADVANCED_VERSION = 2;

/** Single editable doc node key on the Functional Card (Advanced mode). */
export const FUNCTIONAL_DOC_KEY = "functionalDoc";

/**
 * Upper bound on the rendered markdown report. A single JSON string that grows
 * unbounded can blow the backend token ceiling or produce a TEXT node too large
 * to scan. The prompt also asks the model to stay well under this; the clamp is
 * the last-line defense so a runaway response is truncated rather than rejected.
 */
export const MAX_DOCUMENT_CHARS = 8000;

export interface FunctionalAnalysisAdvancedV2 {
  document: string;
  meta?: {
    confidence?: "low" | "medium" | "high";
    skippedReason?: string;
  };
}

export type FunctionalAdvancedValidationResult =
  | { ok: true; value: FunctionalAnalysisAdvancedV2 }
  | { ok: false; error: string; skippedReason?: string };

/** Strip a single wrapping ```/```markdown fence, if present. */
function stripMarkdownFence(text: string): string {
  const t = text.trim();
  const fenced = /^```(?:markdown|md)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i.exec(t);
  if (fenced) return fenced[1].trim();
  return t;
}

/**
 * Validate + coerce raw model output into a `FunctionalAnalysisAdvancedV2`.
 *
 * The Advanced report is a single long-form markdown document, returned as RAW
 * markdown (the backend uses text mode, not `json_object`, because escaping a
 * big report into one JSON string makes models emit invalid/truncated JSON).
 * This validator therefore treats the content as markdown:
 *  - a leading `SKIP:` line means the model declined (write nothing);
 *  - a surrounding code fence is stripped;
 *  - the report is clamped to `MAX_DOCUMENT_CHARS`.
 *
 * For backward compatibility it still accepts the old JSON `{ document, meta }`
 * shape (e.g. a stored response or a json-mode caller).
 */
export function validateFunctionalAnalysisAdvanced(
  raw: unknown
): FunctionalAdvancedValidationResult {
  // Back-compat: an already-parsed object, or a string that cleanly parses to
  // the legacy { document, meta } JSON shape.
  let parsedObject: Record<string, unknown> | null = null;
  if (raw && typeof raw === "object") {
    parsedObject = raw as Record<string, unknown>;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.indexOf("{") === 0) {
      try {
        const maybe = parseModelJsonContent(trimmed);
        if (maybe && typeof maybe === "object") {
          parsedObject = maybe as Record<string, unknown>;
        }
      } catch (e) {
        parsedObject = null;
      }
    }
  }

  if (parsedObject) {
    const meta =
      parsedObject.meta && typeof parsedObject.meta === "object"
        ? (parsedObject.meta as Record<string, unknown>)
        : undefined;
    const skippedReason = meta ? asString(meta.skippedReason) : "";
    if (skippedReason) {
      return { ok: false, error: "Model declined to document.", skippedReason };
    }
    let docFromJson = asString(parsedObject.document);
    if (docFromJson) {
      if (docFromJson.length > MAX_DOCUMENT_CHARS) {
        docFromJson = docFromJson.slice(0, MAX_DOCUMENT_CHARS);
      }
      const value: FunctionalAnalysisAdvancedV2 = { document: docFromJson };
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
    // Parsed JSON but no usable document — fall through to the raw-text path
    // below in case the content was actually markdown that merely began "{".
  }

  // Primary path: raw markdown.
  if (typeof raw !== "string") {
    return { ok: false, error: "Documentation came back empty." };
  }
  let document = stripMarkdownFence(raw);

  const skipMatch = /^SKIP:\s*(.*)$/i.exec(document.split(/\r?\n/)[0] || "");
  if (skipMatch) {
    return {
      ok: false,
      error: "Model declined to document.",
      skippedReason: skipMatch[1].trim() || "Not a documentable screen.",
    };
  }

  if (!document) {
    return { ok: false, error: "Documentation came back empty." };
  }
  if (document.length > MAX_DOCUMENT_CHARS) {
    document = document.slice(0, MAX_DOCUMENT_CHARS);
  }

  return { ok: true, value: { document } };
}

// Embedded analyst persona/structure/style. Mirror of FUNCTIONAL_ANALYST_PROMPT.md
// (everything inside its ```markdown fence) EXCEPT the output contract, which is
// replaced by ADVANCED_OUTPUT_INSTRUCTIONS below.
const ADVANCED_ANALYST_PROMPT = [
  "# ROLE",
  "",
  "You are a Senior Functional Analyst with extensive experience translating user interfaces, workflows, and product requirements into structured functional documentation.",
  "",
  "Your output is for business, product, UX, development, and QA stakeholders.",
  "",
  "Your task is to analyze the provided screen, UI component, workflow, or feature and document its functional meaning.",
  "",
  "Focus on:",
  "",
  "- what the screen or feature does",
  "- what the user can do",
  "- how the system should behave",
  "- what information is required",
  "- what rules, validations, and states may apply",
  "- what risks, assumptions, and open questions exist",
  "",
  "Do not critique visual design.",
  "Do not write code.",
  "Do not describe implementation architecture.",
  "",
  "# SOURCE HANDLING",
  "",
  "Use only the provided screen, screenshot, Figma context, UI content, workflow description, or extracted interface data.",
  "Capture visible text as accurately as possible.",
  "Do not assume behavior as fact when it is not visible or explicitly described.",
  "When uncertain, use: \"It appears that...\", \"The screen suggests...\", \"Assumption:\", \"To be confirmed:\", or \"TBD\". Questions are preferred over unsupported assumptions.",
  "",
  "# MULTI-SCREEN / JOURNEY AWARENESS",
  "",
  "This screen is usually documented as one of a set of screens from a single connected user journey. When other screens are provided, the user message lists them by name and order, plus any known flow connections between them. Treat the set as a connected journey, not isolated artifacts.",
  "",
  "When other screens are provided in the set:",
  "- Determine which actions on this screen lead to another screen in the set, and name that screen.",
  "- Infer the intended user flow and reference preceding and subsequent screens by name.",
  "- Document assumptions about navigation paths, state changes, and data passed between screens.",
  "- Do NOT report a flow or downstream screen as unavailable when a matching screen exists in the provided set; describe the complete flow instead.",
  "- Only report a flow as unavailable when no corresponding screen can be identified in the provided set.",
  "",
  "You are given only the NAMES and connections of the other screens, not their pixels. Reference them by name, but mark any cross-screen behavior you cannot directly see as an assumption or open question rather than stating it as fact.",
  "",
  "# EXCLUDE TECHNICAL AND VISUAL DESIGN DETAILS",
  "",
  "Do not include pixel measurements, exact dimensions, hex color codes, font names/sizes/weights, Figma node IDs, component instance references, spacing/padding/margin/gap values, border radius, shadows, visual effects, spacer/layout-only elements, technical hierarchy diagrams, typography/color-system/layout-engineering sections, implementation instructions, or code-level recommendations.",
  "Use semantic descriptions only when functionally relevant (e.g. \"primary action\", \"secondary action\", \"status indicator\", \"error message\", \"confirmation dialog\", \"top-right area\", \"main content area\").",
  "",
  "# OUTPUT STRUCTURE",
  "",
  "Write the report as GitHub-flavored markdown using the following sections. Omit a section entirely when there is nothing to say under it rather than padding it.",
  "",
  "## Analysis Setup",
  "Briefly state: Subject analyzed; Main analysis focus; Expected requirement areas (short numbered list); Known limitations. Do not ask the user for confirmation. Do not list \"downstream screens unavailable\" (or similar) as a known limitation for any screen present in the provided set.",
  "",
  "## Overview",
  "1-3 sentences describing what the screen or feature is, its core purpose, and where it appears to sit in the user journey.",
  "",
  "## Related Screens & Flow Context",
  "Include only when other screens are provided in the set; otherwise omit this section. Capture how this screen connects to the rest of the journey:",
  "- Previous screen(s): which screen(s) in the set lead here, if any.",
  "- Next screen(s): which screen(s) this one leads to, if any.",
  "- Trigger: the action/condition that causes the transition.",
  "- Data transferred: information likely passed between screens (mark as an assumption when not visible).",
  "- Assumptions: navigation, state, and data assumptions made about these connections.",
  "",
  "## Business Summary",
  "Non-technical stakeholder summary. Use bold-headed groups where useful: **What it does:**, **What it enables:**, **Scope boundaries:**, **Dependencies:**, **Key assumptions:**. Use tables for structured decision logic when helpful.",
  "",
  "## Element Inventory",
  "List significant UI elements in visual reading order, grouped by section/panel (skip decorative elements). For each: Type, Label/text, Purpose, Interaction, Expected behavior, States, Conditions.",
  "",
  "## Workflows",
  "Describe inferable user workflows. Prefer multiple simple workflows. For each use: ### [Workflow Name], **Trigger:**, **Process:** (numbered steps), **Outcome:**, **Exceptions or alternatives:**.",
  "",
  "## Functional Requirements",
  "Numbered, self-contained requirements. For each: ### N. [Requirement Name], a short description, and an Action/Condition -> Expected Behaviour -> Result table. Use blockquote callouts (> [!warning], > [!question], > [!note]) where useful.",
  "",
  "## Required States",
  "List visible and likely required states (default, loading, empty, success, error, disabled, permission, validation, partial success). Clearly mark inferred states as assumptions.",
  "",
  "## Business Rules",
  "List visible or strongly implied rules (required fields, eligibility, validation, permissions, restrictions, dependencies, irreversible actions, confirmation requirements). Do not invent rules; mark uncertain ones as assumptions or questions.",
  "",
  "## Open Questions",
  "Feature-level questions, each with its own ### heading explaining what is uncertain, why it matters, and what needs confirming.",
  "",
  "## Risks & Considerations",
  "Functional risks (unclear consequences, missing validation/error handling, unclear permissions, data loss risk, ambiguous status, incomplete recovery paths, user confusion, process inconsistencies).",
  "",
  "## Assumptions",
  "List all assumptions separately so they can be validated.",
  "",
  "## Functional Summary",
  "Concise summary for Product, UX, Development, and QA: purpose, main user actions, most important system behaviors, key open questions or risks.",
  "",
  "# WRITING STYLE",
  "",
  "Write like a professional Functional Analyst: structured, concise, objective, business-focused, implementation-neutral, assumption-aware. Avoid subjective visual feedback, design criticism, code suggestions, technical architecture, unsupported assumptions, and excessive visual styling details. Prefer short paragraphs and compact tables where they improve clarity.",
  "",
  "# QUALITY CHECKLIST",
  "",
  "Before finalizing, verify: relevant visible text is captured; significant UI elements are listed in visual order; user actions are identified; expected outcomes are described; success/error/loading/empty/disabled/permission states are considered; validations and restrictions are documented where visible or implied; business rules are separated from assumptions; open questions are included; risks and edge cases are included; no pixel values, hex codes, font specs, Figma node IDs, or spacing values are included; no implementation/architecture details; no visual design critique.",
].join("\n");

const ADVANCED_OUTPUT_INSTRUCTIONS = [
  "",
  "---",
  "",
  "# OUTPUT FORMAT (STRICT)",
  "",
  "Return ONLY the functional analysis report as GitHub-flavored markdown, following the OUTPUT STRUCTURE above. Do NOT wrap it in JSON. Do NOT wrap it in code fences. Do NOT add any preamble or closing remarks outside the report itself.",
  "",
  "Rules:",
  "- Start directly with the first markdown heading (e.g. \"## Analysis Setup\").",
  "- Keep the report focused and well under ~8000 characters: prefer short sections and compact tables; omit empty sections instead of padding them.",
  '- If the screenshot is unreadable or is not a UI screen, output a single line starting with "SKIP:" followed by a short reason, and nothing else.',
].join("\n");

export function buildFunctionalAdvancedSystemContext(
  _scope?: AnalysisScope
): string {
  return ADVANCED_ANALYST_PROMPT + "\n" + ADVANCED_OUTPUT_INSTRUCTIONS;
}

export function buildFunctionalAdvancedInstruction(
  _scope?: AnalysisScope,
  ctx?: AnalysisContext
): string {
  const lines: string[] = [
    "Document the attached screen as a single functional analysis report in the markdown format described in the system instructions.",
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

    // Cross-screen journey context: the other screens in this run and any known
    // Flow connections. Lets the model reference neighbors by name instead of
    // declaring downstream screens unavailable.
    if (ctx.journeyScreens && ctx.journeyScreens.length) {
      lines.push("");
      lines.push("Screens in this set (in order):");
      for (let i = 0; i < ctx.journeyScreens.length; i++) {
        const s = ctx.journeyScreens[i];
        const isCurrent = !!ctx.currentCardId && s.cardId === ctx.currentCardId;
        lines.push(
          "  " + (i + 1) + ". " + s.name + (isCurrent ? " (THIS SCREEN)" : "")
        );
      }
      if (ctx.flowEdges && ctx.flowEdges.length) {
        lines.push("");
        lines.push("Known flow connections:");
        for (let i = 0; i < ctx.flowEdges.length; i++) {
          const e = ctx.flowEdges[i];
          const arrow = e.trigger ? " --[" + e.trigger + "]--> " : " --> ";
          lines.push("  " + e.from + arrow + e.to);
        }
      }
      lines.push("");
      lines.push(
        "Reference these screens by name where relevant. Do not claim a screen in this list is unavailable for analysis."
      );
    }
  }
  return lines.join("\n");
}

export const functionalAdvancedMode: AnalysisMode<FunctionalAnalysisAdvancedV2> = {
  id: FUNCTIONAL_ANALYSIS_ADVANCED_MODE,
  version: FUNCTIONAL_ANALYSIS_ADVANCED_VERSION,
  buildSystemContext: buildFunctionalAdvancedSystemContext,
  buildInstruction: buildFunctionalAdvancedInstruction,
  validate: validateFunctionalAnalysisAdvanced,
  // The single document string maps to the engine's functionalDoc tag key.
  fieldMap: {
    document: FUNCTIONAL_DOC_KEY,
  },
};

registerAnalysisMode(functionalAdvancedMode as unknown as AnalysisMode<unknown>);
