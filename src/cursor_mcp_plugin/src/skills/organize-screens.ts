import type {
  AnalyzeDesignEligibility,
  AnnotationParam,
  BoardType,
  BoardTypeCapabilities,
  OrganizeScreensSelectionContext,
  Orientation,
  VariantGroupProposal,
} from "../types";
import { inlineConfirm } from "../lib/inlineConfirm";
import type { SkillContext, SkillDef, SkillInstance } from "./registry";

// Board Types are the primary system. `custom` is the calibrated baseline;
// `design-review` reuses the same layout and adds an editable Review Card to
// each screen.
const BOARD_TYPE_OPTIONS: ReadonlyArray<{
  id: BoardType;
  label: string;
  intent: string;
}> = [
  {
    id: "custom",
    label: "Custom",
    intent: "The calibrated baseline composition.",
  },
  {
    id: "design-review",
    label: "Design Review",
    intent:
      "Baseline layout plus an editable Review Card under each screen (What's good, Questions, Concerns, Ideas, Notes).",
  },
  {
    id: "functional-analysis",
    label: "Functional Analysis",
    intent:
      "A full-width Functional Card stacked under each screen for structured functional documentation, fillable with AI via Create Documentation.",
  },
];

type AnnotationsMode = "off" | "compact" | "expanded";

type OrientationChoice = "default" | "row" | "column" | "grid";

const ORIENTATION_OPTIONS: ReadonlyArray<{
  value: OrientationChoice;
  label: string;
  hint: string;
}> = [
  {
    value: "default",
    label: "Default (baseline)",
    hint: "Preserves the calibrated baseline — the engine picks the strategy.",
  },
  {
    value: "row",
    label: "Row",
    hint: "One horizontal row — every selected screen side by side, no wrap limit.",
  },
  {
    value: "column",
    label: "Column",
    hint: "One vertical column — every selected screen stacked, no segment limit.",
  },
  {
    value: "grid",
    label: "Grid",
    hint: "Square grid — column count chosen so rows and columns stay as even as possible.",
  },
];

export const organizeScreensSkill: SkillDef = {
  id: "organize-screens",
  title: "Organize Screens",
  description:
    "Arrange selected frames into a tokenised Figma section, or edit a board you already generated.",
  group: "skills",
  requires: "figma",
  render(host, ctx) {
    return renderOrganizeScreens(host, ctx);
  },
};

/**
 * The panel renders one form (board type / orientation / annotations) and
 * adapts its lead text, primary button, and click handler based on the
 * current selection mode the plugin runtime pushed via `selection-context`.
 *
 * Generate mode → "Run on current selection" → `run-skill`.
 * Edit mode    → "Apply changes" → `apply-board-changes` (with inline
 *                confirm for any layout-affecting delta).
 * Idle/arrange → form disabled with a clarifying hint.
 */
function renderOrganizeScreens(
  host: HTMLElement,
  ctx: SkillContext
): SkillInstance {
  host.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "panel";

  // ----- Context banner (mode indicator) -----
  const banner = document.createElement("div");
  banner.className = "panel-banner";
  panel.appendChild(banner);

  const lead = document.createElement("p");
  lead.className = "panel-section-body";
  panel.appendChild(lead);

  // ----- Board Type -----
  const boardTypeSection = document.createElement("section");
  boardTypeSection.className = "panel-section";

  const boardTypeLabel = document.createElement("label");
  boardTypeLabel.className = "field-label";
  boardTypeLabel.htmlFor = "organize-board-type";
  boardTypeLabel.textContent = "Board Type";
  boardTypeSection.appendChild(boardTypeLabel);

  const boardTypeSelect = document.createElement("select");
  boardTypeSelect.id = "organize-board-type";
  boardTypeSelect.className = "select";
  for (const option of BOARD_TYPE_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = option.id;
    opt.textContent = option.label;
    boardTypeSelect.appendChild(opt);
  }
  boardTypeSelect.value = "custom";
  boardTypeSection.appendChild(boardTypeSelect);

  const boardTypeHint = document.createElement("p");
  boardTypeHint.className = "footnote";
  boardTypeHint.textContent = BOARD_TYPE_OPTIONS[0].intent;
  boardTypeSection.appendChild(boardTypeHint);

  // Design Review only: status is a component instance changed on canvas.
  const boardTypeStatusHint = document.createElement("p");
  boardTypeStatusHint.className = "footnote";
  boardTypeStatusHint.textContent =
    "Each screen's status is a Review Status component — change it (Draft, Approved, Blocked, Needs work, Ready for dev) via the variant picker on the instance. When the file has a \".Design Review\" component set, the plugin uses that master.";
  boardTypeStatusHint.hidden = true;
  boardTypeSection.appendChild(boardTypeStatusHint);

  panel.appendChild(boardTypeSection);

  // ----- Orientation -----
  const orientationSection = document.createElement("section");
  orientationSection.className = "panel-section";

  const orientationLabel = document.createElement("label");
  orientationLabel.className = "field-label";
  orientationLabel.htmlFor = "organize-orientation";
  orientationLabel.textContent = "Orientation";
  orientationSection.appendChild(orientationLabel);

  const orientationSelect = document.createElement("select");
  orientationSelect.id = "organize-orientation";
  orientationSelect.className = "select";
  for (const option of ORIENTATION_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    orientationSelect.appendChild(opt);
  }
  orientationSelect.value = "default";
  orientationSection.appendChild(orientationSelect);

  const orientationHint = document.createElement("p");
  orientationHint.className = "footnote";
  orientationHint.textContent = ORIENTATION_OPTIONS[0].hint;
  orientationSection.appendChild(orientationHint);

  panel.appendChild(orientationSection);

  // ----- Annotations -----
  const annotationsSection = document.createElement("section");
  annotationsSection.className = "panel-section";

  const annotationsLabel = document.createElement("label");
  annotationsLabel.className = "field-label";
  annotationsLabel.htmlFor = "organize-annotations";
  annotationsLabel.textContent = "Annotations";
  annotationsSection.appendChild(annotationsLabel);

  const annotationsSelect = document.createElement("select");
  annotationsSelect.id = "organize-annotations";
  annotationsSelect.className = "select";
  for (const opt of [
    { value: "off", label: "Off (default)" },
    { value: "compact", label: "Compact slot" },
    { value: "expanded", label: "Expanded slot" },
  ]) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    annotationsSelect.appendChild(o);
  }
  annotationsSelect.value = "off";
  annotationsSection.appendChild(annotationsSelect);

  const annotationsHint = document.createElement("p");
  annotationsHint.className = "footnote";
  annotationsHint.textContent =
    "Annotations are off by default. Choose a mode to add a slot under each Screen Card.";
  annotationsSection.appendChild(annotationsHint);

  // Shown only when the selected board type cannot host annotations. Makes the
  // preservation guarantee observable ("N notes preserved — they reappear in
  // Custom") so a hidden section never reads as data loss.
  const annotationsCapabilityHint = document.createElement("p");
  annotationsCapabilityHint.className = "footnote";
  annotationsCapabilityHint.hidden = true;
  annotationsSection.appendChild(annotationsCapabilityHint);

  panel.appendChild(annotationsSection);

  // ----- Show as flow -----
  const flowSection = document.createElement("section");
  flowSection.className = "panel-section";

  const flowLabel = document.createElement("div");
  flowLabel.className = "field-label";
  flowLabel.textContent = "Flow";
  flowSection.appendChild(flowLabel);

  const flowToggleRow = document.createElement("label");
  flowToggleRow.className = "variant-group-row";
  const flowCheckbox = document.createElement("input");
  flowCheckbox.type = "checkbox";
  flowCheckbox.id = "organize-flow";
  const flowToggleText = document.createElement("span");
  flowToggleText.textContent = "Show as flow (arrows between cards in reading order)";
  flowToggleRow.appendChild(flowCheckbox);
  flowToggleRow.appendChild(flowToggleText);
  flowSection.appendChild(flowToggleRow);
  flowCheckbox.addEventListener("change", () => {
    refreshFlowScopeHint();
  });

  // Edit mode only: shows whether Apply will scope flow to the selected subset
  // ("Flow: N selected screens") or span the whole board, so scoping is never
  // silent. Driven by the engine probe's flowWouldScope / flowScopeCount.
  const flowScopeHint = document.createElement("p");
  flowScopeHint.className = "footnote";
  flowScopeHint.hidden = true;
  flowSection.appendChild(flowScopeHint);

  panel.appendChild(flowSection);

  // ----- Comparison groups (multi-proposal A/B/C) -----
  // Only shown in compose mode when the runtime detected variant groups in
  // the selection. Each group can be accepted (rendered as a side-by-side
  // strip with Pros/Cons) or dismissed (its frames become normal cards).
  const variantSection = document.createElement("section");
  variantSection.className = "panel-section";
  variantSection.hidden = true;

  const variantLabel = document.createElement("div");
  variantLabel.className = "field-label";
  variantLabel.textContent = "Comparison groups";
  variantSection.appendChild(variantLabel);

  const variantHint = document.createElement("p");
  variantHint.className = "footnote";
  variantSection.appendChild(variantHint);

  const variantList = document.createElement("div");
  variantList.className = "variant-group-list";
  variantSection.appendChild(variantList);

  const variantSeparate = document.createElement("button");
  variantSeparate.type = "button";
  variantSeparate.className = "link-button";
  variantSeparate.textContent = "Treat all as separate";
  variantSection.appendChild(variantSeparate);

  panel.appendChild(variantSection);

  // ----- Run / Apply -----
  const runSection = document.createElement("section");
  runSection.className = "panel-section";

  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "button button-block";
  runBtn.textContent = "Run on current selection";
  runSection.appendChild(runBtn);

  // Secondary action: draw flow arrows between the selected screens (or the
  // child screens of a selected section) in place, without composing a board.
  // Lit up purely by the runtime's `flowEligible` flag, independent of mode.
  const flowBtn = document.createElement("button");
  flowBtn.type = "button";
  flowBtn.className = "button button-secondary button-block";
  flowBtn.textContent = "Add flow arrows (in place)";
  flowBtn.hidden = true;
  runSection.appendChild(flowBtn);

  // Design Review only: three scoped actions on the selected screen card. Lit
  // up by the runtime's `analyzeDesign` eligibility, independent of the
  // generate/apply primary action.
  //   - Describe screen (AI): fills the Card Description plus section title/description.
  //   - Review design (AI): fills only the review section.
  //   - Reset review results (local): review fields back to placeholders.
  const describeBtn = document.createElement("button");
  describeBtn.type = "button";
  describeBtn.className = "button button-secondary button-block";
  describeBtn.textContent = "Describe screen (AI)";
  describeBtn.hidden = true;
  runSection.appendChild(describeBtn);

  const reviewBtn = document.createElement("button");
  reviewBtn.type = "button";
  reviewBtn.className = "button button-secondary button-block";
  reviewBtn.textContent = "Review design (AI)";
  reviewBtn.hidden = true;
  runSection.appendChild(reviewBtn);

  const resetReviewBtn = document.createElement("button");
  resetReviewBtn.type = "button";
  resetReviewBtn.className = "button button-secondary button-block";
  resetReviewBtn.textContent = "Reset review results";
  resetReviewBtn.hidden = true;
  runSection.appendChild(resetReviewBtn);

  // Functional Analysis only: a single adaptive AI action (card or whole
  // section) plus a local reset. Lit up by the runtime's `createDocumentation`
  // eligibility; mutually exclusive with the Design Review actions by surface.
  const documentBtn = document.createElement("button");
  documentBtn.type = "button";
  documentBtn.className = "button button-secondary button-block";
  documentBtn.textContent = "Create Documentation (AI)";
  documentBtn.hidden = true;
  runSection.appendChild(documentBtn);

  const resetDocumentationBtn = document.createElement("button");
  resetDocumentationBtn.type = "button";
  resetDocumentationBtn.className = "button button-secondary button-block";
  resetDocumentationBtn.textContent = "Reset documentation";
  resetDocumentationBtn.hidden = true;
  runSection.appendChild(resetDocumentationBtn);

  const documentHint = document.createElement("p");
  documentHint.className = "footnote";
  documentHint.hidden = true;
  runSection.appendChild(documentHint);

  const analyzeHint = document.createElement("p");
  analyzeHint.className = "footnote";
  analyzeHint.hidden = true;
  runSection.appendChild(analyzeHint);

  // Edit-mode only: deconstruct a generated board back to its original screen
  // frames (kept in place) and delete all plugin-generated scaffolding.
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "button button-secondary button-block";
  resetBtn.textContent = "Reset to screens only";
  resetBtn.hidden = true;
  runSection.appendChild(resetBtn);

  const resultHost = document.createElement("div");
  runSection.appendChild(resultHost);

  panel.appendChild(runSection);

  host.appendChild(panel);

  // ---------- Hint updates ----------
  boardTypeSelect.addEventListener("change", () => {
    const match = BOARD_TYPE_OPTIONS.find(
      (option) => option.id === boardTypeSelect.value
    );
    boardTypeHint.textContent = match ? match.intent : "";
    boardTypeStatusHint.hidden = boardTypeSelect.value !== "design-review";
    updateAnnotationsVisibility();
  });

  orientationSelect.addEventListener("change", () => {
    const match = ORIENTATION_OPTIONS.find(
      (option) => option.value === orientationSelect.value
    );
    orientationHint.textContent = match ? match.hint : "";
  });

  // ---------- Mode-aware state ----------
  // `currentMode` and `currentBoard` are updated whenever the runtime
  // pushes a new selection context. They are the single source of truth
  // for the click handler's branching.
  let currentMode: OrganizeScreensSelectionContext["mode"] = "idle";
  let currentBoardSectionId: string | null = null;
  // Settings as currently stored on the board — used to compare against
  // the form on Apply so we can show a confirm only on layout-affecting
  // deltas.
  let appliedSettings: {
    boardType: BoardType;
    orientation: Orientation;
    annotationsMode: AnnotationsMode;
    flow: boolean;
  } | null = null;
  let lastBoardSeen: string | null = null;
  /** Fingerprint of the last board settings written into the form (edit mode). */
  let lastContextFingerprint: string | null = null;
  let busy = false;
  // Whether the current selection can drive an in-place flow (2+ frames, or a
  // section with 2+ child frames). Pushed by the runtime on every context.
  let currentFlowEligible = false;
  // Selective-flow preview pushed by the engine (edit mode): whether an Apply
  // with flow ON would scope to the selected subset, and how many cards.
  let currentFlowWouldScope = false;
  let currentFlowScopeCount = 0;
  // Analyze Design eligibility for the current selection (engine-owned). Null
  // until the first probe; the action is hidden unless `eligible` is true.
  let currentAnalyze: AnalyzeDesignEligibility | null = null;
  // Create Documentation eligibility (Functional Analysis surface). Mutually
  // exclusive with `currentAnalyze` by surface. Null until the first probe.
  let currentDocument: AnalyzeDesignEligibility | null = null;
  // Separate busy flag so an in-flight analysis disables the analyze button
  // without entangling the generate/apply primary button state.
  let analyzeBusy = false;
  // Board type capabilities pushed by the engine (single source of truth). The
  // UI never hardcodes a mirror; when the field is missing (older engine
  // pairing) we fall back to treating every feature as available.
  let capabilitiesByBoardType: Record<string, BoardTypeCapabilities> = {};
  // Count of preserved annotation notes on the edited board (0 in compose mode
  // or when none are stored). Surfaced when annotations are hidden.
  let preservedAnnotationCount = 0;
  // Variant groups proposed for the current compose selection, plus a
  // per-key accept decision (persists across re-probes of the same groups).
  let proposedVariantGroups: VariantGroupProposal[] = [];
  const variantAccept: Record<string, boolean> = {};

  function renderVariantGroups() {
    variantList.innerHTML = "";
    if (!proposedVariantGroups.length) {
      variantSection.hidden = true;
      return;
    }
    variantSection.hidden = false;
    variantHint.textContent =
      "Detected " +
      proposedVariantGroups.length +
      " comparison group(s). Accepted groups render side by side with Pros / Cons per variant.";
    for (const group of proposedVariantGroups) {
      const row = document.createElement("label");
      row.className = "variant-group-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = variantAccept[group.key] !== false;
      cb.addEventListener("change", () => {
        variantAccept[group.key] = cb.checked;
      });
      const text = document.createElement("span");
      text.textContent =
        group.label +
        " \u00b7 " +
        group.variantLabels.join(", ") +
        (group.source === "naming" ? " (guessed from names)" : "");
      row.appendChild(cb);
      row.appendChild(text);
      variantList.appendChild(row);
    }
  }

  variantSeparate.addEventListener("click", () => {
    for (const group of proposedVariantGroups) {
      variantAccept[group.key] = false;
    }
    renderVariantGroups();
  });

  function setBusy(b: boolean) {
    busy = b;
    runBtn.disabled = b;
    if (b) {
      runBtn.textContent = currentMode === "edit"
        ? "Applying..."
        : "Running...";
    } else {
      runBtn.textContent = primaryLabelForMode(currentMode);
    }
    flowBtn.disabled = b || !currentFlowEligible;
    refreshResetButton();
    refreshAnalyzeButton();
  }

  function analyzeEligible(): boolean {
    return !!(currentAnalyze && currentAnalyze.eligible);
  }

  function documentEligible(): boolean {
    if (!(currentDocument && currentDocument.eligible)) return false;
    const bt = currentDocument.boardType || "functional-analysis";
    const caps = capabilitiesByBoardType[bt];
    // Default to allowed when capabilities are absent (older engine pairing).
    return !caps || caps.documentation !== false;
  }

  type AnalyzeBusyAction =
    | "describe"
    | "review"
    | "resetReview"
    | "document"
    | "resetDocumentation";

  // Which analyze/document action is in flight, so only that button shows a
  // spinner label while the others (plus run/flow) stay disabled.
  let analyzeBusyAction: AnalyzeBusyAction | null = null;

  function setAnalyzeBusy(b: boolean, action?: AnalyzeBusyAction) {
    analyzeBusy = b;
    analyzeBusyAction = b ? action || null : null;
    runBtn.disabled = busy || b || currentMode === "unsupported";
    flowBtn.disabled = busy || b || !currentFlowEligible;
    refreshAnalyzeButton();
  }

  function refreshAnalyzeButton() {
    const eligible = analyzeEligible();
    const disabled = busy || analyzeBusy || !eligible;

    describeBtn.hidden = !eligible;
    reviewBtn.hidden = !eligible;
    resetReviewBtn.hidden = !eligible;

    describeBtn.disabled = disabled;
    reviewBtn.disabled = disabled;
    resetReviewBtn.disabled = disabled;

    describeBtn.textContent =
      analyzeBusyAction === "describe" ? "Describing..." : "Describe screen (AI)";
    reviewBtn.textContent =
      analyzeBusyAction === "review" ? "Reviewing..." : "Review design (AI)";
    resetReviewBtn.textContent =
      analyzeBusyAction === "resetReview" ? "Resetting..." : "Reset review results";

    analyzeHint.hidden = !eligible;
    if (eligible) {
      const isSection = !!(currentAnalyze && currentAnalyze.target === "section");
      const n = (currentAnalyze && currentAnalyze.screenCount) || 0;
      analyzeHint.textContent = isSection
        ? "Runs on all " +
          n +
          " screens in this section. Describe fills each screen description plus the section title and description; Review fills each review section (both AI). Reset returns every review section to placeholders."
        : "Describe fills the screen description plus the section title and description; Review fills the review section (both AI, overwriting existing text). Reset returns the review section to placeholders.";
    }

    // Functional Analysis: a single adaptive Create Documentation action + reset.
    const docEligible = documentEligible();
    const docDisabled = busy || analyzeBusy || !docEligible;

    documentBtn.hidden = !docEligible;
    resetDocumentationBtn.hidden = !docEligible;
    documentBtn.disabled = docDisabled;
    resetDocumentationBtn.disabled = docDisabled;

    documentBtn.textContent =
      analyzeBusyAction === "document"
        ? "Documenting..."
        : "Create Documentation (AI)";
    resetDocumentationBtn.textContent =
      analyzeBusyAction === "resetDocumentation"
        ? "Resetting..."
        : "Reset documentation";

    documentHint.hidden = !docEligible;
    if (docEligible) {
      const isSection = !!(currentDocument && currentDocument.target === "section");
      const n = (currentDocument && currentDocument.screenCount) || 0;
      documentHint.textContent = isSection
        ? "Runs on all " +
          n +
          " screens in this section, generating functional documentation (AI) into each Functional Card. Existing text is overwritten. Reset returns every Functional Card to placeholders."
        : "Generates functional documentation (AI) into this screen's Functional Card, overwriting existing text. Reset returns the Functional Card to placeholders.";
    }
  }

  function primaryLabelForMode(
    mode: OrganizeScreensSelectionContext["mode"]
  ): string {
    if (mode === "edit") return "Apply changes";
    return "Run on current selection";
  }

  function annotationsModeFromSettings(
    enabled: boolean,
    mode: "compact" | "expanded"
  ): AnnotationsMode {
    if (!enabled) return "off";
    return mode === "expanded" ? "expanded" : "compact";
  }

  function refreshFlowButton() {
    flowBtn.hidden = !currentFlowEligible;
    flowBtn.disabled = busy || !currentFlowEligible;
  }

  // Edit mode: surface how Apply will scope flow. Hidden unless flow is ON in
  // the form (the scope only matters when an overlay is drawn).
  function refreshFlowScopeHint() {
    if (currentMode !== "edit" || !flowCheckbox.checked) {
      flowScopeHint.hidden = true;
      return;
    }
    flowScopeHint.hidden = false;
    if (currentFlowWouldScope && currentFlowScopeCount >= 2) {
      flowScopeHint.textContent =
        "Flow: " +
        currentFlowScopeCount +
        " selected screens (arrows connect only these, in selection order).";
    } else {
      flowScopeHint.textContent =
        "Flow: all screens. Select 2+ Screen Cards before Apply to connect only those.";
    }
  }

  /** Whether the board type currently selected in the form can host annotations. */
  function annotationsCapableFor(boardType: string): boolean {
    const caps = capabilitiesByBoardType[boardType];
    // Fallback when the engine did not push capabilities (older pairing): treat
    // the feature as available so the panel never breaks.
    return caps ? caps.annotations === true : true;
  }

  /**
   * Show/hide + enable/disable the Annotations section based on the selected
   * board type's capability. When hidden, the interactive select is removed
   * from layout and the preservation guarantee is surfaced as a reassurance.
   */
  function updateAnnotationsVisibility() {
    const boardType = boardTypeSelect.value;
    const capable = annotationsCapableFor(boardType);

    annotationsSelect.hidden = !capable;
    annotationsSelect.disabled = !capable;
    annotationsHint.hidden = !capable;
    annotationsCapabilityHint.hidden = capable;

    if (!capable) {
      const match = BOARD_TYPE_OPTIONS.find((o) => o.id === boardType);
      const typeName = match ? match.label : boardType;
      let msg = "Annotations aren't available in " + typeName + ".";
      if (currentMode === "edit" && preservedAnnotationCount > 0) {
        msg +=
          " " +
          preservedAnnotationCount +
          (preservedAnnotationCount === 1 ? " note" : " notes") +
          " preserved — they reappear in Custom.";
      } else {
        msg += " Notes are preserved and reappear in Custom.";
      }
      annotationsCapabilityHint.textContent = msg;
    }
  }

  function refreshResetButton() {
    const inEditMode = currentMode === "edit";
    const show = inEditMode && !!currentBoardSectionId;
    resetBtn.hidden = !show;
    resetBtn.disabled = busy || !show;
  }

  type EditBoardContext = Extract<
    OrganizeScreensSelectionContext,
    { mode: "edit" }
  >["board"];

  function boardSettingsFingerprint(
    sectionId: string,
    settings: EditBoardContext["settings"]
  ): string {
    const ann = settings.annotations;
    return (
      sectionId +
      "|" +
      settings.boardType +
      "|" +
      settings.orientation +
      "|" +
      (ann.enabled ? "1" : "0") +
      "|" +
      ann.mode +
      "|" +
      ann.position +
      "|" +
      (settings.flow === true ? "1" : "0")
    );
  }

  function syncFormFromBoard(board: EditBoardContext) {
    boardTypeSelect.value = board.settings.boardType;
    const orientationVal: OrientationChoice =
      board.settings.orientation === "passthrough"
        ? "default"
        : (board.settings.orientation as OrientationChoice);
    orientationSelect.value = orientationVal;
    const ann = board.settings.annotations;
    annotationsSelect.value = annotationsModeFromSettings(ann.enabled, ann.mode);
    flowCheckbox.checked = board.settings.flow === true;
    boardTypeSelect.dispatchEvent(new Event("change"));
    orientationSelect.dispatchEvent(new Event("change"));
    appliedSettings = {
      boardType: board.settings.boardType,
      orientation: board.settings.orientation,
      annotationsMode: annotationsModeFromSettings(ann.enabled, ann.mode),
      flow: board.settings.flow === true,
    };
  }

  /** Apply a new selection context to the panel UI. */
  function applyContext(context: OrganizeScreensSelectionContext) {
    currentMode = context.mode;
    currentFlowEligible = context.flowEligible === true;
    currentFlowWouldScope = context.flowWouldScope === true;
    currentFlowScopeCount =
      typeof context.flowScopeCount === "number" ? context.flowScopeCount : 0;
    currentAnalyze = context.analyzeDesign || null;
    currentDocument = context.createDocumentation || null;
    // Capabilities are engine-owned; refresh the local copy each context push.
    capabilitiesByBoardType = context.capabilitiesByBoardType || {};
    preservedAnnotationCount =
      context.mode === "edit" &&
      typeof context.board.preservedAnnotationCount === "number"
        ? context.board.preservedAnnotationCount
        : 0;

    // Variant groups only apply to compose; clear by default and repopulate
    // in the compose branch below.
    proposedVariantGroups = [];

    if (context.mode === "edit") {
      const board = context.board;
      currentBoardSectionId = board.sectionId;

      const fingerprint = boardSettingsFingerprint(
        board.sectionId,
        board.settings
      );
      const boardChanged = lastBoardSeen !== board.sectionId;
      const settingsChanged = lastContextFingerprint !== fingerprint;
      // Preserve in-progress edits when the user clicks inside the same board
      // (e.g. a Screen Card) and the stored settings are unchanged.
      const formDirty =
        !boardChanged &&
        appliedSettings !== null &&
        classifyLocalDelta(readForm()) !== "none";

      if (boardChanged || (settingsChanged && !formDirty)) {
        syncFormFromBoard(board);
        resultHost.innerHTML = "";
        lastBoardSeen = board.sectionId;
        lastContextFingerprint = fingerprint;
      } else if (boardTypeSelect.value !== board.settings.boardType) {
        // Probe resolved a different board type (e.g. Design Review on canvas
        // but stale metadata said custom). Always align the dropdown even when
        // other fields are left alone to preserve in-progress edits.
        boardTypeSelect.value = board.settings.boardType;
        boardTypeSelect.dispatchEvent(new Event("change"));
        if (appliedSettings) {
          appliedSettings = {
            ...appliedSettings,
            boardType: board.settings.boardType,
          };
        }
        lastContextFingerprint = fingerprint;
      }

      banner.classList.add("panel-banner--edit");
      banner.classList.remove("panel-banner--idle");
      // Board Type is the single source of truth for the headline. No board is
      // ever labelled "legacy"; a board with missing metadata simply shows the
      // generic modern label.
      banner.textContent =
        board.settings.boardType === "design-review"
          ? "Edit Design Review board"
          : "Edit this board";

      const layoutLabel = String(board.layout.strategy || "—");
      lead.textContent =
        '"' +
        (board.sectionName || "Untitled board") +
        '" — ' +
        board.settings.orientation +
        " (" +
        layoutLabel +
        "). Layout updates on this section. Edited text and renamed frames are always preserved.";
    } else {
      currentBoardSectionId = null;
      lastBoardSeen = null;
      lastContextFingerprint = null;
      appliedSettings = null;

      if (context.mode === "compose") {
        banner.classList.remove("panel-banner--edit", "panel-banner--idle");
        banner.textContent =
          "Generate from selection — " +
          context.frameCount +
          " frame" +
          (context.frameCount === 1 ? "" : "s") +
          " ready";
        lead.textContent =
          "Pick a board type (Custom, or Design Review to add editable review cards) and optionally an orientation, then run. The plugin arranges the selected frames into a single Section with consistent spacing and typography.";
        proposedVariantGroups = context.proposedVariantGroups || [];
        for (const group of proposedVariantGroups) {
          if (!(group.key in variantAccept)) variantAccept[group.key] = true;
        }
      } else if (context.mode === "arrange") {
        banner.classList.remove("panel-banner--edit");
        banner.classList.add("panel-banner--idle");
        banner.textContent =
          "Arrange " + context.sectionCount + " sections";
        lead.textContent =
          "Multi-section arrange is unchanged. Press Run to lay out the selected sections in a balanced grid.";
      } else if (context.mode === "unsupported") {
        banner.classList.remove("panel-banner--edit");
        banner.classList.add("panel-banner--idle");
        banner.textContent = "Not available in this editor";
        lead.textContent =
          "Organize Screens runs in the Figma editor only.";
      } else {
        banner.classList.remove("panel-banner--edit");
        banner.classList.add("panel-banner--idle");
        banner.textContent = "Nothing selected";
        lead.textContent =
          "Select 2 or more frames to generate a board, or click a board this plugin generated to edit it.";
      }
    }

    renderVariantGroups();

    if (!busy) {
      runBtn.textContent = primaryLabelForMode(currentMode);
    }
    runBtn.disabled = busy || currentMode === "unsupported";
    refreshFlowButton();
    refreshFlowScopeHint();
    refreshResetButton();
    refreshAnalyzeButton();
    // Reflect the (possibly updated) capabilities + preserved-count for the
    // board type now shown in the form. Safe to call even after a dispatched
    // change event already ran it — it is idempotent.
    updateAnnotationsVisibility();
  }

  function readForm(): {
    boardType: BoardType;
    orientation: Orientation;
    annotationsMode: AnnotationsMode;
    annotations: AnnotationParam | undefined;
    orientationParam: Orientation | undefined;
    flow: boolean;
  } {
    const boardType = boardTypeSelect.value as BoardType;
    const annotationsMode = annotationsSelect.value as AnnotationsMode;
    const orientationChoice = orientationSelect.value as OrientationChoice;

    // Omit annotations entirely when the board type cannot host them, so the
    // engine receives no annotation intent for an incapable type (it does not
    // clear stored content — preserved notes survive and reappear in Custom).
    let annotations: AnnotationParam | undefined;
    if (annotationsCapableFor(boardType)) {
      if (annotationsMode === "compact") annotations = { mode: "compact" };
      else if (annotationsMode === "expanded") annotations = { mode: "expanded" };
    }

    let orientationParam: Orientation | undefined;
    if (
      orientationChoice === "row" ||
      orientationChoice === "column" ||
      orientationChoice === "grid"
    ) {
      orientationParam = orientationChoice;
    }

    const orientation: Orientation =
      orientationChoice === "default"
        ? "passthrough"
        : (orientationChoice as Orientation);

    return {
      boardType,
      orientation,
      annotationsMode,
      annotations,
      orientationParam,
      flow: flowCheckbox.checked,
    };
  }

  function classifyLocalDelta(form: ReturnType<typeof readForm>):
    | "none"
    | "annotationsOnly"
    | "layout" {
    if (!appliedSettings) return "layout";
    if (appliedSettings.boardType !== form.boardType) return "layout";
    if (appliedSettings.orientation !== form.orientation) return "layout";
    if (appliedSettings.flow !== form.flow) return "layout";
    // A pending flow-scope gesture (flow ON + a 2+ subset selected) is a
    // layout-level change even when no form field moved, so Apply is never
    // blocked as "no changes". The engine re-derives the scope from the live
    // selection and no-ops if it matches what is already stored.
    if (form.flow && currentFlowWouldScope) return "layout";
    if (appliedSettings.annotationsMode !== form.annotationsMode) {
      return "annotationsOnly";
    }
    return "none";
  }

  // ---------- Click handler ----------
  runBtn.addEventListener("click", async () => {
    if (busy) return;
    if (currentMode === "unsupported") return;

    const form = readForm();

    if (currentMode === "edit") {
      const sectionId = currentBoardSectionId;
      if (!sectionId) return;

      const delta = classifyLocalDelta(form);
      if (delta === "none") {
        renderInfo("No changes — adjust a setting before applying.");
        return;
      }
      if (delta === "layout") {
        const turningOffReview =
          appliedSettings?.boardType === "design-review" &&
          form.boardType !== "design-review";
        // Surface selective-flow scoping in the confirm so it is never silent.
        const scopeLine =
          flowCheckbox.checked &&
          currentFlowWouldScope &&
          currentFlowScopeCount >= 2
            ? " Flow will connect only the " +
              currentFlowScopeCount +
              " selected screens, in selection order."
            : "";
        const ok = await inlineConfirm({
          title: turningOffReview ? "Remove review cards?" : "Update board layout?",
          body: turningOffReview
            ? "Switching away from Design Review removes the Review Card under each screen, including any feedback typed into them. Edited card titles, descriptions, and renamed frames are still preserved. This cannot be undone from the panel." +
              scopeLine
            : "The layout will be rebuilt with the new orientation / settings. Text you edited (section and card titles, descriptions, and review feedback) and any frames you renamed are always preserved. Manual spacing tweaks on the container or cards may reset to baseline defaults." +
              scopeLine,
          confirmLabel: turningOffReview ? "Remove review cards" : "Update layout",
          cancelLabel: "Cancel",
        });
        if (!ok) return;
      }

      setBusy(true);
      resultHost.innerHTML = "";

      ctx.trackEvent("organize_screens_apply", {
        delta,
        boardType: form.boardType,
        orientation: form.orientation,
        annotations: form.annotationsMode,
      });

      const params: {
        boardType: BoardType;
        annotations?: AnnotationParam;
        orientation?: Orientation;
        flow?: boolean;
      } = { boardType: form.boardType };
      if (form.annotations !== undefined) params.annotations = form.annotations;
      if (form.orientationParam !== undefined)
        params.orientation = form.orientationParam;
      params.flow = flowCheckbox.checked;

      ctx.send({
        type: "apply-board-changes",
        sectionId,
        params,
      });
      return;
    }

    // Generate / arrange path.
    setBusy(true);
    resultHost.innerHTML = "";

    ctx.trackEvent("organize_screens_run", {
      boardType: form.boardType,
      annotations: form.annotationsMode,
      orientation:
        form.orientationParam === undefined ? "default" : form.orientationParam,
    });

    const params: {
      boardType: BoardType;
      annotations?: AnnotationParam;
      orientation?: Orientation;
      acceptedVariantGroupKeys?: string[];
      flow?: boolean;
    } = { boardType: form.boardType };
    if (form.annotations !== undefined) params.annotations = form.annotations;
    if (form.orientationParam !== undefined)
      params.orientation = form.orientationParam;
    if (form.flow) params.flow = true;
    // Only send the acceptance list when groups were proposed. An empty
    // array means "accept none"; omitting it (no proposals) accepts all.
    if (proposedVariantGroups.length) {
      params.acceptedVariantGroupKeys = proposedVariantGroups
        .filter((group) => variantAccept[group.key] !== false)
        .map((group) => group.key);
    }

    ctx.send({
      type: "run-skill",
      skill: "organize-screens",
      params,
    });
  });

  // ---------- In-place flow handler ----------
  flowBtn.addEventListener("click", () => {
    if (busy || !currentFlowEligible) return;
    setBusy(true);
    resultHost.innerHTML = "";
    ctx.trackEvent("organize_screens_flow_inplace", {});
    ctx.send({
      type: "run-skill",
      skill: "organize-screens",
      params: { flowInPlace: true },
    });
  });

  // ---------- Analyze design handlers (Describe / Review / Reset) ----------
  function analyzeTarget(): "card" | "section" {
    return currentAnalyze && currentAnalyze.target === "section" ? "section" : "card";
  }

  async function startAnalyze(scope: "describe" | "review") {
    if (busy || analyzeBusy) return;
    if (!analyzeEligible()) return;

    const target = analyzeTarget();
    if (target === "section") {
      const n = (currentAnalyze && currentAnalyze.screenCount) || 0;
      const verb = scope === "describe" ? "Describe" : "Review";
      const ok = await inlineConfirm({
        title: verb + " all " + n + " screens?",
        body:
          "This runs the AI on every screen in this section (" +
          n +
          " calls)" +
          (scope === "describe"
            ? ", then writes the section title and description."
            : ".") +
          " Existing text in those fields is overwritten.",
        confirmLabel: verb,
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      if (busy || analyzeBusy) return;
      if (!analyzeEligible()) return;
    }

    setAnalyzeBusy(true, scope);
    resultHost.innerHTML = "";
    ctx.trackEvent("organize_screens_analyze", {
      scope,
      target,
      screenCount: (currentAnalyze && currentAnalyze.screenCount) || 0,
      hasExistingContent: !!(currentAnalyze && currentAnalyze.hasExistingContent),
    });
    ctx.send({ type: "analyze-design", scope, target });
  }

  describeBtn.addEventListener("click", () => startAnalyze("describe"));
  reviewBtn.addEventListener("click", () => startAnalyze("review"));

  resetReviewBtn.addEventListener("click", async () => {
    if (busy || analyzeBusy) return;
    if (!analyzeEligible()) return;

    const target = analyzeTarget();
    const n = (currentAnalyze && currentAnalyze.screenCount) || 0;
    const body =
      target === "section"
        ? "This clears the review section (What's good, Questions, Concerns, Ideas, Notes) on all " +
          n +
          " screens back to placeholder text, removing both AI-generated and hand-written feedback. Screen descriptions and the section title/description are left unchanged."
        : "This clears the review section (What's good, Questions, Concerns, Ideas, Notes) back to placeholder text, removing both AI-generated and hand-written feedback. The screen description is left unchanged.";

    const ok = await inlineConfirm({
      title: target === "section" ? "Reset review on " + n + " screens?" : "Reset review results?",
      body,
      confirmLabel: "Reset",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    if (busy || analyzeBusy) return;
    if (!analyzeEligible()) return;

    setAnalyzeBusy(true, "resetReview");
    resultHost.innerHTML = "";
    ctx.trackEvent("organize_screens_reset_review", { target, screenCount: n });
    ctx.send({ type: "reset-review", target });
  });

  // ---------- Create Documentation handlers (Functional Analysis) ----------
  function documentTarget(): "card" | "section" {
    return currentDocument && currentDocument.target === "section"
      ? "section"
      : "card";
  }

  documentBtn.addEventListener("click", async () => {
    if (busy || analyzeBusy) return;
    if (!documentEligible()) return;

    const target = documentTarget();
    if (target === "section") {
      const n = (currentDocument && currentDocument.screenCount) || 0;
      const ok = await inlineConfirm({
        title: "Document all " + n + " screens?",
        body:
          "This runs the AI on every screen in this section (" +
          n +
          " calls) and writes functional documentation into each Functional Card. Existing text in those fields is overwritten.",
        confirmLabel: "Create Documentation",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      if (busy || analyzeBusy) return;
      if (!documentEligible()) return;
    }

    setAnalyzeBusy(true, "document");
    resultHost.innerHTML = "";
    ctx.trackEvent("organize_screens_create_documentation", {
      target,
      screenCount: (currentDocument && currentDocument.screenCount) || 0,
      hasExistingContent: !!(currentDocument && currentDocument.hasExistingContent),
    });
    ctx.send({ type: "create-documentation", target });
  });

  resetDocumentationBtn.addEventListener("click", async () => {
    if (busy || analyzeBusy) return;
    if (!documentEligible()) return;

    const target = documentTarget();
    const n = (currentDocument && currentDocument.screenCount) || 0;
    const body =
      target === "section"
        ? "This clears every Functional Card section on all " +
          n +
          " screens back to placeholder text, removing both AI-generated and hand-written documentation."
        : "This clears the Functional Card sections back to placeholder text, removing both AI-generated and hand-written documentation.";

    const ok = await inlineConfirm({
      title:
        target === "section"
          ? "Reset documentation on " + n + " screens?"
          : "Reset documentation?",
      body,
      confirmLabel: "Reset",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    if (busy || analyzeBusy) return;
    if (!documentEligible()) return;

    setAnalyzeBusy(true, "resetDocumentation");
    resultHost.innerHTML = "";
    ctx.trackEvent("organize_screens_reset_documentation", { target, screenCount: n });
    ctx.send({ type: "reset-documentation", target });
  });

  // ---------- Reset-to-screens handler ----------
  resetBtn.addEventListener("click", async () => {
    if (busy) return;
    const sectionId = currentBoardSectionId;
    if (!sectionId) return;
    if (currentMode !== "edit") return;

    const ok = await inlineConfirm({
      title: "Reset to screens only?",
      body: "This will remove all review, annotations, and layout structure. Original screens will remain unchanged.",
      confirmLabel: "Reset",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setBusy(true);
    resultHost.innerHTML = "";
    ctx.trackEvent("organize_screens_reset", { mode: currentMode });
    ctx.send({ type: "reset-board", sectionId });
  });

  // ---------- Result / error rendering ----------
  function renderResult(result: unknown) {
    resultHost.innerHTML = "";
    const r =
      result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : {};
    const operation =
      typeof r.operation === "string" ? r.operation : "compose";
    const delta = typeof r.delta === "string" ? r.delta : null;

    const block = document.createElement("div");
    block.className = "result";

    let summary: Array<[string, string]> = [];
    if (operation === "flowArrows") {
      summary = [
        ["Operation", "Flow arrows"],
        ["Arrows", String(r.arrowCount ?? "?")],
        [
          "Scope",
          r.scope === "sections" ? "Section screens" : "Selected screens",
        ],
      ];
    } else if (operation === "arrangeSectionsGrid") {
      summary = [
        ["Operation", "Section grid"],
        ["Sections", String(r.sectionCount ?? "?")],
        ["Columns", String(r.columns ?? "?")],
        ["Gap", String(r.sectionGridGap ?? "?") + "px"],
        ["Board Type", String(r.boardType ?? "?")],
        ["Orientation", String(r.orientation ?? "passthrough")],
      ];
    } else if (operation === "apply") {
      summary = [
        ["Operation", "Apply changes"],
        ["Change", delta === "annotationsOnly" ? "Annotations only" : delta || "—"],
        ["Cards", String(r.cardCount ?? "?")],
      ];
    } else if (operation === "recompose") {
      summary = [
        ["Operation", "Recompose"],
        ["Cards", String(r.cardCount ?? "?")],
        ["Columns", String(r.columns ?? "?")],
        ["Strategy", String(r.strategy ?? "?")],
        ["Board Type", String(r.boardType ?? "?")],
        ["Orientation", String(r.orientation ?? "passthrough")],
      ];
    } else if (operation === "resetToScreens") {
      summary = [
        ["Operation", "Reset to screens"],
        ["Screens kept", String(r.freedFrameCount ?? "?")],
      ];
      const skipped =
        typeof r.skippedRemovedCount === "number" ? r.skippedRemovedCount : 0;
      if (skipped > 0) {
        summary.push(["Removed earlier", String(skipped)]);
      }
    } else {
      summary = [
        ["Operation", "Compose"],
        ["Cards", String(r.cardCount ?? "?")],
        ["Columns", String(r.columns ?? "?")],
        [
          "Strategy",
          String(
            (r.compositionPlanSummary as Record<string, unknown> | undefined)
              ?.strategy ?? r.gridOrientation ?? "?"
          ),
        ],
        ["Board Type", String(r.boardType ?? "?")],
        ["Orientation", String(r.orientation ?? "passthrough")],
      ];
      const groups = Array.isArray(r.variantGroups)
        ? (r.variantGroups as unknown[])
        : [];
      if (groups.length) {
        summary.push(["Comparison groups", String(groups.length)]);
      }
    }

    for (const [k, v] of summary) {
      const row = document.createElement("div");
      row.className = "result-row";
      const keyEl = document.createElement("span");
      keyEl.className = "result-key";
      keyEl.textContent = k;
      const valEl = document.createElement("span");
      valEl.className = "result-value";
      valEl.textContent = v;
      row.appendChild(keyEl);
      row.appendChild(valEl);
      block.appendChild(row);
    }

    resultHost.appendChild(block);

    // Refresh appliedSettings so the next delta classification compares
    // against what was just applied.
    if (operation === "apply" || operation === "recompose") {
      const form = readForm();
      appliedSettings = {
        boardType: form.boardType,
        orientation: form.orientation,
        annotationsMode: form.annotationsMode,
        flow: form.flow,
      };
      if (currentBoardSectionId) {
        const annEnabled = form.annotationsMode !== "off";
        lastContextFingerprint = boardSettingsFingerprint(
          currentBoardSectionId,
          {
            boardType: form.boardType,
            orientation: form.orientation,
            annotations: {
              enabled: annEnabled,
              mode: form.annotationsMode === "expanded" ? "expanded" : "compact",
              position: "belowDescription",
            },
            flow: form.flow,
          }
        );
      }
    }
  }

  function renderError(message: string) {
    resultHost.innerHTML = "";
    const block = document.createElement("div");
    block.className = "result-error";
    block.textContent = "Failed: " + message;
    resultHost.appendChild(block);
  }

  function renderInfo(message: string) {
    resultHost.innerHTML = "";
    const block = document.createElement("div");
    block.className = "result";
    block.textContent = message;
    resultHost.appendChild(block);
  }

  function analyzeProgressLabel(phase: string, message?: string): string {
    if (message) return message;
    if (phase === "exporting") return "Exporting screen\u2026";
    if (phase === "analyzing") return "Analyzing design with AI\u2026";
    if (phase === "applying") return "Writing feedback to the card\u2026";
    return "Working\u2026";
  }

  type AnalyzeResultOperation =
    | "describe"
    | "review"
    | "resetReview"
    | "document"
    | "resetDocumentation";

  function analyzeOperationLabel(
    operation: AnalyzeResultOperation,
    target?: "card" | "section"
  ): string {
    const suffix = target === "section" ? " (section)" : "";
    if (operation === "describe") return "Describe screen" + suffix;
    if (operation === "resetReview") return "Reset review results" + suffix;
    if (operation === "document") return "Create Documentation" + suffix;
    if (operation === "resetDocumentation") return "Reset documentation" + suffix;
    return "Review design" + suffix;
  }

  function renderAnalyzeResult(
    operation: AnalyzeResultOperation,
    applied: string[],
    skipped: string[],
    cardName?: string,
    target?: "card" | "section",
    screenCount?: number
  ) {
    resultHost.innerHTML = "";
    const block = document.createElement("div");
    block.className = "result";

    const isReset =
      operation === "resetReview" || operation === "resetDocumentation";
    const updatedEmpty = isReset
      ? "Nothing (already at placeholders)"
      : "Nothing (no new content)";
    const summary: Array<[string, string]> = [
      ["Operation", analyzeOperationLabel(operation, target)],
    ];
    if (cardName) summary.push([target === "section" ? "Section" : "Screen", cardName]);
    if (target === "section" && typeof screenCount === "number") {
      summary.push(["Screens", String(screenCount)]);
    }
    summary.push([
      isReset ? "Reset" : "Updated",
      applied.length ? applied.join(", ") : updatedEmpty,
    ]);
    if (skipped.length) summary.push(["Could not update", skipped.join(", ")]);

    for (const [k, v] of summary) {
      const row = document.createElement("div");
      row.className = "result-row";
      const keyEl = document.createElement("span");
      keyEl.className = "result-key";
      keyEl.textContent = k;
      const valEl = document.createElement("span");
      valEl.className = "result-value";
      valEl.textContent = v;
      row.appendChild(keyEl);
      row.appendChild(valEl);
      block.appendChild(row);
    }
    resultHost.appendChild(block);
  }

  // ---------- Plugin message + selection subscription ----------
  const unsubscribePlugin = ctx.onPluginMessage((msg) => {
    if (msg.type === "skill-result" && msg.skill === "organize-screens") {
      setBusy(false);
      renderResult(msg.result);
    } else if (
      msg.type === "skill-error" &&
      msg.skill === "organize-screens"
    ) {
      setBusy(false);
      renderError(msg.error);
    } else if (msg.type === "analyze-design-progress") {
      renderInfo(analyzeProgressLabel(msg.phase, msg.message));
    } else if (msg.type === "analyze-design-result") {
      setAnalyzeBusy(false);
      renderAnalyzeResult(
        msg.operation,
        msg.applied,
        msg.skipped,
        msg.cardName,
        msg.target,
        msg.screenCount
      );
    } else if (msg.type === "analyze-design-error") {
      setAnalyzeBusy(false);
      renderError(msg.message);
    }
  });

  const unsubscribeContext = ctx.onSelectionContextChange(
    "organize-screens",
    (context) => {
      applyContext(context as OrganizeScreensSelectionContext);
    }
  );

  // Prime the panel with whatever the shell already saw, and ask the
  // runtime for a fresh probe in case the panel was opened from the
  // landing page after a selection change.
  const seeded = ctx.getSelectionContext("organize-screens");
  if (seeded) {
    applyContext(seeded as OrganizeScreensSelectionContext);
  } else {
    applyContext({ mode: "idle", reason: "no-context-yet" });
  }
  ctx.send({ type: "probe-selection" });

  return {
    dispose() {
      unsubscribePlugin();
      unsubscribeContext();
    },
  };
}
