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

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Max bullets retained per summary list field (keeps the canvas scannable). */
export const MAX_SUMMARY_BULLETS = 8;

function asSummaryList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = asString(value);
    if (!single) return [];
    return single
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_SUMMARY_BULLETS);
  }
  const out: string[] = [];
  for (const item of value) {
    const s = asString(item);
    if (s) out.push(s);
    if (out.length >= MAX_SUMMARY_BULLETS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Functional analysis — Pass 1 (full long-form report).
//
// The single unified Functional Analysis method runs two passes. Pass 1 is this
// vision call: it produces ONE long-form markdown report, returned as RAW
// markdown (the backend uses text mode, not `response_format: json_object`,
// because escaping a big report into one JSON string makes models emit
// invalid/truncated JSON). The report is stored verbatim on the Functional Card
// frame for the `.md` export. Pass 2 (`functionalSummaryMode`, below) condenses
// that report into the fixed 5-field summary rendered on the canvas.
//
// The persona / source-handling / output-structure / writing-style / quality
// checklist below are an embedded copy of the readable source prompt at
// `FUNCTIONAL_ANALYST_PROMPT.md` (kept in sync by hand). Only the OUTPUT FORMAT
// section is rewritten here to demand raw markdown.
// ---------------------------------------------------------------------------

export const FUNCTIONAL_ANALYSIS_ADVANCED_MODE = "functionalAnalysisAdvanced";
export const FUNCTIONAL_ANALYSIS_ADVANCED_VERSION = 2;

/** In-memory key for the full report string (mirrors the engine serialization key). */
export const FUNCTIONAL_DOC_KEY = "functionalDoc";

/**
 * Upper bound on the rendered markdown report. The clamp is the last-line
 * defense so a runaway response is truncated rather than rejected; the prompt
 * asks the model to stay well under it.
 *
 * Consistency rule: this char clamp MUST stay below the output token budget
 * expressed as characters (`FUNCTIONAL_ADVANCED_MAX_TOKENS * ~4`), so the model
 * finishes its report naturally and the clamp never severs an otherwise-complete
 * response mid-sentence. At 16000 output tokens that ceiling is ~64000 chars, so
 * 32000 leaves comfortable headroom while still bounding a TEXT node's size.
 */
export const MAX_DOCUMENT_CHARS = 32000;

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
  "Before writing, scan the ENTIRE screen edge to edge \u2014 global header, side navigation, lists and inboxes, the main content area, status badges, metadata (dates, references, sender/identity), step or progress indicators, footers, and floating or corner controls. Document the surrounding context that establishes where this screen sits and what state it is in, not just the primary content area. Transcribe the actual visible labels verbatim rather than collapsing a populated region into one generic entry (capture the individual navigation items, list rows, tabs, and badges, not just \"navigation menu\").",
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
  "1-3 sentences describing what the screen or feature is, its core purpose, and where it appears to sit in the user journey. State the surface type \u2014 full page, modal/dialog, drawer, side panel, or overlay \u2014 since it determines how the screen is opened and dismissed. Use the visual signature to classify it: if the content sits in a centered card floating over a dimmed/greyed-out or blurred version of another screen, with a \u00d7 (close) in a corner and Cancel/Confirm actions in a footer, it is a modal/dialog \u2014 not a full page. A panel anchored to one edge over dimmed content is a drawer. Only call it a full page when it fills the viewport with no underlying screen showing through.",
  "",
  "## Related Screens & Flow Context",
  "Include only when other screens are provided in the set; otherwise omit this section. Capture how this screen connects to the rest of the journey:",
  "- Previous screen(s): which screen(s) in the set lead here, if any.",
  "- Next screen(s): which screen(s) this one leads to, if any.",
  "- Trigger: the action/condition that causes the transition, and whether it is user-initiated (a click/submit) or system-initiated (a back-office event, status change, or timeout). Do not assume a user click when the transition is driven by a system event.",
  "- Data transferred: information likely passed between screens (mark as an assumption when not visible).",
  "- Assumptions: navigation, state, and data assumptions made about these connections.",
  "",
  "## Business Summary",
  "Non-technical stakeholder summary. Use bold-headed groups where useful: **What it does:**, **What it enables:**, **Scope boundaries:**, **Dependencies:**, **Key assumptions:**. Use tables for structured decision logic when helpful.",
  "",
  "## Element Inventory",
  "List significant UI elements in visual reading order. Cover every functional region of the screen, including global navigation, side navigation, inbox/message/list items, tabs and filters, status badges, step/progress indicators, and metadata (dates, references, sender/identity) \u2014 these convey state, context, and available actions, so they are NOT decorative. Skip only purely visual or spacer elements (backgrounds, dividers, illustrations). Do not collapse a populated region into one generic entry; capture the actual items and their labels.",
  "Render the inventory as a single Markdown table \u2014 do NOT use a bullet list or nested headings. One row per element, with these exact columns in this order: | Section | Type | Label/text (verbatim) | Purpose | Interaction | Expected behavior | States / Conditions |. Use the Section column to group elements (repeat the section name per row, or leave blank on continuation rows). In the States / Conditions column, explicitly flag conditional elements \u2014 fields or controls that appear, hide, become required, or unlock only when another option is selected or a prior step is completed (e.g. a rationale field required only when \"refuse\" is chosen). Keep each cell concise; if a cell would be long, summarize rather than breaking the table.",
  "",
  "## Workflows",
  "Enumerate EVERY distinct workflow the screen supports, not just the primary happy path. Cover, where applicable: the primary success path; each alternate path implied by a different choice; cancel / dismiss / close (including a modal's \u00d7 or a \"Cancel\"/\"Annuleren\" action); and error / validation-failure paths. When the screen has a binary or multi-option decision (radio group, accept/refuse, yes/no), write one workflow per option \u2014 INCLUDING the option that is not currently selected (e.g. document both the refuse path and the accept path, noting how required fields or the downstream screen differ between them). Distinguish user-triggered transitions from system-triggered ones. Prefer multiple simple workflows over one large one. For each use: ### [Workflow Name], **Trigger:**, **Process:** (numbered steps), **Outcome:**, **Exceptions or alternatives:**.",
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
  "Before finalizing, verify: the whole screen was scanned edge to edge (navigation, lists/inbox, badges, step indicators, and metadata captured, not just the main content area); relevant visible text is captured verbatim; significant UI elements are listed in visual order; user actions are identified; every distinct workflow is covered (primary, alternate-choice, cancel/dismiss, and error/validation paths \u2014 not just the happy path); conditional fields and the surface type (modal/dialog vs full page) are noted; user-triggered and system-triggered transitions are distinguished; expected outcomes are described; success/error/loading/empty/disabled/permission states are considered; validations and restrictions are documented where visible or implied; business rules are separated from assumptions; open questions are included; risks and edge cases are included; no pixel values, hex codes, font specs, Figma node IDs, or spacing values are included; no implementation/architecture details; no visual design critique.",
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
  "- Be thorough and complete: cover every applicable section fully rather than cutting the report short. Prefer compact tables and short paragraphs, and omit empty sections instead of padding them, but do not sacrifice completeness for brevity. Aim for a complete report (roughly up to ~6000 words when the screen warrants it); never stop mid-section.",
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

// ---------------------------------------------------------------------------
// Functional analysis — Pass 2 (canvas summary).
//
// A text-only call that condenses the Pass 1 markdown report into the fixed
// five-field summary rendered on the Functional Card: a prose `overview` plus
// four bulleted lists. "Analysis Setup" and "Element Inventory" are deliberately
// excluded from the canvas summary (they stay in the downloadable report).
// Returns JSON (the backend pins `response_format: json_object` for this call),
// with a modest token budget since the input is already-structured prose.
// ---------------------------------------------------------------------------

export interface FunctionalSummaryV1 {
  overview: string;
  relatedScreens: string[];
  businessSummary: string[];
  workflows: string[];
  functionalRequirements: string[];
  confidence?: "low" | "medium" | "high";
}

export type FunctionalSummaryValidationResult =
  | { ok: true; value: FunctionalSummaryV1 }
  | { ok: false; error: string; skippedReason?: string };

/**
 * Validate + coerce the Pass 2 model output (JSON string or parsed object) into
 * a `FunctionalSummaryV1`. Fence-tolerant, drops empties, clamps lists. A summary
 * with no usable content fails so the caller can degrade gracefully.
 */
export function validateFunctionalSummary(
  raw: unknown
): FunctionalSummaryValidationResult {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = parseModelJsonContent(raw);
    } catch (e) {
      return { ok: false, error: "Summary was not valid JSON." };
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Summary was not a JSON object." };
  }

  const obj = parsed as Record<string, unknown>;
  const value: FunctionalSummaryV1 = {
    overview: asString(obj.overview),
    relatedScreens: asSummaryList(obj.relatedScreens),
    businessSummary: asSummaryList(obj.businessSummary),
    workflows: asSummaryList(obj.workflows),
    functionalRequirements: asSummaryList(obj.functionalRequirements),
  };

  const hasAnything =
    !!value.overview ||
    value.relatedScreens.length > 0 ||
    value.businessSummary.length > 0 ||
    value.workflows.length > 0 ||
    value.functionalRequirements.length > 0;
  if (!hasAnything) {
    return { ok: false, error: "Summary came back empty." };
  }

  const confidence = asString(obj.confidence);
  if (confidence === "low" || confidence === "medium" || confidence === "high") {
    value.confidence = confidence;
  }

  return { ok: true, value };
}

const SUMMARY_SYSTEM_CONTEXT = [
  "You condense a long-form functional analysis report into a short, structured summary for display on a board card.",
  "You are given the full markdown report for ONE screen. Summarize it; do not invent anything not present in the report.",
  "",
  "Return ONLY a JSON object with this exact shape (no markdown, no prose outside the JSON):",
  "{",
  '  "overview": string,                    // 1-3 sentence plain-prose summary of what the screen is and its purpose',
  '  "relatedScreens": string[],            // concise bullets on how this screen connects to other screens / the flow (empty if none)',
  '  "businessSummary": string[],           // concise bullets: what it does, what it enables, scope, dependencies, key assumptions',
  '  "workflows": string[],                 // concise bullets, one per inferable user workflow',
  '  "functionalRequirements": string[],    // concise bullets, one per key functional requirement',
  '  "confidence": "low" | "medium" | "high" // optional overall confidence',
  "}",
  "",
  "Rules:",
  "- `overview` is plain prose (no bullet markers).",
  "- The four list fields are short bullet lines (a few words to one sentence each), at most 8 per list.",
  "- Do NOT include an Analysis Setup section or an Element Inventory in the summary.",
  "- Preserve the report's own assumptions/uncertainty markers where relevant.",
].join("\n");

export function buildFunctionalSummarySystemContext(): string {
  return SUMMARY_SYSTEM_CONTEXT;
}

export function buildFunctionalSummaryInstruction(markdown: string): string {
  return [
    "Summarize the following functional analysis report into the JSON described in the system instructions.",
    "",
    "REPORT:",
    markdown,
  ].join("\n");
}
