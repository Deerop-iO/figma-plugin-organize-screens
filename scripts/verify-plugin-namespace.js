#!/usr/bin/env node
/**
 * Postbuild verifier for SharedPluginData namespaces.
 *
 * Figma rejects any `get/setSharedPluginData` namespace that is not made up
 * solely of alphanumeric characters, `_` or `.` (e.g. a hyphen throws
 * "The namespace can only consist of alphanumeric characters, _ or ."). A bad
 * namespace does not fail the build on its own — it throws at runtime inside
 * the Figma WASM sandbox, and the exception unwinding is slow enough to lag the
 * whole canvas. This check fails the build instead, so the mistake is caught
 * here rather than as seconds of in-Figma lag.
 *
 * It scans the built bundle for two shapes:
 *  - namespace constant declarations: `var/const/let *NAMESPACE = "..."`
 *  - inline string literals passed as the first arg to get/setSharedPluginData
 *
 * Usage:
 *   node scripts/verify-plugin-namespace.js src/cursor_mcp_plugin/dist/code.js
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_BUNDLE = path.resolve(process.cwd(), 'src/cursor_mcp_plugin/dist/code.js');
const BUNDLE = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : DEFAULT_BUNDLE;

const VALID_NAMESPACE = /^[A-Za-z0-9_.]+$/;

function main() {
  if (!fs.existsSync(BUNDLE)) {
    console.error(`verify-plugin-namespace: ${BUNDLE} not found.`);
    process.exit(1);
  }

  const source = fs.readFileSync(BUNDLE, 'utf8');
  const found = [];

  const constDecl = /(?:var|const|let)\s+([A-Za-z0-9_]*NAMESPACE)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = constDecl.exec(source)) !== null) {
    found.push({ where: m[1], value: m[2] });
  }

  const literalArg = /(?:get|set)SharedPluginData(?:Keys)?\(\s*"([^"]*)"/g;
  while ((m = literalArg.exec(source)) !== null) {
    found.push({ where: 'SharedPluginData literal', value: m[1] });
  }

  const errors = [];
  for (const entry of found) {
    if (!VALID_NAMESPACE.test(entry.value)) {
      errors.push(
        `${entry.where}: "${entry.value}" is not a valid SharedPluginData namespace ` +
          '(allowed: alphanumeric, "_" or ".").'
      );
    }
  }

  if (errors.length > 0) {
    console.error('verify-plugin-namespace: invalid SharedPluginData namespace(s):');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  console.log('verify-plugin-namespace: namespaces clean (' + found.length + ' checked).');
}

main();
