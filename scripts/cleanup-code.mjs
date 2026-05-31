#!/usr/bin/env node
/** Strip debug console.log calls and duplicate helper blocks from code.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const codePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/cursor_mcp_plugin/src/code.ts"
);

let src = readFileSync(codePath, "utf8");

function removeConsoleLogs(s) {
  let result = "";
  let i = 0;
  while (i < s.length) {
    const idx = s.indexOf("console.log(", i);
    if (idx === -1) {
      result += s.slice(i);
      break;
    }
    let lineStart = idx;
    while (lineStart > 0 && s[lineStart - 1] !== "\n") lineStart--;
    result += s.slice(i, lineStart);
    let j = idx + "console.log(".length;
    let depth = 1;
    while (j < s.length && depth > 0) {
      const ch = s[j];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      j++;
    }
    while (j < s.length && (s[j] === ";" || s[j] === " " || s[j] === "\t")) j++;
    if (s[j] === "\r") j++;
    if (s[j] === "\n") j++;
    i = j;
  }
  return result;
}

// Remove duplicate customBase64Encode (now in lib/base64.ts)
src = src.replace(
  /function customBase64Encode\(bytes\) \{[\s\S]*?\n\}\n\nasync function setCornerRadius/,
  "async function setCornerRadius"
);

// Remove duplicate setCharacters helpers (now in lib/setCharacters.ts)
src = src.replace(
  /function uniqBy\(arr, predicate\) \{[\s\S]*?\n\};\n\n\/\/ Add the cloneNode function implementation/,
  "// Add the cloneNode function implementation"
);

src = removeConsoleLogs(src);

// Remove init-settings postMessage (unhandled dead message)
src = src.replace(
  /\n\s*\/\/ Send initial settings to UI\n\s*figma\.ui\.postMessage\(\{\n\s*type: "init-settings",[\s\S]*?\}\);\n/,
  "\n"
);

// Fix set_instance_overrides fall-through
src = src.replace(
  /(\s+return await setInstanceOverrides\(targetNodes\.targetInstances, sourceInstanceData\);\n\s+\} else \{\n\s+throw new Error\("Missing sourceInstanceId parameter"\);\n\s+\}\n\s+\})\n(\s+case "set_layout_mode":)/,
  "$1\n      throw new Error(\"Missing targetNodeIds parameter\");\n$2"
);

// Serialise settings write
src = src.replace(
  /figma\.clientStorage\.setAsync\("settings", \{\n    serverPort: state\.serverPort,\n  \}\);/,
  'void setClientStorage("settings", { serverPort: state.serverPort });'
);

// Serialise analytics init
src = src.replace(
  /\(async \(\) => \{\n  try \{\n    let clientId = await figma\.clientStorage\.getAsync\("analyticsClientId"\);\n    if \(!clientId\) \{\n      clientId =[\s\S]*?await figma\.clientStorage\.setAsync\("analyticsClientId", clientId\);\n    \}\n    figma\.ui\.postMessage\(\{ type: "analytics-client-id", clientId \}\);\n  \} catch \(e\) \{\n    console\.error\("analytics init failed:", e\);\n  \}\n\}\)\(\);/,
  `(async () => {
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
})();`
);

// Remove stale engine inline comment
src = src.replace(
  /\/\/ Organize Screens v3 engine\. Source of truth: src\/organize-screens\/engine\.js\.\n\/\/ Re-inject after editing the engine via `bun run build:plugin`\.\n/,
  ""
);

// Remove progress console.log line if regex missed (sendProgressUpdate)
src = src.replace(
  /\n  console\.log\(`Progress update: \$\{status\} - \$\{progress\}% - \$\{message\}`\);\n/,
  "\n"
);

writeFileSync(codePath, src, "utf8");
console.log("[cleanup-code] code.ts updated");
