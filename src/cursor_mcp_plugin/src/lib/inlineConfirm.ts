/**
 * Canonical kit helper: inline, promise-based confirm dialog.
 * Copied verbatim from create-plugin-starter-kit/shared/ui/inlineConfirm.ts.
 *
 * Figma plugin UIs should never call `window.alert`, `window.confirm`,
 * or `window.prompt` -- those dialogs open at the top of the host page,
 * steal focus from the whole Figma window, cannot be themed, and look
 * broken on Figma Desktop. Always stay inside the plugin iframe.
 *
 * This helper renders a dismissible confirmation sheet into the body of
 * the plugin UI, traps focus on its action buttons, and resolves with
 * `true` when the user confirms or `false` on cancel/dismiss.
 *
 * Usage:
 *   const ok = await inlineConfirm({
 *     title: 'Remove project?',
 *     body: 'This will unlink the current Figma file.',
 *     confirmLabel: 'Remove',
 *     destructive: true,
 *   });
 *   if (!ok) return;
 */

export interface InlineConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** If true, the confirm button renders in a destructive colour. */
  destructive?: boolean;
  /** Optional ancestor to scope focus trap; defaults to document.body. */
  container?: HTMLElement;
}

export function inlineConfirm(
  options: InlineConfirmOptions
): Promise<boolean> {
  const {
    title,
    body = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = false,
    container = document.body,
  } = options;

  return new Promise<boolean>((resolve) => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const overlay = document.createElement("div");
    overlay.className = "inline-confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "inline-confirm-title");

    const sheet = document.createElement("div");
    sheet.className = "inline-confirm-sheet";

    const titleEl = document.createElement("h2");
    titleEl.id = "inline-confirm-title";
    titleEl.className = "inline-confirm-title";
    titleEl.textContent = title;

    const bodyEl = document.createElement("p");
    bodyEl.className = "inline-confirm-body";
    bodyEl.textContent = body;

    const actions = document.createElement("div");
    actions.className = "inline-confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "inline-confirm-cancel";
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = destructive
      ? "inline-confirm-confirm inline-confirm-confirm--destructive"
      : "inline-confirm-confirm";
    confirmBtn.textContent = confirmLabel;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    sheet.appendChild(titleEl);
    if (body) sheet.appendChild(bodyEl);
    sheet.appendChild(actions);
    overlay.appendChild(sheet);
    container.appendChild(overlay);

    const close = (result: boolean) => {
      overlay.removeEventListener("keydown", onKeydown);
      overlay.remove();
      if (previouslyFocused) previouslyFocused.focus();
      resolve(result);
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      } else if (event.key === "Tab") {
        const focusable = [cancelBtn, confirmBtn];
        const current = document.activeElement as HTMLElement | null;
        const idx = current
          ? focusable.indexOf(current as HTMLButtonElement)
          : -1;
        const next = event.shiftKey
          ? focusable[(idx - 1 + focusable.length) % focusable.length]
          : focusable[(idx + 1) % focusable.length];
        next.focus();
        event.preventDefault();
      } else if (event.key === "Enter" && document.activeElement === confirmBtn) {
        event.preventDefault();
        close(true);
      }
    };

    overlay.addEventListener("keydown", onKeydown);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));

    (destructive ? cancelBtn : confirmBtn).focus();
  });
}
