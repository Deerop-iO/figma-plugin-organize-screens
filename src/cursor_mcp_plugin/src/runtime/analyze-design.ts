/**
 * Analyze Design runtime orchestration (code.ts lane).
 *
 * Shared core flow: resolve target -> export PNG -> call Bonzai vision backend
 * -> validate JSON -> apply to canvas. The engine owns selection resolution and
 * every canvas write; this module owns export, the network call, and
 * validation. Triggered by the `analyze-design` / `reset-review` UI messages;
 * never routed through the MCP command dispatcher.
 *
 * Two scopes share one pipeline via `analyzeOneScreen`:
 *  - target "card": runs it once on the selected Screen Card; for `describe`
 *    it then makes one text-only call to synthesize the Section Title +
 *    Description from that screen's description.
 *  - target "section": loops every standard review screen in the section,
 *    yielding between screens; for `describe` it then makes one text-only call
 *    to synthesize the Section Title + Description from the collected
 *    per-screen descriptions.
 */

// @ts-nocheck
import {
  osResolveAnalyzeDesignTarget,
  osResolveAnalyzeDesignSectionTarget,
  osApplyDesignReviewAnalysis,
  osResetDesignReviewFields,
  osApplySectionMeta,
  osCollectSectionDescribeSummaries,
  osCollectSectionFunctionalSummaries,
  osBuildSectionMetaFallback,
  osResolveCreateDocumentationTarget,
  osResolveCreateDocumentationSectionTarget,
  osBuildFunctionalJourneyContext,
  osCollectFunctionalDocuments,
  osApplyFunctionalAnalysis,
  osResetFunctionalFields,
} from "../engine-inline";
import { customBase64Encode } from "../lib/base64";
import { requestAnalyzeDesign } from "../lib/analyzeDesignClient";
import {
  designReviewMode,
  buildSectionMetaSystemContext,
  buildSectionMetaInstruction,
  validateSectionMeta,
} from "../analysis/designReview";
import {
  functionalAdvancedMode,
  buildFunctionalSummarySystemContext,
  buildFunctionalSummaryInstruction,
  validateFunctionalSummary,
  type FunctionalSummaryV1,
} from "../analysis/functionalAnalysis";
import { pushSelectionContexts } from "./selection-probes";

type AnalyzeScope = "describe" | "review";
type AnalyzeTarget = "card" | "section";
type ResultOperation =
  | "describe"
  | "review"
  | "resetReview"
  | "document"
  | "resetDocumentation";

// Per-run analysis binding: which mode builds the prompt/validates, and which
// engine apply function writes the result. Parameterizing `analyzeOneScreen`
// this way keeps the design-review path byte-identical. Functional documentation
// uses its own two-pass path (`documentOneScreen`).
interface AnalysisBinding {
  /** Prompt scope (design review only); functional ignores it. */
  scope?: AnalyzeScope;
  mode: typeof designReviewMode;
  apply: (
    sectionId: string,
    cardId: string,
    value: unknown
  ) => Promise<{ applied: string[]; skipped: string[] }>;
  /** Optional token ceiling for the backend (functional doc needs more). */
  maxTokens?: number;
  /** Optional client timeout override (ms); long-form docs need more. */
  timeoutMs?: number;
  /** Backend output mode; "text" for raw long-form markdown (no json_object). */
  responseFormat?: "json" | "text";
}

// Pass 2 (summary) condenses the already-structured report, so a modest budget
// is plenty; the backend clamps it anyway.
const FUNCTIONAL_SUMMARY_MAX_TOKENS = 2000;
// Functional docs are one long-form markdown report. A model that
// produces a complete report easily exceeds a small token budget; when the
// output is cut mid-report the document truncates mid-sentence. Request generous
// headroom (well within the default model's practical output cap); the backend
// clamps to its own MAX_TOKENS_CEILING, so a too-high value here is safe. Keep
// this in step with MAX_DOCUMENT_CHARS (chars must stay below tokens * ~4).
const FUNCTIONAL_ADVANCED_MAX_TOKENS = 16000;
// The long-form Advanced report can take noticeably longer to generate than a
// Design Review. Allow the client to wait out the backend's full budget instead
// of aborting at the default. Keep this just ABOVE the backend function
// `maxDuration` (currently 300s in vercel-backend/vercel.json) so the client
// receives the backend's own response/504 rather than aborting first. Raise
// both together if Advanced screens still time out.
const FUNCTIONAL_ADVANCED_TIMEOUT_MS = 310000;

// Export width balances vision legibility against payload size / token cost.
const ANALYZE_EXPORT_WIDTH = 1024;

function postProgress(
  phase: "exporting" | "analyzing" | "applying",
  message?: string
): void {
  figma.ui.postMessage({ type: "analyze-design-progress", phase, message });
}

function postError(message: string): void {
  figma.notify("Analyze Design: " + message, { error: true });
  figma.ui.postMessage({ type: "analyze-design-error", message });
}

function postResult(
  operation: ResultOperation,
  target: AnalyzeTarget,
  payload: {
    applied: string[];
    skipped: string[];
    cardName?: string;
    screenCount?: number;
    note?: string;
  }
): void {
  figma.ui.postMessage({
    type: "analyze-design-result",
    operation,
    target,
    applied: payload.applied || [],
    skipped: payload.skipped || [],
    cardName: payload.cardName,
    screenCount: payload.screenCount,
    note: payload.note,
  });
}

/** Yield to the event loop so a long section loop never freezes the canvas. */
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function screenLabel(name: string | undefined, index: number): string {
  return name || "Screen " + (index + 1);
}

function countLabel(n: number): string {
  return n + " screen" + (n === 1 ? "" : "s");
}

/** Text-only synthesis of Overview Header title + description from screen copy. */
async function applySectionMetaFromDescriptions(
  sectionId: string,
  descriptions: Array<{ name: string; description: string }>
): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];
  if (!descriptions.length) {
    skipped.push("Section summary");
    return { applied, skipped };
  }

  postProgress("analyzing", "Writing section summary\u2026");
  try {
    const data = await requestAnalyzeDesign({
      systemContext: buildSectionMetaSystemContext(),
      instruction: buildSectionMetaInstruction(descriptions),
    });
    const v = validateSectionMeta(data.content);
    if (v.ok) {
      const metaResult = await osApplySectionMeta(sectionId, v.value);
      const metaApplied = (metaResult && metaResult.applied) || [];
      const metaSkipped = (metaResult && metaResult.skipped) || [];
      for (let j = 0; j < metaApplied.length; j++) applied.push(metaApplied[j]);
      for (let j = 0; j < metaSkipped.length; j++) skipped.push(metaSkipped[j]);
      if (metaApplied.indexOf("Section title") === -1) {
        const fallback = osBuildSectionMetaFallback(descriptions);
        if (fallback) {
          const fbResult = await osApplySectionMeta(sectionId, fallback);
          const fbApplied = (fbResult && fbResult.applied) || [];
          for (let k = 0; k < fbApplied.length; k++) {
            if (applied.indexOf(fbApplied[k]) === -1) applied.push(fbApplied[k]);
          }
        }
      }
    } else {
      console.warn("[analyze-design] section summary invalid:", v.error);
      const fallback = osBuildSectionMetaFallback(descriptions);
      if (fallback) {
        const fbResult = await osApplySectionMeta(sectionId, fallback);
        const fbApplied = (fbResult && fbResult.applied) || [];
        const fbSkipped = (fbResult && fbResult.skipped) || [];
        for (let k = 0; k < fbApplied.length; k++) applied.push(fbApplied[k]);
        for (let k = 0; k < fbSkipped.length; k++) skipped.push(fbSkipped[k]);
        if (!fbApplied.length) skipped.push("Section summary");
      } else {
        skipped.push("Section summary");
      }
    }
  } catch (e: any) {
    console.warn("[analyze-design] section summary failed:", (e && e.message) || e);
    const fallback = osBuildSectionMetaFallback(descriptions);
    if (fallback) {
      try {
        const fbResult = await osApplySectionMeta(sectionId, fallback);
        const fbApplied = (fbResult && fbResult.applied) || [];
        for (let k = 0; k < fbApplied.length; k++) applied.push(fbApplied[k]);
        if (!fbApplied.length) skipped.push("Section summary");
      } catch (e2: any) {
        skipped.push("Section summary");
      }
    } else {
      skipped.push("Section summary");
    }
  }
  return { applied, skipped };
}

interface JourneyScreen {
  cardId: string;
  name: string;
}
interface FlowEdge {
  from: string;
  to: string;
  trigger?: string;
}

interface ScreenRef {
  sectionId: string;
  cardId: string;
  frameId: string;
  cardName?: string;
  frameName?: string;
  existingDescription?: string;
  // Cross-screen journey context (functional docs only). Shared by
  // every screen in a run; `cardId` identifies which entry is current.
  journeyScreens?: JourneyScreen[];
  flowEdges?: FlowEdge[];
}

type OneScreenResult =
  | {
      ok: true;
      applied: string[];
      skipped: string[];
      description: string;
      note?: string;
      // True when the card was built by an older plugin version: the summary
      // had content but none of its fields exist on the card, so nothing
      // rendered (the full report is still stored/downloadable).
      stale?: boolean;
    }
  | { ok: false; error: string; skippedReason?: string };

// Export -> scoped Bonzai vision call -> validate -> apply, for one screen.
// Network/validation errors are returned (not thrown) so the section loop can
// count them as skipped and continue. Re-resolves the frame by id. The
// `binding` selects the prompt/validator (mode) and the engine apply function,
// so design review and functional documentation share this exact pipeline.
async function analyzeOneScreen(
  screen: ScreenRef,
  binding: AnalysisBinding
): Promise<OneScreenResult> {
  const frame = await figma.getNodeByIdAsync(screen.frameId);
  if (!frame || frame.removed || !("exportAsync" in frame)) {
    return { ok: false, error: "The screen to analyze is no longer available." };
  }

  let bytes: Uint8Array;
  try {
    bytes = await (frame as ExportMixin).exportAsync({
      format: "PNG",
      constraint: { type: "WIDTH", value: ANALYZE_EXPORT_WIDTH },
    });
  } catch (e: any) {
    return { ok: false, error: "Could not export this screen: " + ((e && e.message) || "unknown error") };
  }
  if (!bytes || !bytes.length) {
    return { ok: false, error: "Exported screen was empty." };
  }

  const data = await requestAnalyzeDesign({
    imageBase64: customBase64Encode(bytes),
    mimeType: "image/png",
    systemContext: binding.mode.buildSystemContext(binding.scope),
    instruction: binding.mode.buildInstruction(binding.scope, {
      frameName: screen.frameName,
      cardTitle: screen.cardName,
      existingDescription: screen.existingDescription,
      journeyScreens: screen.journeyScreens,
      flowEdges: screen.flowEdges,
      currentCardId: screen.cardId,
    }),
    max_tokens: binding.maxTokens,
    timeoutMs: binding.timeoutMs,
    responseFormat: binding.responseFormat,
  });

  const validation = binding.mode.validate(data.content);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error,
      skippedReason: validation.skippedReason,
    };
  }

  const result = await binding.apply(
    screen.sectionId,
    screen.cardId,
    validation.value
  );
  return {
    ok: true,
    applied: (result && result.applied) || [],
    skipped: (result && result.skipped) || [],
    description: (validation.value as { cardDescription?: string }).cardDescription || "",
  };
}

// Binding for the design-review path: scope-aware mode + apply that forwards the
// scope so the engine narrows the write exactly as before.
function designReviewBinding(scope: AnalyzeScope): AnalysisBinding {
  return {
    scope,
    mode: designReviewMode,
    apply: (sectionId, cardId, value) =>
      osApplyDesignReviewAnalysis(sectionId, cardId, value, scope),
  };
}

// Two-pass functional documentation for one screen:
//   Pass 1 — vision call -> full long-form markdown report (text mode, raised
//            token + timeout budget). On failure, return the error and write
//            nothing (never clobber an existing doc).
//   Pass 2 — text-only call -> the fixed 5-field canvas summary (JSON). On
//            failure, degrade: still store the report (download stays intact)
//            and write a short "Summary unavailable" note into the Overview.
// The single `osApplyFunctionalAnalysis` call stores the report FIRST, then
// renders the summary fields, so the export is intact regardless of pass 2.
async function documentOneScreen(screen: ScreenRef): Promise<OneScreenResult> {
  const frame = await figma.getNodeByIdAsync(screen.frameId);
  if (!frame || frame.removed || !("exportAsync" in frame)) {
    return { ok: false, error: "The screen to document is no longer available." };
  }

  let bytes: Uint8Array;
  try {
    bytes = await (frame as ExportMixin).exportAsync({
      format: "PNG",
      constraint: { type: "WIDTH", value: ANALYZE_EXPORT_WIDTH },
    });
  } catch (e: any) {
    return {
      ok: false,
      error: "Could not export this screen: " + ((e && e.message) || "unknown error"),
    };
  }
  if (!bytes || !bytes.length) {
    return { ok: false, error: "Exported screen was empty." };
  }
  const imageBase64 = customBase64Encode(bytes);

  // Pass 1: vision -> full markdown report.
  const pass1 = await requestAnalyzeDesign({
    imageBase64,
    mimeType: "image/png",
    systemContext: functionalAdvancedMode.buildSystemContext(),
    instruction: functionalAdvancedMode.buildInstruction(undefined, {
      frameName: screen.frameName,
      cardTitle: screen.cardName,
      existingDescription: screen.existingDescription,
      journeyScreens: screen.journeyScreens,
      flowEdges: screen.flowEdges,
      currentCardId: screen.cardId,
    }),
    max_tokens: FUNCTIONAL_ADVANCED_MAX_TOKENS,
    timeoutMs: FUNCTIONAL_ADVANCED_TIMEOUT_MS,
    responseFormat: "text",
  });
  const v1 = functionalAdvancedMode.validate(pass1.content);
  if (!v1.ok) {
    return { ok: false, error: v1.error, skippedReason: v1.skippedReason };
  }
  const markdown = (v1.value as { document: string }).document;

  // Pass 2: text-only -> 5-field canvas summary. Degrade gracefully on failure.
  let summary: FunctionalSummaryV1 | undefined;
  let note = "";
  try {
    const pass2 = await requestAnalyzeDesign({
      systemContext: buildFunctionalSummarySystemContext(),
      instruction: buildFunctionalSummaryInstruction(markdown),
      max_tokens: FUNCTIONAL_SUMMARY_MAX_TOKENS,
    });
    const v2 = validateFunctionalSummary(pass2.content);
    if (v2.ok) {
      summary = v2.value;
    } else {
      note = "Summary unavailable - see the downloaded document.";
      console.warn("[create-documentation] summary invalid:", v2.error);
    }
  } catch (e: any) {
    note = "Summary unavailable - see the downloaded document.";
    console.warn(
      "[create-documentation] summary failed:",
      (e && e.message) || e
    );
  }

  // On a degraded pass 2, still render a minimal summary so the canvas reflects
  // the state; the full report is stored regardless.
  if (!summary) {
    summary = {
      overview: note,
      relatedScreens: [],
      businessSummary: [],
      workflows: [],
      functionalRequirements: [],
    };
  }

  const result = await osApplyFunctionalAnalysis(screen.sectionId, screen.cardId, {
    document: markdown,
    summary,
  });

  // Stale-structure guard: the markdown stored fine but the summary fields could
  // not be found on the card (it was built by an older plugin version). Surface
  // a clear, actionable note instead of silently reporting a blank "success".
  const stale = !!(result && result.staleStructure);
  if (stale) {
    note =
      "This screen's card is from an older board structure, so the documentation could not be shown on canvas. Recompose the board (Organize Screens \u2192 Apply) or recreate it, then run Create Documentation again. The full report was saved and is still downloadable.";
  }

  return {
    ok: true,
    applied: (result && result.applied) || [],
    skipped: (result && result.skipped) || [],
    description: "",
    note: note || undefined,
    stale,
  };
}

async function runAnalyzeCard(scope: AnalyzeScope): Promise<void> {
  const target = osResolveAnalyzeDesignTarget();
  if (!target || target.eligible !== true) {
    postError((target && target.reason) || "This selection can't be analyzed.");
    return;
  }

  postProgress(
    "analyzing",
    scope === "describe" ? "Describing screen\u2026" : "Reviewing design\u2026"
  );

  const r = await analyzeOneScreen(
    {
      sectionId: target.sectionId,
      cardId: target.cardId,
      frameId: target.frameId,
      cardName: target.cardName,
      frameName: target.frameName,
      existingDescription: target.existingDescription,
    },
    designReviewBinding(scope)
  );

  if (!r.ok) {
    const why = r.skippedReason
      ? "The model declined to analyze this screen: " + r.skippedReason
      : "Analysis returned an invalid format: " + r.error;
    console.warn("[analyze-design] invalid analysis:", r.error);
    postError(why);
    return;
  }

  const applied = (r.applied || []).slice();
  const skipped = (r.skipped || []).slice();

  // Card-scope Describe also updates the section Overview Header (title +
  // description) from the screen copy, same synthesis path as section scope.
  if (scope === "describe" && r.description) {
    const meta = await applySectionMetaFromDescriptions(target.sectionId, [
      {
        name: target.cardName || target.frameName || "Screen",
        description: r.description,
      },
    ]);
    for (let j = 0; j < meta.applied.length; j++) applied.push(meta.applied[j]);
    for (let j = 0; j < meta.skipped.length; j++) skipped.push(meta.skipped[j]);
  }

  postResult(scope, "card", {
    applied,
    skipped,
    cardName: target.cardName,
  });
  pushSelectionContexts();
}

async function runAnalyzeSection(scope: AnalyzeScope): Promise<void> {
  const target = osResolveAnalyzeDesignSectionTarget();
  if (!target || target.eligible !== true) {
    postError((target && target.reason) || "This selection can't be analyzed.");
    return;
  }

  const screens = target.screens || [];
  const appliedScreens: string[] = [];
  const skippedScreens: string[] = [];

  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    const label = screenLabel(s.cardName, i);
    postProgress(
      "analyzing",
      (scope === "describe" ? "Describing" : "Reviewing") +
        " screen " +
        (i + 1) +
        " of " +
        screens.length +
        "\u2026"
    );

    try {
      const r = await analyzeOneScreen(
        {
          sectionId: target.sectionId,
          cardId: s.cardId,
          frameId: s.frameId,
          cardName: s.cardName,
          frameName: s.frameName,
        },
        designReviewBinding(scope)
      );
      if (r.ok) {
        appliedScreens.push(label);
      } else {
        skippedScreens.push(label);
      }
    } catch (e: any) {
      console.warn("[analyze-design] screen failed:", (e && e.message) || e);
      skippedScreens.push(label);
    }

    await yieldToLoop();
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  if (appliedScreens.length) applied.push(countLabel(appliedScreens.length));
  if (skippedScreens.length) skipped.push(countLabel(skippedScreens.length));

  // Section summary: only for describe. Re-read live Card Description text
  // after the per-screen loop (canvas is canonical across network awaits).
  if (scope === "describe") {
    const descriptions = await osCollectSectionDescribeSummaries(screens);
    const meta = await applySectionMetaFromDescriptions(
      target.sectionId,
      descriptions
    );
    for (let j = 0; j < meta.applied.length; j++) applied.push(meta.applied[j]);
    for (let j = 0; j < meta.skipped.length; j++) skipped.push(meta.skipped[j]);
  }

  postResult(scope, "section", {
    applied,
    skipped,
    cardName: target.sectionName,
    screenCount: screens.length,
  });
  pushSelectionContexts();
}

export async function runAnalyzeDesign(
  scope: AnalyzeScope,
  target: AnalyzeTarget
): Promise<void> {
  const safeScope: AnalyzeScope = scope === "describe" ? "describe" : "review";
  const safeTarget: AnalyzeTarget = target === "section" ? "section" : "card";
  try {
    if (safeTarget === "section") {
      await runAnalyzeSection(safeScope);
    } else {
      await runAnalyzeCard(safeScope);
    }
  } catch (error: any) {
    postError((error && error.message) || String(error));
  }
}

// Offline reset of the review section back to placeholder text. No export, no
// network. Card scope resets one card; section scope loops every screen.
export async function runResetReview(target: AnalyzeTarget): Promise<void> {
  const safeTarget: AnalyzeTarget = target === "section" ? "section" : "card";
  try {
    if (safeTarget === "section") {
      const t = osResolveAnalyzeDesignSectionTarget();
      if (!t || t.eligible !== true) {
        postError((t && t.reason) || "This selection can't be reset.");
        return;
      }
      const screens = t.screens || [];
      const done: string[] = [];
      const failed: string[] = [];
      for (let i = 0; i < screens.length; i++) {
        const s = screens[i];
        postProgress(
          "applying",
          "Resetting screen " + (i + 1) + " of " + screens.length + "\u2026"
        );
        try {
          await osResetDesignReviewFields(t.sectionId, s.cardId);
          done.push(screenLabel(s.cardName, i));
        } catch (e: any) {
          console.warn("[reset-review] screen failed:", (e && e.message) || e);
          failed.push(screenLabel(s.cardName, i));
        }
        await yieldToLoop();
      }
      const applied: string[] = [];
      const skipped: string[] = [];
      if (done.length) applied.push(countLabel(done.length));
      if (failed.length) skipped.push(countLabel(failed.length));
      postResult("resetReview", "section", {
        applied,
        skipped,
        cardName: t.sectionName,
        screenCount: screens.length,
      });
      pushSelectionContexts();
      return;
    }

    const target2 = osResolveAnalyzeDesignTarget();
    if (!target2 || target2.eligible !== true) {
      postError((target2 && target2.reason) || "This selection can't be reset.");
      return;
    }
    postProgress("applying", "Resetting review\u2026");
    const result = await osResetDesignReviewFields(target2.sectionId, target2.cardId);
    postResult("resetReview", "card", {
      applied: (result && result.applied) || [],
      skipped: (result && result.skipped) || [],
      cardName: target2.cardName,
    });
    pushSelectionContexts();
  } catch (error: any) {
    postError((error && error.message) || String(error));
  }
}

// ---------------------------------------------------------------------------
// Create Documentation (Functional Analysis). Reuses the export -> call ->
// validate -> apply pipeline via the functional binding. After writing, runs
// synthesize the section Overview Header (title + description) from the
// long-form document on the documented cards, reusing the same
// section-meta path as Describe.
// ---------------------------------------------------------------------------

async function runDocumentCard(): Promise<void> {
  const target = osResolveCreateDocumentationTarget();
  if (!target || target.eligible !== true) {
    postError((target && target.reason) || "This selection can't be documented.");
    return;
  }

  postProgress("analyzing", "Documenting screen\u2026");

  // A single-screen run still gets the board's other screens as journey context
  // (same helper as section scope), so the report can reference its neighbors.
  // Skipped when the board has only this one functional screen.
  let journeyScreens: JourneyScreen[] | undefined;
  let flowEdges: FlowEdge[] | undefined;
  try {
    const journey = await osBuildFunctionalJourneyContext(target.sectionId);
    if (journey && journey.screens && journey.screens.length > 1) {
      journeyScreens = journey.screens;
      flowEdges = journey.edges;
    }
  } catch (e: any) {
    console.warn(
      "[create-documentation] journey context failed:",
      (e && e.message) || e
    );
  }

  const r = await documentOneScreen({
    sectionId: target.sectionId,
    cardId: target.cardId,
    frameId: target.frameId,
    cardName: target.cardName,
    frameName: target.frameName,
    journeyScreens,
    flowEdges,
  });

  if (!r.ok) {
    const why = r.skippedReason
      ? "The model declined to document this screen: " + r.skippedReason
      : "Documentation returned an invalid format: " + r.error;
    console.warn("[create-documentation] invalid result:", r.error);
    postError(why);
    return;
  }

  const applied = (r.applied || []).slice();
  const skipped = (r.skipped || []).slice();

  // Card-scope docs also refresh the section Overview Header (title +
  // description) from this screen's stored report, the same synthesis path as
  // section scope and as the Describe action on Design Review boards.
  const summaries = await osCollectSectionFunctionalSummaries([
    { cardId: target.cardId, cardName: target.cardName },
  ]);
  if (summaries.length) {
    const meta = await applySectionMetaFromDescriptions(
      target.sectionId,
      summaries
    );
    for (let j = 0; j < meta.applied.length; j++) applied.push(meta.applied[j]);
    for (let j = 0; j < meta.skipped.length; j++) skipped.push(meta.skipped[j]);
  }

  if (r.stale && r.note) {
    figma.notify("Create Documentation: " + r.note, { error: true });
  }

  postResult("document", "card", {
    applied,
    skipped,
    cardName: target.cardName,
    note: r.note,
  });
  pushSelectionContexts();
}

async function runDocumentSection(): Promise<void> {
  const target = osResolveCreateDocumentationSectionTarget();
  if (!target || target.eligible !== true) {
    postError((target && target.reason) || "This selection can't be documented.");
    return;
  }

  const screens = target.screens || [];
  const appliedScreens: string[] = [];
  const skippedScreens: string[] = [];
  // Capture WHY screens were skipped so a section run never fails silently:
  // without this the model returning an invalid/declined result for every
  // screen looks identical to "nothing happened" (the progress counter just
  // reaches the end). The first failure reason represents the dominant cause.
  let firstFailReason = "";
  let firstDeclineReason = "";
  let nothingWrittenCount = 0;
  let firstSummaryNote = "";
  let staleCount = 0;

  // Docs get cross-screen journey context (the other screens in this run + any
  // Flow connections) so the model documents journeys instead of reporting
  // downstream screens as unavailable. Built once and shared.
  let journeyScreens: JourneyScreen[] | undefined;
  let flowEdges: FlowEdge[] | undefined;
  try {
    const journey = await osBuildFunctionalJourneyContext(target.sectionId);
    if (journey && journey.screens && journey.screens.length > 1) {
      journeyScreens = journey.screens;
      flowEdges = journey.edges;
    }
  } catch (e: any) {
    console.warn(
      "[create-documentation] journey context failed:",
      (e && e.message) || e
    );
  }

  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    const label = screenLabel(s.cardName, i);
    postProgress(
      "analyzing",
      "Documenting screen " + (i + 1) + " of " + screens.length + "\u2026"
    );

    try {
      const r = await documentOneScreen({
        sectionId: target.sectionId,
        cardId: s.cardId,
        frameId: s.frameId,
        cardName: s.cardName,
        frameName: s.frameName,
        journeyScreens,
        flowEdges,
      });
      if (r.ok) {
        // Validation passed but the engine wrote nothing back (e.g. the card's
        // structure did not match the returned shape). Count it as skipped so
        // it is never reported as a success.
        if (r.applied && r.applied.length) appliedScreens.push(label);
        else {
          skippedScreens.push(label);
          nothingWrittenCount += 1;
        }
        if (r.stale) staleCount += 1;
        if (r.note && !firstSummaryNote) firstSummaryNote = r.note;
      } else {
        skippedScreens.push(label);
        if (r.skippedReason && !firstDeclineReason) {
          firstDeclineReason = r.skippedReason;
        } else if (r.error && !firstFailReason) {
          firstFailReason = r.error;
        }
      }
    } catch (e: any) {
      const msg = (e && e.message) || String(e);
      console.warn("[create-documentation] screen failed:", msg);
      skippedScreens.push(label);
      if (!firstFailReason) firstFailReason = msg;
    }

    await yieldToLoop();
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  if (appliedScreens.length) applied.push(countLabel(appliedScreens.length));
  if (skippedScreens.length) skipped.push(countLabel(skippedScreens.length));

  // Section summary: feed the Overview Header title + description from the
  // documented Functional Cards' stored reports, the same synthesis path the
  // Describe action uses for Design Review boards. Read live after the loop so
  // freshly written content is included; skipped when no report text exists.
  const summaries = await osCollectSectionFunctionalSummaries(screens);
  if (summaries.length) {
    const meta = await applySectionMetaFromDescriptions(
      target.sectionId,
      summaries
    );
    for (let j = 0; j < meta.applied.length; j++) applied.push(meta.applied[j]);
    for (let j = 0; j < meta.skipped.length; j++) skipped.push(meta.skipped[j]);
  }

  // Surface the dominant failure reason when screens were skipped, so the user
  // gets an actionable message instead of a silent empty result.
  let note = "";
  if (skippedScreens.length) {
    if (firstDeclineReason) {
      note = "The model declined to document some screens: " + firstDeclineReason;
    } else if (firstFailReason) {
      note = "Some screens returned an invalid format: " + firstFailReason;
    } else if (nothingWrittenCount === skippedScreens.length) {
      note =
        "The documentation came back but did not match these cards' fields, so nothing was written.";
    }
    if (!appliedScreens.length && note) {
      figma.notify("Create Documentation: " + note, { error: true });
    }
  }
  // No hard failures, but at least one screen's canvas summary degraded: the
  // reports were stored (download intact), only the on-canvas summary is missing.
  if (!note && firstSummaryNote) {
    note = firstSummaryNote;
  }

  // Stale-structure screens render nothing even though the run "succeeded"
  // (the markdown is stored). Surface it loudly so a board built by an older
  // plugin version is never mistaken for a silent no-op.
  if (staleCount > 0) {
    figma.notify(
      "Create Documentation: " +
        staleCount +
        " of " +
        screens.length +
        " cards are from an older board structure and could not render. Recompose the board (Organize Screens \u2192 Apply) or recreate it, then run again. Reports were saved and are downloadable.",
      { error: true }
    );
  }

  postResult("document", "section", {
    applied,
    skipped,
    cardName: target.sectionName,
    screenCount: screens.length,
    note: note || undefined,
  });
  pushSelectionContexts();
}

export async function runCreateDocumentation(target: AnalyzeTarget): Promise<void> {
  const safeTarget: AnalyzeTarget = target === "section" ? "section" : "card";
  try {
    if (safeTarget === "section") {
      await runDocumentSection();
    } else {
      await runDocumentCard();
    }
  } catch (error: any) {
    postError((error && error.message) || String(error));
  }
}

// Offline reset of the functional section fields back to placeholder text. No
// export, no network. Card scope resets one card; section scope loops.
export async function runResetDocumentation(target: AnalyzeTarget): Promise<void> {
  const safeTarget: AnalyzeTarget = target === "section" ? "section" : "card";
  try {
    if (safeTarget === "section") {
      const t = osResolveCreateDocumentationSectionTarget();
      if (!t || t.eligible !== true) {
        postError((t && t.reason) || "This selection can't be reset.");
        return;
      }
      const screens = t.screens || [];
      const done: string[] = [];
      const failed: string[] = [];
      for (let i = 0; i < screens.length; i++) {
        const s = screens[i];
        postProgress(
          "applying",
          "Resetting screen " + (i + 1) + " of " + screens.length + "\u2026"
        );
        try {
          await osResetFunctionalFields(t.sectionId, s.cardId);
          done.push(screenLabel(s.cardName, i));
        } catch (e: any) {
          console.warn("[reset-documentation] screen failed:", (e && e.message) || e);
          failed.push(screenLabel(s.cardName, i));
        }
        await yieldToLoop();
      }
      const applied: string[] = [];
      const skipped: string[] = [];
      if (done.length) applied.push(countLabel(done.length));
      if (failed.length) skipped.push(countLabel(failed.length));
      postResult("resetDocumentation", "section", {
        applied,
        skipped,
        cardName: t.sectionName,
        screenCount: screens.length,
      });
      pushSelectionContexts();
      return;
    }

    const target2 = osResolveCreateDocumentationTarget();
    if (!target2 || target2.eligible !== true) {
      postError((target2 && target2.reason) || "This selection can't be reset.");
      return;
    }
    postProgress("applying", "Resetting documentation\u2026");
    const result = await osResetFunctionalFields(target2.sectionId, target2.cardId);
    postResult("resetDocumentation", "card", {
      applied: (result && result.applied) || [],
      skipped: (result && result.skipped) || [],
      cardName: target2.cardName,
    });
    pushSelectionContexts();
  } catch (error: any) {
    postError((error && error.message) || String(error));
  }
}

// Export functional documentation. The engine gathers the markdown
// from the selected cards (or the whole board) on the current selection; this
// function forwards plain { name, content } strings to the UI, which owns the
// zip + download (DOM/Blob/URL only exist in the iframe). No network, no
// closePlugin. Always posts exactly one terminal message (a result — including
// the empty case — or an error) so the UI never stays stuck in "exporting".
export async function runExportDocumentation(): Promise<void> {
  try {
    const collected = osCollectFunctionalDocuments();
    if (!collected || collected.eligible !== true) {
      postError((collected && collected.reason) || "This selection can't be exported.");
      return;
    }

    const documents: Array<{ name: string; document: string }> =
      collected.documents || [];
    const files = documents.map((d) => ({ name: d.name, document: d.document }));
    const base = (collected.sectionName || "functional").trim() || "functional";
    const zipName = base + "-functional-docs";

    if (!files.length) {
      figma.notify("No documentation to export yet.");
    }

    figma.ui.postMessage({
      type: "export-documentation-result",
      files: files.map((f) => ({ name: f.name, content: f.document })),
      zipName,
    });
  } catch (error: any) {
    postError((error && error.message) || String(error));
  }
}
