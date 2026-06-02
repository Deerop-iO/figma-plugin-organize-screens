/**
 * Selection-context probe registry.
 *
 * Each skill that wants selection-aware UI registers a probe function
 * via `registerSelectionProbe(skillId, probe)` at runtime bootstrap.
 * On every `selectionchange` (debounced) we run every probe, wrap each
 * call in try/catch, and post one `selection-contexts` message to the
 * UI containing `{ [skillId]: result | { mode: "idle", reason: "probe-failed" } }`.
 *
 * Goals:
 *  - One `selectionchange` listener for the whole plugin.
 *  - A failing probe yields `idle` for that skill only -- other skills
 *    still get their context.
 *  - Probes do NOT touch `figma.ui.postMessage`; the publisher does.
 *    That keeps the contract testable and lets the UI layer choose
 *    how to fan results out per skill panel.
 */

type SelectionProbe = () => unknown;

const probes = new Map<string, SelectionProbe>();

export function registerSelectionProbe(
  skillId: string,
  probe: SelectionProbe
): void {
  probes.set(skillId, probe);
}

/**
 * Run every registered probe. A throwing probe is captured per-skill so
 * one bad probe cannot starve the others.
 */
export function runAllSelectionProbes(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [skillId, probe] of probes) {
    try {
      out[skillId] = probe();
    } catch (e) {
      console.warn(
        "[selection-probes] probe failed for `" + skillId + "`:",
        e
      );
      out[skillId] = { mode: "idle", reason: "probe-failed" };
    }
  }
  return out;
}

/**
 * Cheap signature of the current selection: page id + selected node ids.
 * Including the page id means a `currentpagechange` always changes the
 * signature (so the guard re-probes after a page switch even when both
 * pages have an empty selection). O(selection size), no subtree walks.
 */
function selectionSignature(): string {
  const sel = figma.currentPage.selection;
  let sig = figma.currentPage.id + "|";
  for (let i = 0; i < sel.length; i++) {
    sig += sel[i].id + ",";
  }
  return sig;
}

let lastSignature: string | null = null;
let lastContexts: Record<string, unknown> | null = null;

/**
 * Publish current selection contexts to the UI. Used both by the
 * debounced `selectionchange` handler and by explicit `probe-selection`
 * requests from the UI on mount / re-mount and after mutations (apply,
 * undo, skill switch). Always recomputes — callers invoke it precisely
 * when state may have changed without the selection ids changing — and
 * refreshes the signature cache so the debounced path can short-circuit
 * the duplicate `selectionchange` events that immediately follow.
 */
export function pushSelectionContexts(): void {
  const contexts = runAllSelectionProbes();
  lastSignature = selectionSignature();
  lastContexts = contexts;
  figma.ui.postMessage({ type: "selection-contexts", contexts });
}

const DEBOUNCE_MS = 200;
let selectionPushTimer: number | null = null;

/**
 * Trailing-only debounce for `selectionchange` / `currentpagechange`.
 *
 * The probe is heavy on large boards (full-board scans), so it must NOT
 * run synchronously on the event: a marquee/drag select or rapid clicking
 * fires many `selectionchange` events and an inline probe per event froze
 * the canvas. We coalesce a burst into a single trailing run after the
 * selection settles. Tradeoff: the panel updates ~1 debounce after the
 * selection settles instead of instantly, with no on-event main-thread spike.
 *
 * Figma also re-fires `selectionchange` with the same resulting selection.
 * When the settled signature matches the last published one, we skip the
 * recompute entirely (the UI already holds that result).
 */
function runDebouncedPush(): void {
  const sig = selectionSignature();
  if (lastSignature !== null && sig === lastSignature) {
    return;
  }
  pushSelectionContexts();
}

function scheduleSelectionPush(): void {
  if (selectionPushTimer !== null) {
    clearTimeout(selectionPushTimer);
  }
  selectionPushTimer = setTimeout(() => {
    selectionPushTimer = null;
    runDebouncedPush();
  }, DEBOUNCE_MS) as unknown as number;
}

/**
 * Install the selection-context listeners. Call once at runtime bootstrap,
 * after probes are registered (registration order does not matter for the
 * listeners themselves; new probes will be picked up by the next push).
 *
 * Two triggers feed the single debounced publisher:
 *  - `selectionchange`: selection within the current page changed.
 *  - `currentpagechange`: the user switched pages (with `dynamic-page`
 *    access a different board may already be selected on the new page, so
 *    the panel must re-probe to avoid stale state).
 */
let installed = false;
export function installSelectionProbeListener(): void {
  if (installed) return;
  installed = true;
  figma.on("selectionchange", () => {
    scheduleSelectionPush();
  });
  figma.on("currentpagechange", () => {
    scheduleSelectionPush();
  });
}
