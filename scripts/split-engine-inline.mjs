#!/usr/bin/env node
/**
 * One-time / maintenance helper: extract the ORGANIZE_SCREENS_ENGINE block
 * from code.ts into engine-inline.ts. Normal builds use build-plugin.js
 * to sync engine.js → engine-inline.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const codePath = resolve(repoRoot, "src/cursor_mcp_plugin/src/code.ts");
const inlinePath = resolve(repoRoot, "src/cursor_mcp_plugin/src/engine-inline.ts");

const START = "/* ORGANIZE_SCREENS_ENGINE:START */";
const END = "/* ORGANIZE_SCREENS_ENGINE:END */";

const codeSrc = readFileSync(codePath, "utf8");
const startIdx = codeSrc.indexOf(START);
const endIdx = codeSrc.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
  throw new Error("Engine markers not found in code.ts");
}

const engineBlock = codeSrc.slice(startIdx, endIdx + END.length);

const inlineFile =
  "// @ts-nocheck\n" +
  "// Organize Screens engine (injected from src/organize-screens/engine.js).\n" +
  "// Edit engine.js, then run: bun run build:plugin:engine\n" +
  "// Do NOT edit the block between START/END markers here.\n\n" +
  engineBlock +
  "\n\n" +
  "export {\n" +
  "  organizeScreensFromSelection,\n" +
  "  osProbeOrganizeScreensContext,\n" +
  "  osApplyBoardEdit,\n" +
  "};\n";

writeFileSync(inlinePath, inlineFile, "utf8");

const importBlock =
  "import {\n" +
  "  organizeScreensFromSelection,\n" +
  "  osProbeOrganizeScreensContext,\n" +
  "  osApplyBoardEdit,\n" +
  "} from \"./engine-inline\";\n" +
  "import { customBase64Encode } from \"./lib/base64\";\n" +
  "import { queueWrite, setClientStorage } from \"./lib/clientStorage\";\n" +
  "import { setCharacters } from \"./lib/setCharacters\";\n";

const newCodeSrc =
  codeSrc.slice(0, startIdx) +
  importBlock +
  "\n" +
  codeSrc.slice(endIdx + END.length);

writeFileSync(codePath, newCodeSrc, "utf8");
console.log("[split-engine-inline] Wrote engine-inline.ts and trimmed code.ts");
