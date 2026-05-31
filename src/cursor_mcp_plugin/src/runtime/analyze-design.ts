/**
 * Analyze Design runtime orchestration (code.ts lane).
 *
 * Shared core flow: resolve target -> export PNG -> call Bonzai vision backend
 * -> validate JSON -> apply to canvas. The engine owns selection resolution and
 * every canvas write; this module owns export, the network call, and
 * validation. Triggered by the `analyze-design` UI message; never routed
 * through the MCP command dispatcher.
 */

// @ts-nocheck
import {
  osResolveAnalyzeDesignTarget,
  osApplyDesignReviewAnalysis,
} from "../engine-inline";
import { customBase64Encode } from "../lib/base64";
import { requestAnalyzeDesign } from "../lib/analyzeDesignClient";
import { designReviewMode } from "../analysis/designReview";
import { pushSelectionContexts } from "./selection-probes";

// Export width balances vision legibility against payload size / token cost.
const ANALYZE_EXPORT_WIDTH = 1024;

function postProgress(phase: "exporting" | "analyzing" | "applying", message?: string): void {
  figma.ui.postMessage({ type: "analyze-design-progress", phase, message });
}

function postError(message: string): void {
  figma.notify("Analyze Design: " + message, { error: true });
  figma.ui.postMessage({ type: "analyze-design-error", message });
}

export async function runAnalyzeDesign(overwrite: boolean): Promise<void> {
  try {
    const target = osResolveAnalyzeDesignTarget();
    if (!target || target.eligible !== true) {
      postError((target && target.reason) || "This selection can't be analyzed.");
      return;
    }

    // 1. Export the embedded screen frame as a PNG (re-resolve by id).
    postProgress("exporting");
    const frame = await figma.getNodeByIdAsync(target.frameId);
    if (!frame || frame.removed || !("exportAsync" in frame)) {
      postError("The screen to analyze is no longer available.");
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = await (frame as ExportMixin).exportAsync({
        format: "PNG",
        constraint: { type: "WIDTH", value: ANALYZE_EXPORT_WIDTH },
      });
    } catch (e: any) {
      postError("Could not export this screen: " + ((e && e.message) || "unknown error"));
      return;
    }
    if (!bytes || !bytes.length) {
      postError("Exported screen was empty.");
      return;
    }
    const imageBase64 = customBase64Encode(bytes);

    // 2. Call the Bonzai vision backend.
    postProgress("analyzing");
    const data = await requestAnalyzeDesign({
      imageBase64,
      mimeType: "image/png",
      systemContext: designReviewMode.buildSystemContext(),
      instruction: designReviewMode.buildInstruction({
        frameName: target.frameName,
        cardTitle: target.cardName,
        existingDescription: target.existingDescription,
      }),
    });

    // 3. Validate the model output before any canvas write.
    const validation = designReviewMode.validate(data.content);
    if (!validation.ok) {
      const why = validation.skippedReason
        ? "The model declined to analyze this screen: " + validation.skippedReason
        : "Analysis returned an invalid format: " + validation.error;
      console.warn("[analyze-design] invalid analysis:", validation.error);
      postError(why);
      return;
    }

    // 4. Apply to the card (engine re-resolves nodes by id + loads fonts).
    postProgress("applying");
    const result = await osApplyDesignReviewAnalysis(
      target.sectionId,
      target.cardId,
      validation.value,
      overwrite === true
    );

    figma.ui.postMessage({
      type: "analyze-design-result",
      applied: result.applied || [],
      skipped: result.skipped || [],
      cardName: result.cardName || target.cardName,
    });

    // Refresh the panel so the new hasExistingContent state is reflected.
    pushSelectionContexts();
  } catch (error: any) {
    postError((error && error.message) || String(error));
  }
}
