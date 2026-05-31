#!/usr/bin/env node
/*
 * One-shot helper that pulls handler function bodies out of
 * `src/cursor_mcp_plugin/src/code.ts` into focused modules under
 * `src/mcp-handlers/`. The script is idempotent: it skips functions
 * that are no longer in code.ts. Run from the repo root via:
 *
 *   bun run scripts/extract-handlers.mjs
 *
 * Phase 3 of the maintainability backlog. After every successful run,
 * verify with `bun run build:plugin`.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const codePath = resolve(
  repoRoot,
  "src/cursor_mcp_plugin/src/code.ts"
);
const handlersDir = resolve(
  repoRoot,
  "src/cursor_mcp_plugin/src/mcp-handlers"
);

if (!existsSync(handlersDir)) {
  mkdirSync(handlersDir, { recursive: true });
}

/**
 * Each group definition:
 *   file:    target filename inside `handlersDir`
 *   header:  doc-comment placed at top of the output file
 *   imports: literal `import` lines for the output file
 *   funcs:   ordered list of top-level function names to extract
 */
const GROUPS = [
  {
    file: "geometry.ts",
    header:
      "Frame / rectangle creation, fill & stroke colour writes, corner radius,\n * and the generic node lifecycle ops (move / resize / delete / clone /\n * reparent / rename / focus / select). All design-only.",
    imports: [],
    funcs: [
      "createRectangle",
      "createFrame",
      "setFillColor",
      "setStrokeColor",
      "setCornerRadius",
      "moveNode",
      "resizeNode",
      "deleteNode",
      "deleteMultipleNodes",
      "cloneNode",
      "reparentNode",
      "setNodeName",
      "setFocus",
      "setSelections",
    ],
  },
  {
    file: "text.ts",
    header:
      "Text creation and text-mutation handlers. Always awaits\n * `figma.loadFontAsync()` before writing characters; the kit rule\n * forbids skipping it. `setCharacters` is imported from `lib/`.",
    imports: [
      'import { setCharacters } from "../lib/setCharacters";',
      'import { sendProgressUpdate, generateCommandId } from "../runtime/progress";',
      'import { delay } from "../lib/delay";',
    ],
    funcs: [
      "createText",
      "setTextContent",
      "scanTextNodes",
      "collectNodesToProcess",
      "processTextNode",
      "findTextNodes",
      "setMultipleTextContents",
    ],
  },
  {
    file: "components.ts",
    header:
      "Styles, local components, component instances, component creation\n * and Variant combination. Design-only Plugin API surface.",
    imports: [],
    funcs: [
      "getStyles",
      "getLocalComponents",
      "createComponentInstance",
      "createComponent",
      "combineAsVariants",
    ],
  },
  {
    file: "instance-overrides.ts",
    header:
      "Component-instance override read/write surface. The MCP dispatcher\n * resolves nodes by id, then hands them to these helpers.",
    imports: [],
    funcs: [
      "getInstanceOverrides",
      "getValidTargetInstances",
      "getSourceInstanceData",
      "setInstanceOverrides",
    ],
  },
  {
    file: "autolayout.ts",
    header:
      "Auto-layout writes. Each handler mutates a FrameNode/InstanceNode/\n * ComponentNode's auto-layout properties. Design-only.",
    imports: [],
    funcs: [
      "setLayoutMode",
      "setPadding",
      "setAxisAlign",
      "setLayoutSizing",
      "setItemSpacing",
    ],
  },
  {
    file: "variables.ts",
    header:
      "Variables API read and binding handlers. The MCP server's Zod\n * schemas constrain the parameter shape; see\n * `.cursor/rules/figma-plugin-variables.mdc` for the workflow.",
    imports: [],
    funcs: [
      "getLocalVariables",
      "setFillVariable",
      "setStrokeVariable",
      "setNumberVariable",
      "setCornerRadiusVariable",
    ],
  },
  {
    file: "annotations.ts",
    header:
      "Annotations and prototype-reaction reads. `getReactions` emits\n * progress updates and highlights matching nodes with a temporary\n * orange stroke.",
    imports: [
      'import { sendProgressUpdate, generateCommandId } from "../runtime/progress";',
    ],
    funcs: [
      "getAnnotations",
      "setAnnotation",
      "scanNodesByTypes",
      "findNodesByTypes",
      "setMultipleAnnotations",
      "getReactions",
    ],
  },
  {
    file: "figjam.ts",
    header:
      "FigJam-only handlers: default connector resolution, connector\n * cursor nodes, and connector creation. The dispatcher's editor\n * gate rejects these in the Figma design editor.",
    imports: [],
    funcs: ["setDefaultConnector", "createCursorNode", "createConnections"],
  },
];

const src = readFileSync(codePath, "utf8");
const lines = src.split("\n");

// Index every top-level `async function`/`function` declaration.
// Function "body" runs from the `function` line through the matching
// closing brace at column 0. We rely on the kit's convention that all
// handlers in code.ts are top-level, single-block declarations.
function findFunctionRanges() {
  const ranges = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(async\s+)?function\s+(\w+)\s*\(/);
    if (!m) continue;
    const name = m[2];
    // Find matching brace.
    let depth = 0;
    let started = false;
    let end = i;
    for (let j = i; j < lines.length; j += 1) {
      const line = lines[j];
      for (let k = 0; k < line.length; k += 1) {
        const ch = line[k];
        if (ch === "{") {
          depth += 1;
          started = true;
        } else if (ch === "}") {
          depth -= 1;
          if (started && depth === 0) {
            end = j;
            k = line.length;
            j = lines.length;
            break;
          }
        }
      }
    }
    ranges.set(name, { start: i, end });
  }
  return ranges;
}

const ranges = findFunctionRanges();

// Track which line indices have been claimed by a group, so the final
// pass can zero them out in one swoop.
const claimedLines = new Set();

// Functions that should be removed from code.ts but live in `lib/` now
// instead of any handler group (e.g. `delay`).
const DELETE_ONLY = ["delay"];

for (const name of DELETE_ONLY) {
  const range = ranges.get(name);
  if (!range) continue;
  let blockStart = range.start;
  while (blockStart > 0) {
    const prev = lines[blockStart - 1];
    if (/^\s*\/\//.test(prev) || prev.trim() === "") {
      blockStart -= 1;
    } else {
      break;
    }
  }
  while (blockStart < range.start && lines[blockStart].trim() === "") {
    blockStart += 1;
  }
  for (let i = blockStart; i <= range.end; i += 1) claimedLines.add(i);
}

for (const group of GROUPS) {
  const collected = [];
  const all = group.funcs || [];

  for (const name of all) {
    const range = ranges.get(name);
    if (!range) {
      console.warn(
        "[extract-handlers] " + group.file + ": no function " + name +
          " found in code.ts (already extracted?)"
      );
      continue;
    }
    // Walk back for a preceding `//`-comment block as documentation.
    let blockStart = range.start;
    while (blockStart > 0) {
      const prev = lines[blockStart - 1];
      if (/^\s*\/\//.test(prev) || prev.trim() === "") {
        blockStart -= 1;
      } else {
        break;
      }
    }
    // Trim leading blank lines.
    while (blockStart < range.start && lines[blockStart].trim() === "") {
      blockStart += 1;
    }
    const body = lines.slice(blockStart, range.end + 1).join("\n");
    // Convert top-level `async function NAME(` -> `export async function NAME(`.
    const exported = body.replace(
      new RegExp(
        "^((?:async\\s+)?function\\s+" + name + "\\s*\\()",
        "m"
      ),
      "export $1"
    );
    collected.push(exported);
    for (let i = blockStart; i <= range.end; i += 1) claimedLines.add(i);
  }

  if (collected.length === 0) {
    console.warn(
      "[extract-handlers] " + group.file + " has no functions to extract; skipping"
    );
    continue;
  }

  const out = [
    "// @ts-nocheck",
    "/**",
    " * " + group.header.replace(/\n/g, "\n * "),
    " */",
    "",
    ...(group.imports || []),
    "",
    collected.join("\n\n"),
    "",
  ].join("\n");
  const target = resolve(handlersDir, group.file);
  writeFileSync(target, out, "utf8");
  console.log(
    "[extract-handlers] wrote " + group.file + " (" + collected.length + " fns)"
  );
}

// Reassemble code.ts without the claimed line ranges. Collapse runs of
// blank lines to a single blank to keep the file tidy.
const remaining = [];
let lastBlank = false;
for (let i = 0; i < lines.length; i += 1) {
  if (claimedLines.has(i)) continue;
  const line = lines[i];
  const blank = line.trim() === "";
  if (blank && lastBlank) continue;
  remaining.push(line);
  lastBlank = blank;
}
writeFileSync(codePath, remaining.join("\n"), "utf8");
console.log(
  "[extract-handlers] code.ts now " + remaining.length + " lines"
);
