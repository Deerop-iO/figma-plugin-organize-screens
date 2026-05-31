// @ts-nocheck
/**
 * Plugin runtime entry point.
 *
 * Three responsibilities:
 *   1. Mount the UI iframe (`showPluginUI`) and seed plugin-wide state
 *      (analytics client id, saved settings).
 *   2. Route messages from the UI through the typed contract in
 *      `./types.ts` — MCP relay lane (`execute-command`) and skill UI
 *      lane (`run-skill`, `apply-board-changes`).
 *   3. Wire the MCP dispatcher (`mcp-handlers/handle-command.ts`) to
 *      the handler modules under `mcp-handlers/` and register the
 *      selection-context probes under `runtime/selection-probes.ts`.
 *
 * Handler bodies, the engine, and selection probes all live in
 * dedicated modules; this file should stay bootstrap-only.
 */

import {
  organizeScreensFromSelection,
  osProbeOrganizeScreensContext,
} from "./engine-inline";
import { queueWrite } from "./lib/clientStorage";
import { createCommandDispatcher } from "./mcp-handlers/handle-command";
import {
  registerSelectionProbe,
  pushSelectionContexts,
  installSelectionProbeListener,
} from "./runtime/selection-probes";
import { state, updateSettings } from "./runtime/plugin-state";
import {
  ensureFigmaEditor,
  runSkill,
  applyBoardEdit,
  resetBoardToScreens,
} from "./runtime/skills";
import { runAnalyzeDesign, runResetReview } from "./runtime/analyze-design";
import {
  getDocumentInfo,
  getSelection,
  readMyDesign,
} from "./mcp-handlers/document";
import { getNodeInfo, getNodesInfo } from "./mcp-handlers/nodes";
import { exportNodeAsImage } from "./mcp-handlers/export";
import {
  createRectangle,
  createFrame,
  setFillColor,
  setStrokeColor,
  setCornerRadius,
  moveNode,
  resizeNode,
  deleteNode,
  deleteMultipleNodes,
  cloneNode,
  reparentNode,
  setNodeName,
  setFocus,
  setSelections,
} from "./mcp-handlers/geometry";
import {
  createText,
  setTextContent,
  scanTextNodes,
  setMultipleTextContents,
} from "./mcp-handlers/text";
import {
  getStyles,
  getLocalComponents,
  createComponentInstance,
  createComponent,
  combineAsVariants,
} from "./mcp-handlers/components";
import {
  getInstanceOverrides,
  getValidTargetInstances,
  getSourceInstanceData,
  setInstanceOverrides,
} from "./mcp-handlers/instance-overrides";
import {
  setLayoutMode,
  setPadding,
  setAxisAlign,
  setLayoutSizing,
  setItemSpacing,
} from "./mcp-handlers/autolayout";
import {
  getLocalVariables,
  setFillVariable,
  setStrokeVariable,
  setNumberVariable,
  setCornerRadiusVariable,
} from "./mcp-handlers/variables";
import {
  getAnnotations,
  setAnnotation,
  scanNodesByTypes,
  setMultipleAnnotations,
  getReactions,
} from "./mcp-handlers/annotations";
import {
  setDefaultConnector,
  createConnections,
} from "./mcp-handlers/figjam";

// Show UI. `themeColors: true` injects `--figma-color-*` into the iframe.
//
// The literal below is replaced with the full contents of dist/ui.html
// during `bun run build:plugin` (injectUiHtmlIntoCode in build-ui.mjs).
// Do not use the runtime `__html__` global: esbuild wraps this file in
// an IIFE and Figma's `__html__` is not visible inside that closure.
function showPluginUI() {
  try {
    figma.showUI("__FIGMA_UI_PLACEHOLDER__", {
      width: 380,
      height: 560,
      themeColors: true,
    });
  } catch (error) {
    const message =
      (error && error.message) ||
      "Plugin UI failed to load. Run bun run build:plugin and re-import the manifest.";
    console.error("showUI failed:", error);
    figma.notify(message, { error: true });
  }
}

showPluginUI();

// Initialize anonymous analytics client_id (persisted via clientStorage)
(async () => {
  try {
    await queueWrite(async () => {
      let clientId = await figma.clientStorage.getAsync("analyticsClientId");
      if (!clientId) {
        clientId =
          Date.now().toString(36) +
          "-" +
          Math.random().toString(36).slice(2, 10) +
          Math.random().toString(36).slice(2, 10);
        await figma.clientStorage.setAsync("analyticsClientId", clientId);
      }
      figma.ui.postMessage({ type: "analytics-client-id", clientId });
    });
  } catch (e) {
    console.error("analytics init failed:", e);
  }
})();

// Plugin commands from UI. Two lanes share this handler:
//
//  1. MCP relay lane (`execute-command` -> `command-result` /
//     `command-error`) shuttles opaque commands from the WebSocket
//     relay into `handleCommand`.
//  2. Skill UI lane (`run-skill` -> `skill-result` / `skill-error`)
//     is triggered by a user in a skill panel; we call the engine
//     directly without going through the MCP command dispatcher.
//
// Typed contract lives in `./types.ts`.
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "ui-ready":
      // UI just finished mounting; nothing to do here beyond ack
      // (analytics client id is pushed by the IIFE above).
      break;
    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      return;
    case "execute-command":
      // Execute commands received from UI (which gets them from WebSocket)
      try {
        const result = await handleCommand(msg.command, msg.params);
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          error: (error && error.message) || "Error executing command",
        });
      }
      break;
    case "run-skill":
      await runSkill(msg.skill, msg.params);
      break;
    case "probe-selection":
      pushSelectionContexts();
      break;
    case "apply-board-changes":
      await applyBoardEdit(msg.sectionId, msg.params);
      break;
    case "reset-board":
      await resetBoardToScreens(msg.sectionId);
      break;
    case "analyze-design":
      await runAnalyzeDesign(msg.scope, msg.target);
      break;
    case "reset-review":
      await runResetReview(msg.target);
      break;
  }
};

// Register selection probes. Each skill that wants selection-aware UI
// registers here; the runtime broadcasts every probe's result under a
// single `selection-contexts` message on every (debounced) selection
// change. Adding a new skill is a one-liner: `registerSelectionProbe`
// with its id and probe function.
registerSelectionProbe("organize-screens", osProbeOrganizeScreensContext);
installSelectionProbeListener();

// Listen for plugin commands from menu
figma.on("run", async ({ command }) => {
  figma.ui.postMessage({ type: "auto-connect" });

  if (command === "organize-screens") {
    if (!ensureFigmaEditor()) return;
    try {
      const result = await organizeScreensFromSelection({});
      const personalityLabel = result.personality
        ? " [" + result.personality + "]"
        : "";
      if (result.operation === "flowArrows") {
        figma.notify(
          "Organize Screens: drew " +
            result.arrowCount +
            " flow arrow(s)."
        );
      } else if (result.operation === "arrangeSectionsGrid") {
        figma.notify(
          "Organize Screens" +
            personalityLabel +
            ": arranged " +
            result.sectionCount +
            " section(s) in " +
            result.columns +
            " column(s) (" +
            result.sectionGridGap +
            "px gap, " +
            result.sectionHeight +
            "px height)."
        );
      } else {
        const strategy =
          (result.compositionPlanSummary &&
            result.compositionPlanSummary.strategy) ||
          result.gridOrientation;
        const variantCount =
          result.variantGroups && result.variantGroups.length
            ? result.variantGroups.length
            : 0;
        figma.notify(
          "Organize Screens" +
            personalityLabel +
            ": " +
            result.cardCount +
            " card(s), " +
            result.columns +
            " column(s), " +
            strategy +
            (variantCount > 0
              ? ", " + variantCount + " comparison group(s)"
              : "") +
            "."
        );
      }
    } catch (error) {
      const message = (error && error.message) || String(error);
      figma.notify("Organize Screens failed: " + message, { error: true });
    }
  }
});

// MCP command dispatcher. The switch + editor gate live in
// `mcp-handlers/handle-command.ts`. Handler bodies live in the
// `mcp-handlers/` modules imported above; this file just wires them
// into the dispatcher's handlers map.
const handleCommand = createCommandDispatcher({
  getDocumentInfo,
  getSelection,
  getNodeInfo,
  getNodesInfo,
  readMyDesign,
  scanTextNodes,
  scanNodesByTypes,
  getReactions,
  getStyles,
  getLocalComponents,
  getAnnotations,
  getLocalVariables,
  exportNodeAsImage,
  moveNode,
  resizeNode,
  deleteNode,
  deleteMultipleNodes,
  cloneNode,
  reparentNode,
  setNodeName,
  setFocus,
  setSelections,
  createRectangle,
  createFrame,
  createText,
  setFillColor,
  setStrokeColor,
  setCornerRadius,
  setTextContent,
  setMultipleTextContents,
  setAnnotation,
  setMultipleAnnotations,
  createComponentInstance,
  createComponent,
  combineAsVariants,
  getInstanceOverrides,
  getValidTargetInstances,
  getSourceInstanceData,
  setInstanceOverrides,
  setLayoutMode,
  setPadding,
  setAxisAlign,
  setLayoutSizing,
  setItemSpacing,
  setFillVariable,
  setStrokeVariable,
  setNumberVariable,
  setCornerRadiusVariable,
  setDefaultConnector,
  createConnections,
  organizeScreensFromSelection,
});

// Initialize settings on load
(async function initializePlugin() {
  try {
    const savedSettings = await figma.clientStorage.getAsync("settings");
    if (savedSettings) {
      if (savedSettings.serverPort) {
        state.serverPort = savedSettings.serverPort;
      }
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
})();

