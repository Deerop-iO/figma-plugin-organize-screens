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
 *  - target "card": runs it once on the selected Screen Card.
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
} from "../engine-inline";
import { customBase64Encode } from "../lib/base64";
import { requestAnalyzeDesign } from "../lib/analyzeDesignClient";
import {
  designReviewMode,
  buildSectionMetaSystemContext,
  buildSectionMetaInstruction,
  validateSectionMeta,
} from "../analysis/designReview";
import { pushSelectionContexts } from "./selection-probes";

type AnalyzeScope = "describe" | "review";
type AnalyzeTarget = "card" | "section";
type ResultOperation = "describe" | "review" | "resetReview";

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
  payload: { applied: string[]; skipped: string[]; cardName?: string; screenCount?: number }
): void {
  figma.ui.postMessage({
    type: "analyze-design-result",
    operation,
    target,
    applied: payload.applied || [],
    skipped: payload.skipped || [],
    cardName: payload.cardName,
    screenCount: payload.screenCount,
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

interface ScreenRef {
  sectionId: string;
  cardId: string;
  frameId: string;
  cardName?: string;
  frameName?: string;
  existingDescription?: string;
}

type OneScreenResult =
  | { ok: true; applied: string[]; skipped: string[]; description: string }
  | { ok: false; error: string; skippedReason?: string };

// Export -> scoped Bonzai vision call -> validate -> apply, for one screen.
// Network/validation errors are returned (not thrown) so the section loop can
// count them as skipped and continue. Re-resolves the frame by id.
async function analyzeOneScreen(
  screen: ScreenRef,
  scope: AnalyzeScope
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
    systemContext: designReviewMode.buildSystemContext(scope),
    instruction: designReviewMode.buildInstruction(scope, {
      frameName: screen.frameName,
      cardTitle: screen.cardName,
      existingDescription: screen.existingDescription,
    }),
  });

  const validation = designReviewMode.validate(data.content);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error,
      skippedReason: validation.skippedReason,
    };
  }

  const result = await osApplyDesignReviewAnalysis(
    screen.sectionId,
    screen.cardId,
    validation.value,
    scope
  );
  return {
    ok: true,
    applied: (result && result.applied) || [],
    skipped: (result && result.skipped) || [],
    description: validation.value.cardDescription || "",
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
    scope
  );

  if (!r.ok) {
    const why = r.skippedReason
      ? "The model declined to analyze this screen: " + r.skippedReason
      : "Analysis returned an invalid format: " + r.error;
    console.warn("[analyze-design] invalid analysis:", r.error);
    postError(why);
    return;
  }

  postResult(scope, "card", {
    applied: r.applied,
    skipped: r.skipped,
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
  const descriptions: Array<{ name: string; description: string }> = [];

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
        scope
      );
      if (r.ok) {
        appliedScreens.push(label);
        if (scope === "describe" && r.description) {
          descriptions.push({ name: label, description: r.description });
        }
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

  // Section summary: only for describe, only when at least one screen produced
  // a description. Text-only call (no image) over the collected descriptions.
  if (scope === "describe") {
    if (descriptions.length) {
      postProgress("analyzing", "Writing section summary\u2026");
      try {
        const data = await requestAnalyzeDesign({
          systemContext: buildSectionMetaSystemContext(),
          instruction: buildSectionMetaInstruction(descriptions),
        });
        const v = validateSectionMeta(data.content);
        if (v.ok) {
          const metaResult = await osApplySectionMeta(target.sectionId, v.value);
          const metaApplied = (metaResult && metaResult.applied) || [];
          for (let j = 0; j < metaApplied.length; j++) applied.push(metaApplied[j]);
        } else {
          console.warn("[analyze-design] section summary invalid:", v.error);
          skipped.push("Section summary");
        }
      } catch (e: any) {
        console.warn("[analyze-design] section summary failed:", (e && e.message) || e);
        skipped.push("Section summary");
      }
    } else {
      skipped.push("Section summary");
    }
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
