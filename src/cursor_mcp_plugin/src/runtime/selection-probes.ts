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
 * Publish current selection contexts to the UI. Used both by the
 * debounced `selectionchange` handler and by explicit `probe-selection`
 * requests from the UI on mount / re-mount.
 */
export function pushSelectionContexts(): void {
  const contexts = runAllSelectionProbes();
  figma.ui.postMessage({ type: "selection-contexts", contexts });
}

const DEBOUNCE_MS = 150;
let selectionPushTimer: number | null = null;

/**
 * Figma often fires `selectionchange` more than once per click (empty → partial
 * → final). A debounce-only publisher can leave the panel on a stale idle
 * context until the user clicks again. Push immediately so the panel reacts,
 * then debounce a follow-up so the probe reads the settled selection.
 */
function scheduleSelectionPush(): void {
  pushSelectionContexts();
  if (selectionPushTimer !== null) {
    clearTimeout(selectionPushTimer);
  }
  selectionPushTimer = setTimeout(() => {
    selectionPushTimer = null;
    pushSelectionContexts();
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
