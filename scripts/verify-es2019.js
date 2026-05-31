#!/usr/bin/env node
/**
 * Kit-canonical postbuild verifier for the plugin runtime bundle.
 *
 * Figma's plugin runtime (QuickJS-based) historically rejects modern
 * syntax such as `??` (nullish coalescing) and `?.` (optional chaining).
 * esbuild with `--target=es2015` downlevels most things but regressions
 * creep in if the target is raised or a dependency ships non-es5 code.
 *
 * Usage from a template package.json:
 *   "postbuild": "node scripts/verify-es2019.js"
 * With explicit path override:
 *   "postbuild": "node scripts/verify-es2019.js dist/code.js"
 *
 * Fails with exit code 1 on the first hit so CI blocks the release.
 *
 * This is the reference copy. Every template in `templates/` ships a
 * byte-equivalent copy under its own `scripts/` folder so the postbuild
 * hook has no cross-repo dependency.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CODE_JS = path.resolve(process.cwd(), 'code.js');
const CODE_JS = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : DEFAULT_CODE_JS;

const FORBIDDEN = [
  { label: 'nullish coalescing (??)', regex: /(?<![\w.])\?\?(?!=)/g },
  { label: 'optional chaining (?.)', regex: /\?\.(?![0-9])/g },
];

function main() {
  if (!fs.existsSync(CODE_JS)) {
    console.error(`verify-es2019: ${CODE_JS} not found. Did the build run?`);
    process.exit(1);
  }
  const src = fs.readFileSync(CODE_JS, 'utf8');
  const hits = [];
  for (const { label, regex } of FORBIDDEN) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(src)) !== null) {
      const line = src.slice(0, match.index).split('\n').length;
      hits.push({ label, line });
      if (hits.length >= 10) break;
    }
    if (hits.length >= 10) break;
  }
  if (hits.length > 0) {
    console.error(`verify-es2019: forbidden syntax in ${path.basename(CODE_JS)}:`);
    for (const h of hits) console.error(`  - ${h.label} at line ${h.line}`);
    console.error('Lower esbuild --target or transpile the offending dependency.');
    process.exit(1);
  }
  console.log(`verify-es2019: ${path.basename(CODE_JS)} clean.`);
}

main();
