// @ts-nocheck
/**
 * Skill lane runtime helpers. Triggered by `run-skill` / `apply-board-changes`
 * messages from the UI; never routed through the MCP command dispatcher.
 *
 * `ensureFigmaEditor` short-circuits skills that assume Figma FrameNodes
 * (Organize Screens today) when the plugin is loaded into FigJam. The
 * manifest declares both editors so the WebSocket relay keeps working;
 * the gate here is the runtime half of that contract per
 * `.cursor/rules/figma-plugin-editor-gates.mdc`.
 */

import {
  organizeScreensFromSelection,
  osApplyBoardEdit,
  osResetBoardToScreens,
} from "../engine-inline";
import { pushSelectionContexts } from "./selection-probes";

export function ensureFigmaEditor(): boolean {
  if (figma.editorType === "figma") return true;
  figma.notify("Organize Screens runs in the Figma editor only.", {
    error: true,
  });
  return false;
}

export async function runSkill(skill: string, params: any): Promise<void> {
  if (skill === "organize-screens") {
    if (!ensureFigmaEditor()) {
      figma.ui.postMessage({
        type: "skill-error",
        skill: "organize-screens",
        error: "This skill runs in the Figma editor only.",
      });
      return;
    }
    try {
      const result = await organizeScreensFromSelection(params || {});
      figma.ui.postMessage({
        type: "skill-result",
        skill: "organize-screens",
        result,
      });
      // Selection is usually the new section; push edit context immediately so
      // the panel does not stay on compose/idle until the next debounced probe.
      pushSelectionContexts();
    } catch (error) {
      const message = (error && error.message) || String(error);
      figma.notify("Organize Screens failed: " + message, { error: true });
      figma.ui.postMessage({
        type: "skill-error",
        skill: "organize-screens",
        error: message,
      });
    }
    return;
  }

  figma.ui.postMessage({
    type: "skill-error",
    skill: String(skill),
    error: "Unknown skill: " + String(skill),
  });
}

export async function applyBoardEdit(
  sectionId: string,
  params: any
): Promise<void> {
  if (!ensureFigmaEditor()) {
    figma.ui.postMessage({
      type: "skill-error",
      skill: "organize-screens",
      error: "Editing runs in the Figma editor only.",
    });
    return;
  }
  try {
    const result = await osApplyBoardEdit(sectionId, params || {});
    figma.ui.postMessage({
      type: "skill-result",
      skill: "organize-screens",
      result,
    });
    // Push fresh context so the UI re-renders with the new metadata.
    pushSelectionContexts();
  } catch (error) {
    const message = (error && error.message) || String(error);
    figma.notify("Organize Screens edit failed: " + message, { error: true });
    figma.ui.postMessage({
      type: "skill-error",
      skill: "organize-screens",
      error: message,
    });
  }
}

export async function resetBoardToScreens(sectionId: string): Promise<void> {
  if (!ensureFigmaEditor()) {
    figma.ui.postMessage({
      type: "skill-error",
      skill: "organize-screens",
      error: "Editing runs in the Figma editor only.",
    });
    return;
  }
  try {
    const result = await osResetBoardToScreens(sectionId);
    figma.ui.postMessage({
      type: "skill-result",
      skill: "organize-screens",
      result,
    });
    // The board is gone; push fresh context so the panel leaves edit mode.
    pushSelectionContexts();
  } catch (error) {
    const message = (error && error.message) || String(error);
    figma.notify("Organize Screens reset failed: " + message, { error: true });
    figma.ui.postMessage({
      type: "skill-error",
      skill: "organize-screens",
      error: message,
    });
  }
}
