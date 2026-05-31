/**
 * Canonical kit helper: origin guard for every UI-side `message` listener.
 * Copied verbatim from create-plugin-starter-kit/shared/ui/pluginMessage.ts.
 *
 * Why a strict ancestor check rather than `event.source === window.parent`?
 * Figma nests the plugin UI inside a host-owned chain of iframes whose
 * depth is not stable across Figma Web releases (the UI currently sits
 * three frames deep). A direct `window.parent` equality check silently
 * drops every legitimate plugin -> UI message. Walking the ancestor chain
 * accepts any strict ancestor while still rejecting sibling iframes,
 * cross-site frames, nested child iframes rendered by a prompt response,
 * and opaque-origin dispatches (`event.source === null`).
 *
 * See `.cursor/rules/figma-plugin-message-bus.mdc` in the kit for the
 * authoritative rule that references this file.
 */
export function fromPlugin<T>(
  event: MessageEvent<{ pluginMessage?: T }>
): T | null {
  if (!isAncestorWindow(event.source)) return null;
  const msg = event.data && event.data.pluginMessage;
  return msg ? msg : null;
}

function isAncestorWindow(source: MessageEventSource | null): boolean {
  if (source === null) return false;
  let cursor: Window | null = window.parent;
  const guardMaxDepth = 20;
  let depth = 0;
  while (cursor && depth < guardMaxDepth) {
    if (source === cursor) return true;
    if (cursor === cursor.parent) return false;
    cursor = cursor.parent;
    depth += 1;
  }
  return false;
}
