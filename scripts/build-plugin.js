#!/usr/bin/env bun
// Injects src/organize-screens/engine.js between the
// ORGANIZE_SCREENS_ENGINE:START / END markers in
// src/cursor_mcp_plugin/src/engine-inline.ts.
//
// Run via: bun run build:plugin
//
// Source of truth: src/organize-screens/engine.js
// Do NOT edit the injected block in engine-inline.ts — edit engine.js
// and re-run this script.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const enginePath = resolve(repoRoot, "src/organize-screens/engine.js");
const inlinePath = resolve(
  repoRoot,
  "src/cursor_mcp_plugin/src/engine-inline.ts"
);
const legacyCodePath = resolve(
  repoRoot,
  "src/cursor_mcp_plugin/src/code.ts"
);

const START = "/* ORGANIZE_SCREENS_ENGINE:START */";
const END = "/* ORGANIZE_SCREENS_ENGINE:END */";

const EXPORT_FOOTER =
  "\n\nexport {\n" +
  "  organizeScreensFromSelection,\n" +
  "  osProbeOrganizeScreensContext,\n" +
  "  osApplyBoardEdit,\n" +
  "  osResetBoardToScreens,\n" +
  "  osResolveAnalyzeDesignTarget,\n" +
  "  osResolveAnalyzeDesignSectionTarget,\n" +
  "  osApplyDesignReviewAnalysis,\n" +
  "  osResetDesignReviewFields,\n" +
  "  osApplySectionMeta,\n" +
  "  osCollectSectionDescribeSummaries,\n" +
  "  osBuildSectionMetaFallback,\n" +
  "  osResolveCreateDocumentationTarget,\n" +
  "  osResolveCreateDocumentationSectionTarget,\n" +
  "  osBuildFunctionalJourneyContext,\n" +
  "  osCollectFunctionalDocuments,\n" +
  "  osCollectSectionFunctionalSummaries,\n" +
  "  osApplyFunctionalAnalysis,\n" +
  "  osResetFunctionalFields,\n" +
  "};\n";

function extractBetween(source, startMarker, endMarker) {
  const startIdx = source.indexOf(startMarker);
  const endIdx = source.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return null;
  }
  return source.slice(startIdx + startMarker.length, endIdx);
}

function injectBetween(source, startMarker, endMarker, payload) {
  const startIdx = source.indexOf(startMarker);
  const endIdx = source.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `Markers not found in target file. Expected ${startMarker} ... ${endMarker}.`
    );
  }
  return (
    source.slice(0, startIdx + startMarker.length) +
    payload +
    source.slice(endIdx)
  );
}

function stripExportFooter(source) {
  const exportIdx = source.indexOf("\nexport {\n  organizeScreensFromSelection");
  if (exportIdx === -1) return source;
  return source.slice(0, exportIdx);
}

function main() {
  if (!existsSync(enginePath)) {
    throw new Error(`Engine source not found at ${enginePath}`);
  }
  if (!existsSync(inlinePath)) {
    throw new Error(
      `engine-inline.ts not found at ${inlinePath}. Run scripts/split-engine-inline.mjs once.`
    );
  }

  // Fail fast if someone re-inlined the engine into code.ts.
  const codePeek = readFileSync(legacyCodePath, "utf8");
  if (codePeek.indexOf(START) !== -1) {
    throw new Error(
      "code.ts still contains ORGANIZE_SCREENS_ENGINE markers. " +
        "The engine belongs in engine-inline.ts only."
    );
  }

  const engineSrc = readFileSync(enginePath, "utf8");
  const engineBody = extractBetween(engineSrc, START, END);
  if (engineBody == null) {
    throw new Error(
      `Markers not found in engine.js. Expected ${START} ... ${END}.`
    );
  }

  let inlineSrc = readFileSync(inlinePath, "utf8");
  const currentBody = extractBetween(inlineSrc, START, END);

  if (currentBody !== null && currentBody !== engineBody) {
    console.warn(
      "[build-plugin] engine-inline.ts block differed from engine.js — syncing from engine.js"
    );
  }

  inlineSrc = stripExportFooter(inlineSrc);
  const updated = injectBetween(inlineSrc, START, END, engineBody) + EXPORT_FOOTER;

  if (updated === readFileSync(inlinePath, "utf8")) {
    console.log("[build-plugin] engine-inline.ts already in sync with engine.js");
    return;
  }

  writeFileSync(inlinePath, updated, "utf8");
  console.log("[build-plugin] Injected engine into engine-inline.ts");
}

main();
