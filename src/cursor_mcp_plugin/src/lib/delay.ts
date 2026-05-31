/**
 * Trivial sleep helper. Plugin-runtime handlers use it as a yield point
 * inside bulk loops (chunking text writes, scanning large subtrees) so
 * the QuickJS sandbox can flush postMessage to the UI between batches.
 * See `.cursor/rules/figma-plugin-core.mdc` — Long-running work.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
