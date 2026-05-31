#!/usr/bin/env node
/**
 * Kit-canonical postbuild verifier for manifest.json.
 *
 * Common mistakes this catches:
 *  - `http://localhost:*` in `networkAccess.allowedDomains`
 *    (Figma review blocker — localhost belongs in `devAllowedDomains`)
 *  - missing `reasoning` when `allowedDomains` includes `"*"` or localhost
 *  - malformed JSON
 *
 * Usage from a template package.json:
 *   "postbuild": "node scripts/verify-manifest.js"
 * With explicit path override:
 *   "postbuild": "node scripts/verify-manifest.js dist/manifest.json"
 *
 * This is the reference copy. Every template in `templates/` ships a
 * byte-equivalent copy under its own `scripts/` folder so the postbuild
 * hook has no cross-repo dependency.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MANIFEST = path.resolve(process.cwd(), 'manifest.json');
const MANIFEST = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : DEFAULT_MANIFEST;

function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`verify-manifest: ${MANIFEST} not found.`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch (err) {
    console.error('verify-manifest: manifest.json is not valid JSON:', err.message);
    process.exit(1);
  }

  const network = manifest.networkAccess || {};
  const allowed = Array.isArray(network.allowedDomains) ? network.allowedDomains : [];
  const errors = [];

  for (const domain of allowed) {
    if (typeof domain !== 'string') continue;
    if (/localhost/i.test(domain)) {
      errors.push(`allowedDomains contains localhost entry "${domain}" — move to devAllowedDomains.`);
    }
  }

  const needsReasoning = allowed.some((d) => d === '*' || /localhost/i.test(d));
  if (needsReasoning && typeof network.reasoning !== 'string') {
    errors.push('networkAccess.reasoning is required when allowedDomains includes "*" or localhost.');
  }

  if (errors.length > 0) {
    console.error('verify-manifest: issues in manifest.json:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  console.log('verify-manifest: manifest.json clean.');
}

main();
