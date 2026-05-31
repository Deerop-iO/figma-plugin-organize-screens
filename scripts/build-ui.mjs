#!/usr/bin/env node
// Bundles the Cursor MCP plugin UI + plugin runtime via esbuild.
//
// Figma loads the manifest `ui` file as __html__ (a string passed to
// figma.showUI). Relative <script src> / <link href> siblings do NOT
// load in that iframe, which produces a blank window. This script
// therefore inlines bundled ui.ts + styles.css into a single dist/ui.html.
//
// Inputs (under src/cursor_mcp_plugin/src/):
//   - code.ts (imports engine-inline.ts; see scripts/build-plugin.js)
//   - engine-inline.ts (engine injected from src/organize-screens/engine.js)
//   - ui.ts   (shell + router)
//   - styles.css
//
// Outputs (under src/cursor_mcp_plugin/dist/):
//   - code.js  (target=es2019, format=iife) -> manifest.main
//   - ui.html  (self-contained: inline <style> + <script>) -> manifest.ui
//
// Run via: bun run build:plugin

import { context, build } from "esbuild";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { watch as watchFile } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const pluginDir = resolve(repoRoot, "src/cursor_mcp_plugin");
const srcDir = resolve(pluginDir, "src");
const distDir = resolve(pluginDir, "dist");
const isWatch = process.argv.includes("--watch");

const commonOptions = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2019"],
  logLevel: "info",
  tsconfig: resolve(pluginDir, "tsconfig.json"),
};

const codeOptions = {
  ...commonOptions,
  platform: "neutral",
  sourcemap: true,
  entryPoints: [resolve(srcDir, "code.ts")],
  outfile: resolve(distDir, "code.js"),
};

const UI_HTML_PLACEHOLDER = "__FIGMA_UI_PLACEHOLDER__";

const uiBundlePath = resolve(distDir, "ui.bundle.js");

const uiOptions = {
  ...commonOptions,
  sourcemap: false,
  entryPoints: [resolve(srcDir, "ui.ts")],
  outfile: uiBundlePath,
};

/** Prevent `</script>` / `</style>` in inlined assets from breaking the HTML. */
function escapeForHtmlInline(content, closeTag) {
  const needle = "</" + closeTag + ">";
  const replacement = "<\\/" + closeTag + ">";
  return content.split(needle).join(replacement);
}

async function writeInlinedUiHtml() {
  const css = await readFile(resolve(srcDir, "styles.css"), "utf8");
  const js = await readFile(uiBundlePath, "utf8");

  const html =
    "<!doctype html>\n" +
    '<html lang="en">\n' +
    "  <head>\n" +
    '    <meta charset="utf-8" />\n' +
    "    <title>Talk To Figma MCP Plugin</title>\n" +
    "    <style>\n" +
    escapeForHtmlInline(css, "style") +
    "\n    </style>\n" +
    "  </head>\n" +
    "  <body>\n" +
    '    <div id="root" class="shell"></div>\n' +
    "    <script>\n" +
    escapeForHtmlInline(js, "script") +
    "\n    </script>\n" +
    "  </body>\n" +
    "</html>\n";

  await writeFile(resolve(distDir, "ui.html"), html, "utf8");
  const stalePaths = [
    uiBundlePath,
    resolve(distDir, "ui.js"),
    resolve(distDir, "ui.js.map"),
    resolve(distDir, "styles.css"),
  ];
  for (const filePath of stalePaths) {
    try {
      await unlink(filePath);
    } catch {
      // ignore if missing
    }
  }
}

async function buildUiAsset() {
  await mkdir(distDir, { recursive: true });
  await build(uiOptions);
  await writeInlinedUiHtml();
}

async function buildCodeAsset() {
  await mkdir(distDir, { recursive: true });
  await build(codeOptions);
}

/**
 * Replace the build-time placeholder in dist/code.js with the real
 * self-contained dist/ui.html string. Figma's runtime `__html__`
 * global is not visible inside esbuild's IIFE wrapper.
 */
async function injectUiHtmlIntoCode() {
  const html = await readFile(resolve(distDir, "ui.html"), "utf8");
  const codePath = resolve(distDir, "code.js");
  let code = await readFile(codePath, "utf8");

  const needle = JSON.stringify(UI_HTML_PLACEHOLDER);
  if (!code.includes(needle)) {
    throw new Error(
      "injectUiHtmlIntoCode: placeholder " +
        needle +
        " not found in dist/code.js — rebuild code.ts first."
    );
  }

  code = code.split(needle).join(JSON.stringify(html));
  await writeFile(codePath, code, "utf8");
}

async function buildAll() {
  await buildUiAsset();
  await buildCodeAsset();
  await injectUiHtmlIntoCode();
  console.log(
    "Wrote dist/ui.html (reference) and inlined it into dist/code.js for figma.showUI"
  );
}

async function run() {
  if (isWatch) {
    const codeCtx = await context(codeOptions);
    await codeCtx.watch();

    let rebuildPending = false;
    const scheduleRebuild = () => {
      if (rebuildPending) return;
      rebuildPending = true;
      setTimeout(async () => {
        rebuildPending = false;
        try {
          await buildAll();
          console.log("Rebuilt plugin UI + injected into code.js");
        } catch (error) {
          console.error("Plugin rebuild failed:", error);
        }
      }, 120);
    };

    await buildAll();

    watchFile(resolve(srcDir, "ui.ts"), scheduleRebuild);
    watchFile(resolve(srcDir, "styles.css"), scheduleRebuild);
    watchFile(resolve(srcDir, "skills"), { recursive: true }, scheduleRebuild);
    watchFile(resolve(srcDir, "lib"), { recursive: true }, scheduleRebuild);
    watchFile(resolve(srcDir, "types.ts"), scheduleRebuild);
    watchFile(resolve(srcDir, "code.ts"), scheduleRebuild);

    console.log("Watching cursor_mcp_plugin sources...");
    return;
  }

  await buildAll();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
