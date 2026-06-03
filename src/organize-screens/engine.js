// Organize Screens engine — runs inside Figma plugin context.
//
// This file is the SOURCE OF TRUTH for the composition engine.
// The same code is inlined into src/cursor_mcp_plugin/code.js between
// the ORGANIZE_SCREENS_ENGINE:START / END markers.
// Run `bun run build:plugin` after editing this file to re-inject it.
//
// Board Types are the primary system. A Board Type is a deterministic behavior
// profile (layout tokens, rhythm, grouping, optional annotation affordances)
// plus an optional per-card review surface:
//   - `custom`        — the calibrated identity baseline (default).
//   - `design-review` — same baseline layout + an editable Review Card per
//                        screen (structured feedback surface, native text).
// Legacy "personality" ids (review, presentation, portfolio, workshop,
// documentation) all map to `custom`. Orientation (row / column / grid) remains
// an opt-in axis above the baseline strategy.

/* ORGANIZE_SCREENS_ENGINE:START */
const OS_ENGINE_VERSION = 9;
const OS_METADATA_NAMESPACE = "organizeScreens";
const OS_METADATA_KEY = "metadata";
// Tiny, always-writable positive marker for "this is a modern Board Types
// board". The full envelope can exceed Figma's 100 kB per-entry shared-plugin-
// data limit on large boards; this few-byte marker never does, so board
// classification stays correct (modern, never "legacy") even if the envelope
// write is trimmed or fails.
const OS_BOARDTYPE_KEY = "boardType";
// Bumped to 3 when the per-card copy baseline gained an optional `annotation`
// field (preserved note text + placement). osReadBoardMetadata/osNormalizeMetadata
// tolerate its absence, so older envelopes upgrade transparently.
const OS_METADATA_SCHEMA_VERSION = 3;

// Multi-proposal (A/B/C) Pros/Cons slot colors. Hex fallbacks — generated
// nodes cannot read the iframe's --figma-color-* tokens, so we set SOLID
// fills directly (consistent with the rest of the engine). A future version
// can bind these to an "Organize Screens / Status" variable collection.
const OS_VARIANT_COLORS = {
  prosBg: { r: 0.8157, g: 0.9412, b: 0.8706 }, // #D0F0DE
  prosText: { r: 0.0706, g: 0.3686, b: 0.1961 }, // #125E32
  consBg: { r: 0.9843, g: 0.8902, b: 0.8902 }, // #FBE3E3
  consText: { r: 0.4784, g: 0.1216, b: 0.1216 }, // #7A1F1F
};

// Base tokens — calibrated from the Messages Flow Overview reference board.
// These define the Custom baseline. A Board Type profile may scale or
// override specific fields via BOARD_TYPES below; it never edits
// OS_BASE_TOKENS.
const OS_BASE_TOKENS = {
  // Spacing.
  gridGapX: 120,
  stripGapY: 88,
  sectionContentGap: 88,
  headerGap: 20,
  cardGap: 32,
  // Design Review body row: horizontal gap between screen and review columns.
  cardBodyGapX: 120,
  sectionPadding: 128,
  cardPadding: 56,
  // Layout heuristics.
  maxColumns: 4,
  maxColumnsPerStrip: 5,
  wideScreenWidth: 1200,
  mediumScreenWidth: 900,
  // Typography (Inter).
  fontFamily: "Inter",
  titleFontSize: 84,
  titleStyle: "Semi Bold",
  headerDescFontSize: 32,
  headerDescStyle: "Regular",
  // Overview Header Section Description wraps at this width (not full-bleed).
  sectionDescriptionMaxWidth: 1620,
  cardTitleFontSize: 42,
  cardTitleStyle: "Semi Bold",
  cardDescFontSize: 29,
  cardDescStyle: "Regular",
  groupLabelFontSize: 36,
  groupLabelStyle: "Semi Bold",
  annotationFontSize: 24,
  annotationStyle: "Regular",
  // Colors.
  bgColor: { r: 0.944, g: 0.944, b: 0.944 },
  cardBgColor: { r: 0.98, g: 0.98, b: 0.98 },
  textColor: { r: 0.07, g: 0.07, b: 0.07 },
  mutedTextColor: { r: 0.4, g: 0.4, b: 0.45 },
  cardCornerRadius: 12,
  cardStroke: { r: 0.84, g: 0.84, b: 0.875 },
  heroStroke: { r: 0.55, g: 0.55, b: 0.6 },
  annotationStroke: { r: 0.76, g: 0.76, b: 0.8 },
  annotationBgColor: { r: 1, g: 1, b: 1 },
  // Multi-board section grid.
  sectionGridGap: 1500,
  // Flow arrows (Show as flow). Personality-agnostic single style.
  flowStrokeColor: { r: 0.17, g: 0.18, b: 0.26 },
  flowStrokeWeight: 10,
  flowAnchorGap: 16,
  // Target arrow length (center-to-center, clamped to the actual distance).
  // A fixed length keeps arrows boldly visible instead of collapsing into the
  // short gap between adjacent cards.
  flowArrowLength: 500,
  // Flow label: an editable pill placed just below each arrow describing the
  // step. `flowLabelGap` is the vertical offset below the arrow line.
  flowLabelFontSize: 28,
  flowLabelStyle: "Regular",
  flowLabelGap: 28,
  flowLabelPlaceholder: "Describe interaction ...",
  flowLabelTextColor: { r: 0.17, g: 0.18, b: 0.26 },
  flowLabelBgColor: { r: 1, g: 1, b: 1 },
  flowLabelStroke: { r: 0.17, g: 0.18, b: 0.26 },
  flowLabelPaddingX: 20,
  flowLabelPaddingY: 12,
  flowLabelCornerRadius: 10,
  // Review Card (Design Review board type). A structured, editable feedback
  // surface appended below each Screen Card. All fields are native text nodes
  // so anyone can edit them without the plugin. Calibrated to the same rhythm
  // as the rest of the card so it reads as part of the composition.
  reviewGap: 28,
  reviewPadding: 36,
  reviewSectionGap: 32,
  reviewLabelFieldGap: 12,
  reviewTitleFontSize: 32,
  reviewTitleStyle: "Semi Bold",
  reviewLabelFontSize: 27,
  reviewLabelStyle: "Semi Bold",
  reviewFieldFontSize: 26,
  reviewFieldStyle: "Regular",
  reviewStatusFontSize: 24,
  reviewStatusStyle: "Semi Bold",
  reviewFieldPaddingX: 24,
  reviewFieldPaddingY: 18,
  reviewFieldMinHeight: 88,
  reviewNotesMinHeight: 160,
  reviewFieldCornerRadius: 10,
  reviewCardCornerRadius: 12,
  // Design Review v2 (reference 744:27318): side-by-side columns + pill header.
  reviewColumnWidth: 923,
  reviewHeaderPaddingY: 24,
  reviewHeaderPaddingX: 40,
  reviewHeaderCornerRadius: 2000,
  reviewHeaderStroke: { r: 0.749, g: 0.749, b: 0.749 },
  reviewContentPaddingX: 40,
  // Legacy vertical review panel (text status fallback only).
  reviewBgColor: { r: 0.965, g: 0.965, b: 0.975 },
  reviewStroke: { r: 0.84, g: 0.84, b: 0.875 },
  reviewFieldBgColor: { r: 1, g: 1, b: 1 },
  reviewFieldStroke: { r: 0.8, g: 0.8, b: 0.84 },
  reviewLabelColor: { r: 0.12, g: 0.12, b: 0.15 },
  reviewPlaceholderColor: { r: 0.55, g: 0.55, b: 0.6 },
  reviewStatusBgColor: { r: 0.9, g: 0.92, b: 0.97 },
  reviewStatusTextColor: { r: 0.17, g: 0.18, b: 0.26 },
  reviewStatusPaddingX: 18,
  reviewStatusPaddingY: 8,
  reviewStatusCornerRadius: 999,
  // Decision card (comparative variant groups). A slightly warmer/darker panel
  // than the Review Card so the cross-option decision surface reads as distinct
  // from the per-variant comparative cards beside it.
  decisionBgColor: { r: 0.945, g: 0.95, b: 0.99 },
  // Variant Group panel — wraps a variant strip (its cards + the Decision card)
  // with a title ("N variants") on a distinct tinted panel so each comparison
  // reads as one grouped unit on the board.
  variantGroupBgColor: { r: 0.918, g: 0.925, b: 0.945 },
  variantGroupStroke: { r: 0.82, g: 0.83, b: 0.865 },
  variantGroupPadding: 72,
  variantGroupTitleGap: 56,
  variantGroupCornerRadius: 16,
  variantGroupTitleColor: { r: 0.18, g: 0.19, b: 0.27 },
};

// Legacy alias — kept so external code reading OS_TOKENS still works.
const OS_TOKENS = OS_BASE_TOKENS;

// Review Card structure (Design Review board type). sharedPluginData lets the
// plugin (and future extraction tooling) find review fields deterministically
// even after a reviewer renames or moves layers.
const OS_REVIEW_NAMESPACE = "organizeScreens";
const OS_REVIEW_FIELD_KEY = "osReviewField"; // tag on each editable field text
const OS_REVIEW_CARD_KEY = "osReviewCard"; // tag on the Review Card frame (= source frame id)
const OS_FUNC_FIELD_KEY = "osFuncField"; // tag on each editable functional section text (= sectionKey)
const OS_FUNC_CARD_KEY = "osFuncCard"; // tag on the Functional Card frame (= source frame id)
const OS_ANNOTATION_FIELD_KEY = "osAnnotationField"; // tag on the Annotation Hint text (= source frame id)
// Annotation slot heights are 240 (compact) / 400 (expanded); use the midpoint
// to recover the mode from a live slot when its placeholder copy was edited.
const OS_ANNOTATION_EXPANDED_MIN = 320;

// Review framework registry. A review framework is an ordered set of editable
// feedback `sections` plus a freeform `notes` field. It is deliberately modeled
// like BOARD_TYPES / OS_ORIENTATIONS so future evaluation frameworks (SWOT,
// Impact/Effort, Risk, Decision Matrix) are added as new entries here without
// touching the builders, extraction, placeholders, or preservation — all of
// which are keyed by section `key`.
//   - `standard`    — single-screen review (observations about one design).
//   - `comparative` — variant (A/B/C) review (advantages/disadvantages relative
//                     to the other options being compared).
// `label` is the on-canvas header; the editable field is pre-filled with
// `placeholder` (muted) until a reviewer types real feedback.
const REVIEW_FRAMEWORKS = {
  standard: {
    id: "standard",
    label: "Standard Review",
    sections: [
      { key: "workingWell", label: "\uD83D\uDC4D What's good", placeholder: "Click to add feedback..." },
      { key: "questions", label: "\u2753 Questions", placeholder: "Add questions here..." },
      { key: "concerns", label: "\u26A0 Concerns", placeholder: "Add concerns here..." },
      { key: "ideas", label: "\uD83D\uDCA1 Ideas", placeholder: "Write ideas..." },
    ],
    notes: { key: "notes", label: "Notes", placeholder: "Add any additional feedback..." },
  },
  comparative: {
    id: "comparative",
    label: "Comparative Review",
    sections: [
      { key: "pros", label: "\uD83D\uDC4D Pros", placeholder: "Advantages vs the other options..." },
      { key: "cons", label: "\u26A0 Cons", placeholder: "Disadvantages vs the other options..." },
      { key: "openQuestions", label: "\u2753 Open Questions", placeholder: "Unresolved questions about this option..." },
      { key: "improvementIdeas", label: "\uD83D\uDCA1 Improvement Ideas", placeholder: "Ways this option could be improved..." },
    ],
    notes: { key: "decisionNotes", label: "Decision Notes", placeholder: "Notes toward a decision..." },
  },
};

function osResolveReviewFramework(id) {
  if (id && REVIEW_FRAMEWORKS[id]) return REVIEW_FRAMEWORKS[id];
  return REVIEW_FRAMEWORKS.standard;
}

// Back-compat aliases: the standard framework remains the default single-screen
// review surface. Existing callers that referenced these constants keep working.
const OS_REVIEW_SECTIONS = REVIEW_FRAMEWORKS.standard.sections;
const OS_REVIEW_NOTES = REVIEW_FRAMEWORKS.standard.notes;

// Decision card (comparative variant groups): the cross-option outcome, built
// as a sibling card at the end of each Variant Strip. Distinct from any single
// option's `decisionNotes` field.
const OS_DECISION_CARD = {
  title: "Decision",
  fields: [
    { key: "preferredOption", label: "Preferred option", placeholder: "Which option are we moving forward with?" },
    { key: "rationale", label: "Rationale", placeholder: "Why this option..." },
    { key: "risks", label: "Risks", placeholder: "Risks / trade-offs to watch..." },
    { key: "followUps", label: "Follow-ups", placeholder: "Next steps / open actions..." },
  ],
  cardKey: "osDecisionCard", // sharedPluginData tag on the Decision card frame (= group key)
};

const OS_REVIEW_HEADER = {
  title: "Review",
  descriptionKey: "headerDescription",
  descriptionPlaceholder: "Add a short description...",
};

// Global catalog of every section def across all frameworks, keyed by section
// key, so the Review Card builder can resolve any framework's section.
const OS_REVIEW_SECTION_BY_KEY = (function () {
  const map = {};
  for (const fid in REVIEW_FRAMEWORKS) {
    if (!Object.prototype.hasOwnProperty.call(REVIEW_FRAMEWORKS, fid)) continue;
    const fw = REVIEW_FRAMEWORKS[fid];
    for (let i = 0; i < fw.sections.length; i++) {
      map[fw.sections[i].key] = fw.sections[i];
    }
  }
  return map;
})();

function osIsReviewListFieldKey(fieldKey) {
  return !!(fieldKey && OS_REVIEW_SECTION_BY_KEY[fieldKey]);
}
const OS_REVIEW_STATUS = { key: "status", default: "Draft" };
// Review Status renders as an INSTANCE of a document-scoped COMPONENT_SET the
// plugin creates the first time a Design Review board is composed in the file.
// Reviewers change a screen's status through Figma's native variant picker on
// the instance. The set lives on a dedicated, off-canvas assets page; its id is
// persisted on figma.root so later boards reuse it instead of recreating it.
const OS_REVIEW_STATUS_PROPERTY = "Status";
// Fallback when the plugin must create its own set (no file-local master).
// Matches the User-Centric Hub ".Design Review" status set on WORKING AREA.
const OS_REVIEW_STATUS_VARIANTS = [
  "Draft",
  "Approved",
  "Blocked",
  "Needs work",
  "Ready for dev",
];
// Per-status pill colors (0–1 RGB) for plugin-created "Review Status" sets only.
// Adopted file masters (e.g. ".Design Review") keep their canvas colors.
const OS_REVIEW_STATUS_VARIANT_STYLES = {
  Draft: {
    bg: { r: 0.9, g: 0.92, b: 0.97 },
    text: { r: 0.17, g: 0.18, b: 0.26 },
  },
  Approved: {
    bg: { r: 0.8211, g: 0.9433, b: 0.7503 },
    text: { r: 0.17, g: 0.18, b: 0.26 },
  },
  Blocked: {
    bg: { r: 1, g: 0.8605, b: 0.8605 },
    text: { r: 0.17, g: 0.18, b: 0.26 },
  },
  "Needs work": {
    bg: { r: 0.97, g: 0.9175, b: 0.9 },
    text: { r: 0.17, g: 0.18, b: 0.26 },
  },
  "Ready for dev": {
    bg: { r: 0.9816, g: 0.8528, b: 0.9959 },
    text: { r: 0.17, g: 0.18, b: 0.26 },
  },
  // Legacy boards composed with the old four-variant set.
  "In Review": {
    bg: { r: 0.97, g: 0.9175, b: 0.9 },
    text: { r: 0.17, g: 0.18, b: 0.26 },
  },
};
const OS_ASSETS_PAGE_NAME = "Organize Screens / Assets";
const OS_REVIEW_STATUS_SET_NAME = "Review Status";
const OS_REVIEW_STATUS_SET_KEY = "reviewStatusComponentSetId"; // on figma.root
// File-local design-system master (User-Centric Hub WORKING AREA).
const OS_DESIGN_REVIEW_STATUS_SET_NAMES = [".Design Review", "Design Review"];
const OS_DESIGN_REVIEW_STATUS_SET_KEY = "designReviewStatusComponentSetId";

// Lookup of every placeholder string by field key — used by extraction to
// distinguish "still placeholder" (empty) from real reviewer text. Built from
// every review framework's sections + notes, plus the Decision card fields, so
// new frameworks are covered automatically.
const OS_REVIEW_PLACEHOLDERS = (function () {
  const map = {};
  map[OS_REVIEW_HEADER.descriptionKey] = OS_REVIEW_HEADER.descriptionPlaceholder;
  for (const fid in REVIEW_FRAMEWORKS) {
    if (!Object.prototype.hasOwnProperty.call(REVIEW_FRAMEWORKS, fid)) continue;
    const fw = REVIEW_FRAMEWORKS[fid];
    map[fw.notes.key] = fw.notes.placeholder;
    for (let i = 0; i < fw.sections.length; i++) {
      map[fw.sections[i].key] = fw.sections[i].placeholder;
    }
  }
  for (let i = 0; i < OS_DECISION_CARD.fields.length; i++) {
    map[OS_DECISION_CARD.fields[i].key] = OS_DECISION_CARD.fields[i].placeholder;
  }
  return map;
})();

// Functional section registry (Functional Analysis board type). Sibling to
// REVIEW_FRAMEWORKS: an ordered set of editable documentation `sections`, each
// rendered as exactly one labelled, editable TEXT node (matching the Review
// Card precedent — no nested per-subkey nodes). Nested AI output (inputs /
// outputs, states) is flattened by the analysis mode into labelled multi-line
// text inside the single field. Keyed by section `key` so the builder,
// extraction, placeholders, and AI field map all stay in sync via one source.
const FUNCTIONAL_SECTIONS = {
  functional: {
    id: "functional",
    label: "Functional Analysis",
    sections: [
      { key: "purpose", label: "\uD83C\uDFAF Screen Purpose", placeholder: "Click to document what this screen is for..." },
      { key: "userActions", label: "\uD83D\uDC46 User Actions", placeholder: "List the actions a user can take here..." },
      { key: "systemBehavior", label: "\u2699 System Behavior", placeholder: "Describe how the system responds..." },
      { key: "inputOutput", label: "\uD83D\uDD04 Inputs / Outputs", placeholder: "Inputs accepted / outputs produced..." },
      { key: "states", label: "\uD83D\uDD01 States", placeholder: "Loading, empty, success, error, edge states..." },
      { key: "businessRules", label: "\uD83D\uDCD0 Business Rules", placeholder: "Rules, constraints, validations..." },
      { key: "missingFunctionality", label: "\uD83D\uDEA7 Missing Functionality", placeholder: "Gaps or unfinished behavior..." },
      { key: "openQuestions", label: "\u2753 Open Questions", placeholder: "Assumptions and unresolved questions..." },
    ],
  },
};

function osResolveFunctionalFramework(id) {
  if (id && FUNCTIONAL_SECTIONS[id]) return FUNCTIONAL_SECTIONS[id];
  return FUNCTIONAL_SECTIONS.functional;
}

// Default ordered section defs + key list for the Functional Card.
const OS_FUNCTIONAL_SECTIONS = FUNCTIONAL_SECTIONS.functional.sections;
const OS_FUNCTIONAL_SECTION_KEYS = OS_FUNCTIONAL_SECTIONS.map(function (s) {
  return s.key;
});

// Global catalog of every functional section def, keyed by section key, so the
// Functional Card builder can resolve any configured section.
const OS_FUNCTIONAL_SECTION_BY_KEY = (function () {
  const map = {};
  for (const fid in FUNCTIONAL_SECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(FUNCTIONAL_SECTIONS, fid)) continue;
    const fw = FUNCTIONAL_SECTIONS[fid];
    for (let i = 0; i < fw.sections.length; i++) {
      map[fw.sections[i].key] = fw.sections[i];
    }
  }
  return map;
})();

// Functional Card header (parallel to OS_REVIEW_HEADER). The confidence note is
// rendered (muted) in the header when the AI returns one; not an editable field.
const OS_FUNCTIONAL_HEADER = {
  title: "Functional",
  confidenceKey: "funcConfidence", // tag on the muted header confidence note
};

// Placeholder lookup by section key, so extraction can tell "still placeholder"
// (empty) from real documentation text. Built from the registry automatically.
const OS_FUNCTIONAL_PLACEHOLDERS = (function () {
  const map = {};
  for (const fid in FUNCTIONAL_SECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(FUNCTIONAL_SECTIONS, fid)) continue;
    const fw = FUNCTIONAL_SECTIONS[fid];
    for (let i = 0; i < fw.sections.length; i++) {
      map[fw.sections[i].key] = fw.sections[i].placeholder;
    }
  }
  return map;
})();

// Human-readable labels for applied/skipped reporting in the UI.
const OS_FUNCTIONAL_FIELD_LABELS = (function () {
  const map = {};
  for (let i = 0; i < OS_FUNCTIONAL_SECTIONS.length; i++) {
    // Strip the leading emoji + space for a clean report label.
    const def = OS_FUNCTIONAL_SECTIONS[i];
    const parts = def.label.split(" ");
    map[def.key] = parts.length > 1 ? parts.slice(1).join(" ") : def.label;
  }
  return map;
})();

// Advanced (single-document) Functional mode. Instead of the 8 structured
// fields above, the Functional Card renders ONE editable TEXT node tagged with
// this key, holding a long-form markdown report. Registered alongside the 8
// section keys so extraction, placeholders, and labels stay registry-driven.
const OS_FUNCTIONAL_DOC_KEY = "functionalDoc";
const OS_FUNCTIONAL_DOC_SECTION = {
  key: OS_FUNCTIONAL_DOC_KEY,
  label: "\uD83D\uDCC4 Functional Documentation",
  placeholder:
    "Click to document this screen's functionality, or run Create Documentation...",
};
OS_FUNCTIONAL_PLACEHOLDERS[OS_FUNCTIONAL_DOC_KEY] =
  OS_FUNCTIONAL_DOC_SECTION.placeholder;
OS_FUNCTIONAL_SECTION_BY_KEY[OS_FUNCTIONAL_DOC_KEY] = OS_FUNCTIONAL_DOC_SECTION;
OS_FUNCTIONAL_FIELD_LABELS[OS_FUNCTIONAL_DOC_KEY] = "Functional Documentation";

// Normalize functional settings. Mirrors osNormalizeReviewSettings: defaults to
// "basic" (the original 8-field structure) so older boards without the field
// migrate transparently. The board type does not change the default — mode is
// only meaningful on functional-analysis boards but is persisted regardless so
// a round trip restores it.
function osNormalizeFunctionalSettings(fn, boardTypeId) {
  void boardTypeId;
  const mode = fn && fn.mode === "advanced" ? "advanced" : "basic";
  return { mode: mode };
}

// Board Type registry. A Board Type is a deterministic behavior profile (not a
// visual preset) plus an optional per-card review surface:
//   - `custom`        — the identity baseline (token scales all 1, no emphasis
//                        / grouping / annotation policy). Reproduces the
//                        calibrated baseline output exactly. `reviewCard` null.
//   - `design-review` — clones the `custom` layout profile byte-for-byte and
//                        adds an editable Review Card to each singleton screen
//                        card (see `reviewCard`).
// The resolver (osResolveBoardType) maps any unknown or legacy "personality"
// id (review, presentation, portfolio, workshop, documentation) to `custom`.
const BOARD_TYPES = {
  custom: {
    id: "custom",
    label: "Custom",
    intent: "The calibrated baseline composition.",
    tokenScale: { outerSpacing: 1, innerSpacing: 1, typography: 1 },
    behavior: {
      wideScreenWidth: 1200,
      mediumScreenWidth: 900,
      maxColumns: 4,
      maxPerStrip: 5,
      preferredStrategy: "auto",
      grouping: "none",
      emphasis: "none",
      cardWidthPolicy: "hug",
      annotationPolicy: "none",
    },
    sectionGrid: { gap: 1500, maxColumns: 4 },
    reviewCard: null,
  },
  "design-review": {
    id: "design-review",
    label: "Design Review",
    intent:
      "Baseline layout plus an editable Review Card under each screen.",
    // Byte-identical layout profile to `custom` — Design Review only adds the
    // review surface; it never changes composition, spacing, or grouping.
    tokenScale: { outerSpacing: 1, innerSpacing: 1, typography: 1 },
    behavior: {
      wideScreenWidth: 1200,
      mediumScreenWidth: 900,
      maxColumns: 4,
      maxPerStrip: 5,
      preferredStrategy: "auto",
      grouping: "none",
      emphasis: "none",
      cardWidthPolicy: "hug",
      annotationPolicy: "none",
    },
    sectionGrid: { gap: 1500, maxColumns: 4 },
    reviewCard: {
      enabled: true,
      status: true,
      sections: ["workingWell", "questions", "concerns", "ideas"],
      notes: true,
    },
  },
  "functional-analysis": {
    id: "functional-analysis",
    label: "Functional Analysis",
    intent:
      "Baseline token scales plus a full-width Functional Card stacked under each screen for structured functional documentation.",
    // Reuses `custom`'s token scales, but uses its OWN column policy: a
    // full-width documentation card stacked under each screen makes each card
    // tall, so a 4-wide grid of tall cards scans poorly. Bias toward a readable
    // 1-2 column document list. The orthogonal OS_ORIENTATIONS axis still layers
    // on top, so a user can still pick Row/Grid/Column to override this default.
    tokenScale: { outerSpacing: 1, innerSpacing: 1, typography: 1 },
    behavior: {
      wideScreenWidth: 1200,
      mediumScreenWidth: 900,
      maxColumns: 2,
      maxPerStrip: 2,
      preferredStrategy: "grid",
      grouping: "none",
      emphasis: "none",
      cardWidthPolicy: "hug",
      annotationPolicy: "none",
    },
    sectionGrid: { gap: 1500, maxColumns: 2 },
    reviewCard: null,
    functionalCard: {
      enabled: true,
      sections: [
        "purpose",
        "userActions",
        "systemBehavior",
        "inputOutput",
        "states",
        "businessRules",
        "missingFunctionality",
        "openQuestions",
      ],
    },
  },
};

// Orientation registry. Orientation is a new opt-in primary composition axis
// that sits above strategy selection. When the user does not pass one, the
// resolver returns the `passthrough` orientation: every multiplier is 1 and
// the planner falls back to the board type's preset (the v2 / v3 baseline is
// preserved byte-for-byte).
//
// When an explicit orientation is chosen, it overrides the board type's
// preferredStrategy / emphasis / strategy-level grouping. Board types still
// contribute token scales, column caps, width thresholds, and cardWidthPolicy.
const OS_ORIENTATIONS = {
  passthrough: {
    id: "passthrough",
    label: "Default",
    intent: "Use the board type's own strategy without overriding.",
    strategyMap: "passthrough",
    columnPolicy: "passthrough",
    groupingPolicy: "passthrough",
    rhythm: { outerSpacing: 1, innerSpacing: 1, stripGapY: 1, gridGapX: 1 },
    annotationPreference: { mode: null, position: null },
    cardsPerSegment: 0,
  },
  row: {
    id: "row",
    label: "Row",
    intent: "Single horizontal row — all screens side by side, no wrap limit.",
    strategyMap: "singleRow",
    columnPolicy: "allInOne",
    groupingPolicy: "none",
    rhythm: { outerSpacing: 1, innerSpacing: 1, stripGapY: 1, gridGapX: 1 },
    annotationPreference: { mode: null, position: null },
    cardsPerSegment: 0,
  },
  column: {
    id: "column",
    label: "Column",
    intent: "Single vertical column — all screens stacked, no segment limits.",
    strategyMap: "singleColumn",
    columnPolicy: "allInOne",
    groupingPolicy: "none",
    rhythm: { outerSpacing: 1, innerSpacing: 1, stripGapY: 1.3, gridGapX: 1 },
    annotationPreference: { mode: null, position: "belowDescription" },
    cardsPerSegment: 0,
  },
  grid: {
    id: "grid",
    label: "Grid",
    intent: "Balanced overview grid with breathable rhythm.",
    strategyMap: "balancedGrid",
    columnPolicy: "balanced",
    groupingPolicy: "none",
    rhythm: { outerSpacing: 1, innerSpacing: 1, stripGapY: 1.05, gridGapX: 1.05 },
    annotationPreference: { mode: "compact", position: "belowDescription" },
    cardsPerSegment: 0,
  },
};

function osRound(v) {
  return Math.max(0, Math.round(v));
}

// Total resolver: a known board-type id ("custom" / "design-review") returns
// its profile; every other input — null, a legacy personality id (review /
// presentation / portfolio / workshop / documentation), or any unknown string
// — maps to the `custom` profile. Never throws, so old boards and external
// callers degrade gracefully to the baseline.
function osResolveBoardType(id) {
  if (id && BOARD_TYPES[id]) return BOARD_TYPES[id];
  return BOARD_TYPES.custom;
}

// Back-compat alias. Older inlined callers / external references may still call
// osResolvePersonality; it delegates to the board-type resolver.
function osResolvePersonality(id) {
  return osResolveBoardType(id);
}

// ---------------------------------------------------------------------------
// Board type capabilities.
//
// Capabilities declare which feature TOOLING is available for a board type.
// They gate UI + generation; they NEVER imply data deletion. A capability set
// to `false` only force-disables generation and hides UI — preserved content
// (annotations, reviews) always survives a board-type switch and reappears when
// switching back to a capable type. Capabilities are a pure function of board
// type id, so legacy boards need no migration to gain them.
//
// Only declare flags that are NOT already implied by the profile. `reviewCards`
// is derived from `profile.reviewCard` in osBoardTypeCapabilities so the two can
// never disagree.
const OS_BOARD_TYPE_CAPABILITIES = {
  custom: { annotations: true, flow: true },
  "design-review": { annotations: false, flow: true },
  "functional-analysis": { annotations: false, flow: true },
  // future: handoff { annotations: true, flow: true }
};

// Resolve the capability set for a board type id. Unknown / legacy ids fall back
// to `custom` (the safe default: all tooling available).
function osBoardTypeCapabilities(id) {
  const profile = osResolveBoardType(id);
  const decl =
    OS_BOARD_TYPE_CAPABILITIES[profile.id] || OS_BOARD_TYPE_CAPABILITIES.custom;
  return {
    annotations: decl.annotations === true,
    flow: decl.flow === true,
    reviewCards: !!(profile.reviewCard && profile.reviewCard.enabled),
    documentation: !!(profile.functionalCard && profile.functionalCard.enabled),
  };
}

// Static map of every board type id -> capability set. The UI consumes this so
// it can react to the board-type dropdown in compose mode before any board
// exists, without hardcoding a second source of truth.
function osAllBoardTypeCapabilities() {
  const out = {};
  for (const id in BOARD_TYPES) {
    if (Object.prototype.hasOwnProperty.call(BOARD_TYPES, id)) {
      out[id] = osBoardTypeCapabilities(id);
    }
  }
  return out;
}

function osResolveTokens(base, profile, orientation) {
  const o = profile.tokenScale.outerSpacing;
  const inn = profile.tokenScale.innerSpacing;
  const typ = profile.tokenScale.typography;
  // Orientation rhythm multipliers fold into the resolved tokens so builders
  // never branch on orientation. Default (passthrough) is identity.
  const rhythm =
    orientation && orientation.rhythm
      ? orientation.rhythm
      : { outerSpacing: 1, innerSpacing: 1, stripGapY: 1, gridGapX: 1 };
  return {
    gridGapX: osRound(base.gridGapX * o * rhythm.gridGapX),
    stripGapY: osRound(base.stripGapY * o * rhythm.stripGapY),
    sectionContentGap: osRound(base.sectionContentGap * o),
    headerGap: base.headerGap,
    cardGap: osRound(base.cardGap * inn),
    cardBodyGapX: osRound(base.cardBodyGapX * o),
    sectionPadding: osRound(base.sectionPadding * o),
    cardPadding: osRound(base.cardPadding * inn),
    maxColumns: profile.behavior.maxColumns,
    maxColumnsPerStrip: profile.behavior.maxPerStrip,
    wideScreenWidth: profile.behavior.wideScreenWidth,
    mediumScreenWidth: profile.behavior.mediumScreenWidth,
    fontFamily: base.fontFamily,
    titleFontSize: osRound(base.titleFontSize * typ),
    titleStyle: base.titleStyle,
    headerDescFontSize: osRound(base.headerDescFontSize * typ),
    headerDescStyle: base.headerDescStyle,
    sectionDescriptionMaxWidth: base.sectionDescriptionMaxWidth,
    cardTitleFontSize: osRound(base.cardTitleFontSize * typ),
    cardTitleStyle: base.cardTitleStyle,
    cardDescFontSize: osRound(base.cardDescFontSize * typ),
    cardDescStyle: base.cardDescStyle,
    groupLabelFontSize: osRound(base.groupLabelFontSize * typ),
    groupLabelStyle: base.groupLabelStyle,
    annotationFontSize: base.annotationFontSize,
    annotationStyle: base.annotationStyle,
    bgColor: base.bgColor,
    cardBgColor: base.cardBgColor,
    textColor: base.textColor,
    mutedTextColor: base.mutedTextColor,
    cardCornerRadius: base.cardCornerRadius,
    cardStroke: base.cardStroke,
    heroStroke: base.heroStroke,
    annotationStroke: base.annotationStroke,
    annotationBgColor: base.annotationBgColor,
    sectionGridGap: profile.sectionGrid.gap,
    sectionGridMaxColumns: profile.sectionGrid.maxColumns,
    flowStrokeColor: base.flowStrokeColor,
    flowStrokeWeight: base.flowStrokeWeight,
    flowAnchorGap: base.flowAnchorGap,
    flowArrowLength: base.flowArrowLength,
    flowLabelFontSize: base.flowLabelFontSize,
    flowLabelStyle: base.flowLabelStyle,
    flowLabelGap: base.flowLabelGap,
    flowLabelPlaceholder: base.flowLabelPlaceholder,
    flowLabelTextColor: base.flowLabelTextColor,
    flowLabelBgColor: base.flowLabelBgColor,
    flowLabelStroke: base.flowLabelStroke,
    flowLabelPaddingX: base.flowLabelPaddingX,
    flowLabelPaddingY: base.flowLabelPaddingY,
    flowLabelCornerRadius: base.flowLabelCornerRadius,
    // Review Card. Typography scales with the board type's typography scale so
    // it stays proportional; spacing scales with innerSpacing like card padding.
    reviewGap: osRound(base.reviewGap * inn),
    reviewPadding: osRound(base.reviewPadding * inn),
    reviewSectionGap: osRound(base.reviewSectionGap * inn),
    reviewLabelFieldGap: osRound(base.reviewLabelFieldGap * inn),
    reviewTitleFontSize: osRound(base.reviewTitleFontSize * typ),
    reviewTitleStyle: base.reviewTitleStyle,
    reviewLabelFontSize: osRound(base.reviewLabelFontSize * typ),
    reviewLabelStyle: base.reviewLabelStyle,
    reviewFieldFontSize: osRound(base.reviewFieldFontSize * typ),
    reviewFieldStyle: base.reviewFieldStyle,
    reviewStatusFontSize: osRound(base.reviewStatusFontSize * typ),
    reviewStatusStyle: base.reviewStatusStyle,
    reviewFieldPaddingX: base.reviewFieldPaddingX,
    reviewFieldPaddingY: base.reviewFieldPaddingY,
    reviewFieldMinHeight: base.reviewFieldMinHeight,
    reviewNotesMinHeight: base.reviewNotesMinHeight,
    reviewFieldCornerRadius: base.reviewFieldCornerRadius,
    reviewCardCornerRadius: base.reviewCardCornerRadius,
    reviewColumnWidth: base.reviewColumnWidth,
    reviewHeaderPaddingY: base.reviewHeaderPaddingY,
    reviewHeaderPaddingX: base.reviewHeaderPaddingX,
    reviewHeaderCornerRadius: base.reviewHeaderCornerRadius,
    reviewHeaderStroke: base.reviewHeaderStroke,
    reviewContentPaddingX: base.reviewContentPaddingX,
    reviewBgColor: base.reviewBgColor,
    reviewStroke: base.reviewStroke,
    reviewFieldBgColor: base.reviewFieldBgColor,
    reviewFieldStroke: base.reviewFieldStroke,
    reviewLabelColor: base.reviewLabelColor,
    reviewPlaceholderColor: base.reviewPlaceholderColor,
    reviewStatusBgColor: base.reviewStatusBgColor,
    reviewStatusTextColor: base.reviewStatusTextColor,
    reviewStatusPaddingX: base.reviewStatusPaddingX,
    reviewStatusPaddingY: base.reviewStatusPaddingY,
    reviewStatusCornerRadius: base.reviewStatusCornerRadius,
    decisionBgColor: base.decisionBgColor,
    // Variant Group panel. Padding/title gap scale with innerSpacing (like card
    // padding); title type uses the group-label scale.
    variantGroupBgColor: base.variantGroupBgColor,
    variantGroupStroke: base.variantGroupStroke,
    variantGroupPadding: osRound(base.variantGroupPadding * inn),
    variantGroupTitleGap: osRound(base.variantGroupTitleGap * inn),
    variantGroupCornerRadius: base.variantGroupCornerRadius,
    variantGroupTitleColor: base.variantGroupTitleColor,
  };
}

function osResolveAnnotations(profile, option, orientation, capabilities) {
  // Default: disabled. Annotations are opt-in everywhere; Review never adds
  // slots unless the user asks for them.
  let enabled = false;
  let mode = profile.behavior.annotationPolicy === "expandedOptional"
    ? "expanded"
    : "compact";
  let position = "belowDescription";

  // Track whether the user explicitly supplied a mode / position so we know
  // when to apply personality- or orientation-level defaults instead.
  const optionIsObject = option && typeof option === "object";
  const userSuppliedMode =
    optionIsObject &&
    (option.mode === "compact" || option.mode === "expanded");
  const userSuppliedPosition =
    optionIsObject &&
    (option.position === "aboveScreen" ||
      option.position === "belowDescription");

  if (option === true) {
    enabled = true;
  } else if (optionIsObject) {
    enabled = option.enabled !== false;
    if (userSuppliedMode) mode = option.mode;
    if (userSuppliedPosition) position = option.position;
  }

  // Per-personality default position when not explicitly set.
  if (enabled && !userSuppliedPosition) {
    if (profile.id === "workshop") position = "aboveScreen";
  }

  // Orientation nudges only fire when the user did NOT supply that field.
  // Explicit user settings always win.
  if (enabled && orientation && orientation.annotationPreference) {
    const pref = orientation.annotationPreference;
    if (!userSuppliedMode && pref.mode) {
      mode = pref.mode;
    }
    if (!userSuppliedPosition && pref.position) {
      position = pref.position;
    }
  }

  // Capability gate: when the board type does not expose annotation tooling,
  // force-disable *rendering* regardless of the param/stored setting. The user's
  // intent is retained in `intendedEnabled` so metadata persists it across a
  // switch and slots reappear when returning to a capable board type. This skips
  // generation only; it never clears stored settings or preserved content.
  const caps = capabilities || osBoardTypeCapabilities(profile.id);
  const intendedEnabled = enabled;
  if (caps.annotations === false) {
    enabled = false;
  }

  return {
    enabled: enabled,
    intendedEnabled: intendedEnabled,
    mode: mode,
    position: position,
    heightCompact: 240,
    heightExpanded: 400,
    skipHero: profile.id === "portfolio",
  };
}

function osResolveOrientation(id) {
  // Default: passthrough. Unknown ids fall back to passthrough so the engine
  // never throws — the MCP/UI boundary validates with an enum. This keeps
  // older callers (no orientation field) and stray inputs safe.
  if (!id) return OS_ORIENTATIONS.passthrough;
  if (OS_ORIENTATIONS[id]) return OS_ORIENTATIONS[id];
  return OS_ORIENTATIONS.passthrough;
}

// ---------------------------------------------------------------------------
// Geometry helpers (shared, personality-agnostic).
// ---------------------------------------------------------------------------

function osMaxFrameWidth(frames) {
  let maxW = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i] && typeof frames[i].width === "number") {
      maxW = Math.max(maxW, frames[i].width);
    }
  }
  return maxW;
}

function osPickColumns(frames, tokens) {
  const n = frames.length;
  let cols = 1;
  if (n <= 2) cols = 1;
  else if (n <= 4) cols = 2;
  else if (n <= 6) cols = 3;
  else cols = Math.min(tokens.maxColumns, Math.ceil(Math.sqrt(n)));
  const maxW = osMaxFrameWidth(frames);
  if (maxW > tokens.mediumScreenWidth && cols > 2) cols = 2;
  return cols;
}

function osPreserveFrameSize(frame) {
  if ("layoutSizingHorizontal" in frame) {
    frame.layoutSizingHorizontal = "FIXED";
  }
  if ("layoutSizingVertical" in frame) {
    frame.layoutSizingVertical = "FIXED";
  }
  if ("layoutGrow" in frame) {
    frame.layoutGrow = 0;
  }
}

function osCleanTitle(name) {
  if (!name) return "Untitled Screen";
  let s = String(name).trim();
  s = s.replace(/^(AT|UC|AC|FL|TC)\s*-?\s*\d+\s*[-:]\s*/i, "");
  s = s.replace(/[-_/]/g, " ").replace(/\s+/g, " ").trim();
  return s || "Untitled Screen";
}

function osPlaceholderDescription(profile) {
  switch (profile && profile.id) {
    case "presentation":
      return "Set the scene for this screen.";
    case "portfolio":
      return "Story note for this screen — design rationale or outcome.";
    case "workshop":
      return "Discussion prompt or observation for this screen.";
    case "documentation":
      return "Spec / behavior note for this screen.";
    default:
      return "Brief context for this screen. Edit to describe the user goal or design decision shown here.";
  }
}

function osDefaultSectionDescription(profile) {
  switch (profile.id) {
    case "presentation":
      return "Stakeholder walkthrough of the selected screens — paced for storytelling.";
    case "portfolio":
      return "Curated case study highlighting these screens and the design rationale behind them.";
    case "workshop":
      return "Workshop board for collaborative exploration. Use clusters for grouped discussion.";
    case "documentation":
      return "Reference overview of the selected screens. Aligned grid for handoff and lookup.";
    default:
      return "Curated walkthrough of the selected screens. Use this board for design reviews and stakeholder presentations.";
  }
}

async function osLoadFonts(tokens) {
  const f = tokens.fontFamily;
  await figma.loadFontAsync({ family: f, style: tokens.titleStyle });
  await figma.loadFontAsync({ family: f, style: tokens.headerDescStyle });
  await figma.loadFontAsync({ family: f, style: tokens.cardTitleStyle });
  await figma.loadFontAsync({ family: f, style: tokens.cardDescStyle });
  await figma.loadFontAsync({ family: f, style: tokens.groupLabelStyle });
  await figma.loadFontAsync({ family: f, style: tokens.annotationStyle });
}

async function osCreateText(text, size, style, color) {
  const t = figma.createText();
  t.fontName = { family: OS_BASE_TOKENS.fontFamily, style: style };
  t.fontSize = size;
  t.characters = text;
  t.fills = [{ type: "SOLID", color: color }];
  return t;
}

// Set a text node to wrap and fill the width of its auto-layout parent.
// Must be called AFTER appendChild so layoutSizingHorizontal can resolve
// against the parent. `osApplyCardWidthPolicy` may resize cards later
// to `rowMax` / `sectionMax`; FILL text re-flows automatically on the
// next layout pass, so this helper does not need to know the policy.
function osMakeTextFill(node) {
  try { node.textAutoResize = "HEIGHT"; } catch (e) {}
  if ("layoutSizingHorizontal" in node) {
    try { node.layoutSizingHorizontal = "FILL"; } catch (e) {}
  }
}

// Set a text node to hug its content on a single line (grows horizontally with
// the text). Use for short inline labels such as the Functional Header
// confidence note: a FILL + HEIGHT-autoresize node that starts empty resolves
// to ~0 width, so when text is written later it wraps one character per line
// (and balloons the header height). WIDTH auto-resize keeps it a single line.
function osMakeTextHug(node) {
  try { node.textAutoResize = "WIDTH"; } catch (e) {}
  if ("layoutSizingHorizontal" in node) {
    try { node.layoutSizingHorizontal = "HUG"; } catch (e) {}
  }
}

// Section Description wraps at a fixed max width instead of filling the full
// Overview Header. HEIGHT auto-resize reflows when copy changes.
function osApplySectionDescriptionWidth(node, maxWidth) {
  if (!node || node.type !== "TEXT") return;
  const w =
    typeof maxWidth === "number" && maxWidth > 0 ? maxWidth : 1620;
  try { node.textAutoResize = "HEIGHT"; } catch (e) {}
  if ("layoutSizingHorizontal" in node) {
    try { node.layoutSizingHorizontal = "FIXED"; } catch (e) {}
  }
  try {
    const h = typeof node.height === "number" && node.height > 0 ? node.height : 1;
    node.resize(w, h);
  } catch (e) {}
}

function osGetBounds(nodes) {
  if (!nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (typeof n.x !== "number") continue;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  if (!isFinite(minX)) return null;
  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

function osGetPageForNode(node) {
  let p = node.parent;
  while (p) {
    if (p.type === "PAGE") return p;
    p = p.parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flow arrows ("Show as flow"). Connectors are FigJam-only, so in Figma
// design files a one-directional arrow is a VECTOR node whose destination
// vertex carries an ARROW_LINES stroke cap. All helpers are personality-
// agnostic and ES2019-safe.
// ---------------------------------------------------------------------------

function osAbsBox(node) {
  const bb = node && node.absoluteBoundingBox;
  if (bb) {
    return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  }
  return {
    x: node.x || 0,
    y: node.y || 0,
    width: node.width || 0,
    height: node.height || 0,
  };
}

// Absolute origin of a container used as the arrow parent. Pages have no
// absoluteBoundingBox, so their local space already equals absolute space.
function osAbsOrigin(node) {
  const bb = node && node.absoluteBoundingBox;
  if (bb) return { x: bb.x, y: bb.y };
  return { x: 0, y: 0 };
}

// Scale the ray (dx,dy) from a box center until it reaches the box border.
function osBoxEdgePoint(cx, cy, hw, hh, dx, dy) {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < 1e-6 && ady < 1e-6) return { x: cx, y: cy };
  const tx = adx < 1e-6 ? Infinity : hw / adx;
  const ty = ady < 1e-6 ? Infinity : hh / ady;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

// Compute arrow endpoints between two boxes. When `targetLength` is given, the
// arrow is a fixed-length segment centered on the midpoint between the two box
// centers (clamped so it never exceeds the center-to-center distance) — this
// keeps arrows boldly visible regardless of how close the screens sit. Without
// a target length it falls back to edge-to-edge with a gap.
function osArrowAnchors(boxA, boxB, gap, targetLength) {
  const cax = boxA.x + boxA.width / 2;
  const cay = boxA.y + boxA.height / 2;
  const cbx = boxB.x + boxB.width / 2;
  const cby = boxB.y + boxB.height / 2;
  const dx = cbx - cax;
  const dy = cby - cay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) {
    return { x1: cax, y1: cay, x2: cbx, y2: cby };
  }
  const ux = dx / len;
  const uy = dy / len;

  if (typeof targetLength === "number" && targetLength > 0) {
    const mx = (cax + cbx) / 2;
    const my = (cay + cby) / 2;
    const half = Math.min(targetLength, len) / 2;
    return {
      x1: mx - ux * half,
      y1: my - uy * half,
      x2: mx + ux * half,
      y2: my + uy * half,
    };
  }

  const exit = osBoxEdgePoint(cax, cay, boxA.width / 2, boxA.height / 2, dx, dy);
  const entry = osBoxEdgePoint(
    cbx,
    cby,
    boxB.width / 2,
    boxB.height / 2,
    -dx,
    -dy
  );
  return {
    x1: exit.x + ux * gap,
    y1: exit.y + uy * gap,
    x2: entry.x - ux * gap,
    y2: entry.y - uy * gap,
  };
}

async function osCreateFlowArrow(parent, x1, y1, x2, y2, tokens) {
  const v = figma.createVector();
  parent.appendChild(v);
  v.name = "Flow Arrow";
  v.x = 0;
  v.y = 0;
  await v.setVectorNetworkAsync({
    vertices: [
      { x: x1, y: y1, strokeCap: "NONE" },
      { x: x2, y: y2, strokeCap: "ARROW_LINES" },
    ],
    segments: [{ start: 0, end: 1 }],
  });
  v.strokes = [{ type: "SOLID", color: tokens.flowStrokeColor }];
  v.strokeWeight = tokens.flowStrokeWeight;
  return v;
}

// Centered, editable pill describing the step (e.g. "User clicks 'Continue'").
// Positioned at the arrow midpoint in `parent`-local space. The pill hugs its
// text; `layoutPositioning = "ABSOLUTE"` keeps it free of any auto-layout
// parent (the compose overlay). Requires the label font to be loaded.
async function osCreateFlowLabel(parent, midX, midY, text, tokens) {
  const pill = figma.createFrame();
  parent.appendChild(pill);
  pill.name = "Flow Label";
  pill.layoutMode = "HORIZONTAL";
  pill.primaryAxisSizingMode = "AUTO";
  pill.counterAxisSizingMode = "AUTO";
  pill.primaryAxisAlignItems = "CENTER";
  pill.counterAxisAlignItems = "CENTER";
  pill.paddingLeft = tokens.flowLabelPaddingX;
  pill.paddingRight = tokens.flowLabelPaddingX;
  pill.paddingTop = tokens.flowLabelPaddingY;
  pill.paddingBottom = tokens.flowLabelPaddingY;
  pill.cornerRadius = tokens.flowLabelCornerRadius;
  pill.fills = [{ type: "SOLID", color: tokens.flowLabelBgColor }];
  pill.strokes = [{ type: "SOLID", color: tokens.flowLabelStroke }];
  pill.strokeWeight = 2;

  const t = await osCreateText(
    typeof text === "string" ? text : tokens.flowLabelPlaceholder,
    tokens.flowLabelFontSize,
    tokens.flowLabelStyle,
    tokens.flowLabelTextColor
  );
  t.name = "Flow Label Text";
  try {
    t.textAlignHorizontal = "CENTER";
  } catch (e) {}
  pill.appendChild(t);

  if ("layoutPositioning" in pill) {
    try {
      pill.layoutPositioning = "ABSOLUTE";
    } catch (e) {}
  }
  // pill.width/height have resolved against the hugged text by now.
  // Horizontally centered on the arrow midpoint; sits just BELOW the line.
  pill.x = Math.round(midX - pill.width / 2);
  pill.y = Math.round(midY + tokens.flowLabelGap);
  return pill;
}

// When flow is active on a composed board, the inter-card gaps must be wide
// enough that a centered, fixed-length arrow fits between two screens without
// overlapping either. Returns a shallow token clone with `gridGapX` /
// `stripGapY` raised to at least `flowArrowLength + 2 * flowAnchorGap`. Plan
// structure (columns/rows) is unchanged — only the spacing grows.
function osFlowSpacingTokens(tokens) {
  const required = tokens.flowArrowLength + 2 * tokens.flowAnchorGap;
  const clone = {};
  for (const k in tokens) {
    if (Object.prototype.hasOwnProperty.call(tokens, k)) {
      clone[k] = tokens[k];
    }
  }
  clone.gridGapX = Math.max(tokens.gridGapX, required);
  clone.stripGapY = Math.max(tokens.stripGapY, required);
  return clone;
}

// Collect existing flow-label text (in arrow order) from a board's Flow
// Overlay so a recompose can replay user-edited labels by index instead of
// resetting them to the placeholder.
function osCollectFlowLabels(container) {
  const labels = [];
  if (!container || !("children" in container)) return labels;
  let overlay = null;
  for (let i = 0; i < container.children.length; i++) {
    const c = container.children[i];
    if (c && c.name === "Flow Overlay") {
      overlay = c;
      break;
    }
  }
  if (!overlay || !("children" in overlay)) return labels;
  for (let j = 0; j < overlay.children.length; j++) {
    const node = overlay.children[j];
    if (node && node.name === "Flow Label" && "children" in node) {
      let text = "";
      for (let k = 0; k < node.children.length; k++) {
        const tn = node.children[k];
        if (tn && tn.type === "TEXT") {
          text = typeof tn.characters === "string" ? tn.characters : "";
          break;
        }
      }
      labels.push(text);
    }
  }
  return labels;
}

// Remove any prior flow group this skill drew inside `parent` so re-running
// replaces rather than stacking. Tagged via sharedPluginData.
function osRemoveExistingFlow(parent) {
  if (!parent || !("children" in parent)) return;
  const kids = parent.children.slice();
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    try {
      if (
        typeof c.getSharedPluginData === "function" &&
        c.getSharedPluginData(OS_METADATA_NAMESPACE, "osFlow") === "1"
      ) {
        c.remove();
      }
    } catch (e) {}
  }
}

// Draw a chain of arrows through `orderedFrames`, parented under `arrowParent`
// (positioned in that parent's local space) and grouped into a tagged "Flow"
// group. Returns the number of arrows drawn.
async function osConnectFramesFlow(orderedFrames, arrowParent, tokens) {
  osRemoveExistingFlow(arrowParent);
  const origin = osAbsOrigin(arrowParent);
  // Collect arrows + labels together so the whole flow is grouped and tagged
  // as one removable unit.
  const nodes = [];
  let arrowCount = 0;
  for (let i = 0; i < orderedFrames.length - 1; i++) {
    const a = orderedFrames[i];
    const b = orderedFrames[i + 1];
    if (!a || a.removed || !b || b.removed) continue;
    const ba = osAbsBox(a);
    const bb = osAbsBox(b);
    const la = {
      x: ba.x - origin.x,
      y: ba.y - origin.y,
      width: ba.width,
      height: ba.height,
    };
    const lb = {
      x: bb.x - origin.x,
      y: bb.y - origin.y,
      width: bb.width,
      height: bb.height,
    };
    const an = osArrowAnchors(la, lb, tokens.flowAnchorGap, tokens.flowArrowLength);
    if (arrowParent.removed) break;
    const v = await osCreateFlowArrow(
      arrowParent,
      an.x1,
      an.y1,
      an.x2,
      an.y2,
      tokens
    );
    nodes.push(v);
    const label = await osCreateFlowLabel(
      arrowParent,
      (an.x1 + an.x2) / 2,
      (an.y1 + an.y2) / 2,
      tokens.flowLabelPlaceholder,
      tokens
    );
    nodes.push(label);
    arrowCount++;
    if (arrowCount % 8 === 0) {
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
    }
  }
  if (nodes.length && arrowParent && !arrowParent.removed) {
    try {
      const g = figma.group(nodes, arrowParent);
      g.name = "Flow";
      try {
        g.setSharedPluginData(OS_METADATA_NAMESPACE, "osFlow", "1");
      } catch (e) {}
    } catch (e) {}
  }
  return arrowCount;
}

// In-place flow: connect selected FRAMEs (>=2), else the child FRAMEs of each
// selected SECTION. Returns { arrowCount, connectedNodeIds, scope }.
async function osDrawFlowInPlace(targetFrames, targetSections, tokens) {
  // Flow labels are text; the in-place path does not otherwise load fonts.
  await figma.loadFontAsync({
    family: tokens.fontFamily,
    style: tokens.flowLabelStyle,
  });

  if (targetFrames && targetFrames.length >= 2) {
    const parent = targetFrames[0].parent;
    const parentId = parent ? parent.id : null;
    let shared = !!parent;
    for (let i = 1; i < targetFrames.length; i++) {
      const p = targetFrames[i].parent;
      if (!p || p.id !== parentId) {
        shared = false;
        break;
      }
    }
    const arrowParent =
      shared && parent
        ? parent
        : osGetPageForNode(targetFrames[0]) || figma.currentPage;
    const count = await osConnectFramesFlow(targetFrames, arrowParent, tokens);
    return {
      arrowCount: count,
      connectedNodeIds: targetFrames.map(function (f) {
        return f.id;
      }),
      scope: "frames",
    };
  }

  if (targetSections && targetSections.length >= 1) {
    let total = 0;
    const connected = [];
    let any = false;
    for (let s = 0; s < targetSections.length; s++) {
      const section = targetSections[s];
      if (!section || section.removed || !("children" in section)) continue;
      const childFrames = section.children.filter(function (c) {
        return c.type === "FRAME";
      });
      if (childFrames.length < 2) continue;
      any = true;
      total += await osConnectFramesFlow(childFrames, section, tokens);
      for (let k = 0; k < childFrames.length; k++) {
        connected.push(childFrames[k].id);
      }
    }
    if (!any) {
      throw new Error(
        "Select 2+ screens, or a section containing 2+ screens, to draw a flow."
      );
    }
    return { arrowCount: total, connectedNodeIds: connected, scope: "sections" };
  }

  throw new Error(
    "Select 2+ screens, or a section containing 2+ screens, to draw a flow."
  );
}

function osSortNodesLeftToRight(nodes) {
  return nodes.slice().sort(function (a, b) {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
}

function osSortFramesLeftToRight(frames) {
  return osSortNodesLeftToRight(frames);
}

function osIsPresentationSection(section) {
  if (!section || section.type !== "SECTION" || !("children" in section)) {
    return false;
  }
  return section.children.some(function (c) {
    return c.type === "FRAME" && c.name === "Section Container";
  });
}

function osPickSectionGridColumns(count, profile, tokens) {
  const fakeFrames = [];
  for (let i = 0; i < count; i++) {
    fakeFrames.push({ width: tokens.wideScreenWidth + 1 });
  }
  // Reuse the compact-grid heuristic with personality bounds.
  return osPickColumns(fakeFrames, {
    maxColumns: profile.sectionGrid.maxColumns,
    mediumScreenWidth: tokens.mediumScreenWidth,
  });
}

/**
 * Resize every section to the height of the tallest section in the
 * group so a multi-section arrange reads as one aligned band.
 * Never shrinks below current height (max only). Locked or
 * non-resizable nodes are skipped silently and counted for the
 * result envelope. Sections without a numeric height (defensive
 * branch — every SECTION has one in practice) are ignored.
 *
 * Returns `{ targetHeight, skippedCount }` so the caller can surface
 * the unified height and the skipped count in its result envelope.
 */
function osEqualizeSectionHeights(sections) {
  let targetH = 0;
  for (let i = 0; i < sections.length; i++) {
    if (typeof sections[i].height === "number") {
      targetH = Math.max(targetH, sections[i].height);
    }
  }
  let skipped = 0;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (typeof s.height !== "number" || s.height === targetH) continue;
    try {
      if (typeof s.resizeWithoutConstraints === "function") {
        s.resizeWithoutConstraints(s.width, targetH);
      } else if (typeof s.resize === "function") {
        s.resize(s.width, targetH);
      } else {
        skipped++;
      }
    } catch (e) {
      skipped++;
    }
  }
  return { targetHeight: targetH, skippedCount: skipped };
}

/**
 * Resolve the column count for a multi-section arrange. When an explicit
 * orientation is supplied it overrides the personality heuristic, mirroring
 * how `osCreateCompositionPlan` maps orientation for the compose path:
 *   row    → one row    (cols = n)
 *   column → one column (cols = 1)
 *   grid   → square grid (osPickSquareGridColumns)
 *   passthrough/default → personality-driven osPickSectionGridColumns
 */
function osPickSectionColumns(count, profile, tokens, orientation) {
  const ori = orientation || OS_ORIENTATIONS.passthrough;
  if (count <= 1) return Math.max(1, count);
  if (ori.strategyMap === "singleRow") return count;
  if (ori.strategyMap === "singleColumn") return 1;
  if (ori.strategyMap === "balancedGrid") return osPickSquareGridColumns(count);
  return osPickSectionGridColumns(count, profile, tokens);
}

/**
 * Lay out multiple presentation-board Sections in a grid with fixed gaps.
 * Does not resize sections — only repositions them. The caller is
 * responsible for height equalisation (`osEqualizeSectionHeights`)
 * if a uniform band is desired. An explicit orientation (row / column /
 * grid) overrides the personality column heuristic.
 */
function osArrangeSectionsInGrid(sections, gap, profile, tokens, orientation) {
  sections = osSortNodesLeftToRight(sections);
  const cols = osPickSectionColumns(
    sections.length,
    profile,
    tokens,
    orientation
  );
  const bounds = osGetBounds(sections);
  const startX = bounds ? bounds.minX : 0;
  const startY = bounds ? bounds.minY : 0;
  const ori = orientation || OS_ORIENTATIONS.passthrough;

  // Explicit grid: snap every cell to a shared column X so columns line up
  // across rows even when sections differ in width. Each column's X is
  // driven by the widest section in that column. Row Y is already uniform
  // because heights are equalised before arrange, so the result reads as a
  // true aligned grid.
  if (ori.strategyMap === "balancedGrid" && cols > 0) {
    const columnWidths = [];
    for (let c = 0; c < cols; c++) columnWidths[c] = 0;
    for (let i = 0; i < sections.length; i++) {
      const c = i % cols;
      if (sections[i].width > columnWidths[c]) {
        columnWidths[c] = sections[i].width;
      }
    }
    const columnX = [];
    let x = startX;
    for (let c = 0; c < cols; c++) {
      columnX[c] = x;
      x += columnWidths[c] + gap;
    }

    let gridRowY = startY;
    let gridRowMaxHeight = 0;
    for (let i = 0; i < sections.length; i++) {
      const c = i % cols;
      sections[i].x = columnX[c];
      sections[i].y = gridRowY;
      gridRowMaxHeight = Math.max(gridRowMaxHeight, sections[i].height);
      if (c === cols - 1 || i === sections.length - 1) {
        gridRowY += gridRowMaxHeight + gap;
        gridRowMaxHeight = 0;
      }
    }
    return cols;
  }

  // Default / row / column: left-packed rows (each row starts at startX and
  // packs sections by their own widths).
  let rowY = startY;
  let rowMaxHeight = 0;
  let colIndex = 0;
  let cursorX = startX;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (colIndex === 0) {
      cursorX = startX;
    }
    section.x = cursorX;
    section.y = rowY;
    cursorX += section.width + gap;
    rowMaxHeight = Math.max(rowMaxHeight, section.height);
    colIndex++;
    if (colIndex >= cols) {
      colIndex = 0;
      rowY += rowMaxHeight + gap;
      rowMaxHeight = 0;
    }
  }
  return cols;
}

// ---------------------------------------------------------------------------
// Composition planner.
// ---------------------------------------------------------------------------

function osRangeIndices(start, end) {
  const out = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}

function osChunk(arr, size) {
  if (size < 1) size = 1;
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Square grid column picker for explicit "grid" orientation.
// Chooses column count so row count is as close as possible to column count
// (minimize |cols - ceil(n/cols)|). No maxPerStrip / personality maxColumns
// cap — a 100-screen selection becomes a 10×10 grid when possible.
function osPickSquareGridColumns(n) {
  if (n <= 1) return n;
  let best = 1;
  let bestDiff = Infinity;
  for (let c = 1; c <= n; c++) {
    const rowCount = Math.ceil(n / c);
    const diff = Math.abs(c - rowCount);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Variant detection (multi-proposal A/B/C).
// ---------------------------------------------------------------------------

// Ordered regex registry for naming-convention variant detection.
// First match wins; capture 1 = base, capture 2 = variant label.
const OS_VARIANT_NAME_PATTERNS = [
  /^(.+?)\s+([A-Za-z])$/, // "Home A"
  /^(.+?)\s+v(\d+)$/i, // "Home v2"
  /^(.+?)\s*[-\u2014]\s*(\d+)$/, // "Receive a fine - 16"
  /^(.+?)\s*\((alt(?:\s*\d+)?)\)$/i, // "Home (alt 2)"
];

function osNormaliseVariantBase(base) {
  return String(base || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function osParseVariantName(name) {
  const raw = String(name || "").trim();
  for (let i = 0; i < OS_VARIANT_NAME_PATTERNS.length; i++) {
    const m = raw.match(OS_VARIANT_NAME_PATTERNS[i]);
    if (m && m[1] && m[2]) {
      return { base: m[1].trim(), label: m[2].trim() };
    }
  }
  return null;
}

function osVariantLabelSort(a, b) {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  const aNum = !isNaN(na) && String(na) === String(a).trim();
  const bNum = !isNaN(nb) && String(nb) === String(b).trim();
  if (aNum && bNum) return na - nb;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Detect variant groups in a FRAME selection. Pure — performs no writes.
 * Pass 1: designer-marked parent ("Variants: X" / "Compare: X").
 * Pass 2: naming convention (only a base shared by 2+ frames groups).
 * A frame marked in pass 1 is blocked from pass 2. Marked-parent groups
 * with a single selected frame do not survive and fall back to singletons.
 * Returns { singletons: FrameNode[], variantGroups: VariantGroup[] }.
 */
function osDetectVariantGroups(frames) {
  const groupsByKey = {};
  const order = [];
  const markedFrameIds = {};

  // Pass 1: marked parent.
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const parent = frame && frame.parent ? frame.parent : null;
    if (!parent || (parent.type !== "FRAME" && parent.type !== "SECTION")) {
      continue;
    }
    const pm = String(parent.name || "").match(
      /^(?:Variants|Compare)\s*:\s*(.+)$/i
    );
    if (!pm || !pm[1]) continue;
    const pkey = "parent:" + parent.id;
    if (!groupsByKey[pkey]) {
      groupsByKey[pkey] = {
        key: pkey,
        label: pm[1].trim(),
        frames: [],
        variantLabels: [],
        source: "marked-parent",
        confidence: "high",
      };
      order.push(pkey);
    }
    groupsByKey[pkey].frames.push(frame);
    groupsByKey[pkey].variantLabels.push(osCleanTitle(frame.name));
    markedFrameIds[frame.id] = true;
  }

  // Pass 2: naming convention (skip frames already marked).
  const nameBuckets = {};
  const nameOrder = [];
  for (let j = 0; j < frames.length; j++) {
    const f2 = frames[j];
    if (markedFrameIds[f2.id]) continue;
    const parsed = osParseVariantName(f2.name);
    if (!parsed) continue;
    const nkey = "name:" + osNormaliseVariantBase(parsed.base);
    if (!nameBuckets[nkey]) {
      nameBuckets[nkey] = { base: parsed.base, items: [] };
      nameOrder.push(nkey);
    }
    nameBuckets[nkey].items.push({ frame: f2, label: parsed.label });
  }
  for (let k = 0; k < nameOrder.length; k++) {
    const bucket = nameBuckets[nameOrder[k]];
    if (bucket.items.length < 2) continue;
    bucket.items.sort(function (a, b) {
      return osVariantLabelSort(a.label, b.label);
    });
    const grp = {
      key: nameOrder[k],
      label: bucket.base,
      frames: [],
      variantLabels: [],
      source: "naming",
      confidence: "medium",
    };
    for (let x = 0; x < bucket.items.length; x++) {
      grp.frames.push(bucket.items[x].frame);
      grp.variantLabels.push(bucket.items[x].label);
    }
    groupsByKey[grp.key] = grp;
    order.push(grp.key);
  }

  // Keep only groups with 2+ frames, in first-seen order.
  const variantGroups = [];
  const groupedIds = {};
  for (let o = 0; o < order.length; o++) {
    const g = groupsByKey[order[o]];
    if (g && g.frames.length >= 2) {
      variantGroups.push(g);
      for (let p = 0; p < g.frames.length; p++) {
        groupedIds[g.frames[p].id] = true;
      }
    }
  }

  // Singletons = every frame not in a surviving group (input order).
  const singletons = [];
  for (let s = 0; s < frames.length; s++) {
    if (!groupedIds[frames[s].id]) singletons.push(frames[s]);
  }
  return { singletons: singletons, variantGroups: variantGroups };
}

/**
 * Apply the UI/MCP acceptance decision to detected groups.
 *   keys === undefined / null -> accept all detected groups
 *   keys === []               -> accept none (every screen separate)
 *   keys === [..]             -> accept exactly the listed keys
 * Frames from rejected groups fall back into the singleton list (re-sorted
 * left-to-right so they slot back into reading order).
 * Returns { variantGroups: VariantGroup[], singletonFrames: FrameNode[] }.
 */
function osResolveAcceptedGroups(detected, keys) {
  let accept = null;
  if (Array.isArray(keys)) {
    accept = {};
    for (let i = 0; i < keys.length; i++) accept[String(keys[i])] = true;
  }
  const acceptedGroups = [];
  const rejectedFrames = [];
  for (let g = 0; g < detected.variantGroups.length; g++) {
    const grp = detected.variantGroups[g];
    const ok = accept === null ? true : accept[grp.key] === true;
    if (ok) {
      acceptedGroups.push(grp);
    } else {
      for (let f = 0; f < grp.frames.length; f++) {
        rejectedFrames.push(grp.frames[f]);
      }
    }
  }
  let singletonFrames = detected.singletons.slice();
  for (let r = 0; r < rejectedFrames.length; r++) {
    singletonFrames.push(rejectedFrames[r]);
  }
  singletonFrames = osSortFramesLeftToRight(singletonFrames);
  return { variantGroups: acceptedGroups, singletonFrames: singletonFrames };
}

function osCreateCompositionPlan(frames, profile, tokens, orientation) {
  const n = frames.length;
  if (n === 0) {
    // No singletons (e.g. an all-variant selection). Return a trivial plan
    // so width/column math never runs on an empty set.
    return {
      boardType: profile.id,
      orientation: (orientation || OS_ORIENTATIONS.passthrough).id,
      operation: "compose",
      strategy: "compactGrid",
      columns: 0,
      maxPerStrip: profile.behavior.maxPerStrip,
      rows: [],
      groups: [],
      emphasis: {},
      cardWidthPolicy: profile.behavior.cardWidthPolicy,
      annotationPolicy: profile.behavior.annotationPolicy,
      isWide: false,
      maxFrameWidth: 0,
      screenCount: 0,
    };
  }
  const maxW = osMaxFrameWidth(frames);
  const isWide = maxW > tokens.wideScreenWidth;
  const ori = orientation || OS_ORIENTATIONS.passthrough;

  let strategy;
  let columns = 1;
  let rows = [];
  const emphasis = {};

  if (ori.strategyMap === "singleColumn") {
    // Column orientation: one vertical stack — all cards direct children of
    // Screens Grid (no per-screen Row frames, no segment grouping).
    strategy = "singleColumn";
    columns = 1;
    rows = [osRangeIndices(0, n)];
  } else if (ori.strategyMap === "singleRow") {
    // Row orientation: one horizontal strip — all cards in a single row, no
    // maxPerStrip wrap regardless of screen count or width.
    strategy = "singleRow";
    columns = n;
    rows = [osRangeIndices(0, n)];
  } else if (ori.strategyMap === "balancedGrid") {
    // Grid orientation: square-ish grid; column count from osPickSquareGridColumns.
    strategy = "balancedGrid";
    columns = osPickSquareGridColumns(n);
    rows = osChunk(osRangeIndices(0, n), columns);
  } else {
    // Passthrough: original personality-driven strategy selection.
    const pref = profile.behavior.preferredStrategy;
    if (pref === "grid") {
      strategy = "compactGrid";
    } else if (pref === "strip") {
      strategy = isWide ? "horizontalStrip" : "compactGrid";
    } else if (pref === "heroSupporting" && n >= 4 && isWide) {
      strategy = "heroSupporting";
    } else {
      strategy = isWide ? "horizontalStrip" : "compactGrid";
    }

    // Portfolio: upgrade strip → heroSupporting when there are enough wide screens.
    if (
      profile.behavior.emphasis === "firstHero" &&
      n >= 4 &&
      isWide &&
      strategy === "horizontalStrip"
    ) {
      strategy = "heroSupporting";
    }

    // Workshop: prefer wall-grid over long strips for several screens.
    if (
      profile.id === "workshop" &&
      n >= 4 &&
      strategy === "horizontalStrip"
    ) {
      strategy = "compactGrid";
    }

    if (strategy === "horizontalStrip") {
      const perStrip = profile.behavior.maxPerStrip;
      columns = Math.min(n, perStrip);
      rows = osChunk(osRangeIndices(0, n), perStrip);
    } else if (strategy === "heroSupporting") {
      emphasis.heroIndex = 0;
      rows.push([0]);
      const perRow = Math.max(1, profile.behavior.maxPerStrip);
      const supporting = osChunk(osRangeIndices(1, n), perRow);
      for (let i = 0; i < supporting.length; i++) rows.push(supporting[i]);
      columns = Math.max(1, perRow);
    } else {
      columns = osPickColumns(frames, tokens);
      rows = osChunk(osRangeIndices(0, n), columns);
    }
  }

  // Grouping. Orientation grouping wins over the personality "chunks" grouping
  // because orientation is the explicit user choice when present.
  const groups = [];
  const groupingPolicy = ori.groupingPolicy || "passthrough";

  if (groupingPolicy === "narrativeSegments" && n >= 6 && ori.cardsPerSegment > 0) {
    // Column narrative segments: bundle single-card rows into "Segment N"
    // clusters of cardsPerSegment rows each.
    const rowsPerSegment = ori.cardsPerSegment;
    let idx = 0;
    while (idx < rows.length) {
      const segRows = rows.slice(idx, idx + rowsPerSegment);
      const indices = [];
      for (let rr = 0; rr < segRows.length; rr++) {
        for (let ii = 0; ii < segRows[rr].length; ii++) {
          indices.push(segRows[rr][ii]);
        }
      }
      groups.push({
        label: "Segment " + (groups.length + 1),
        rows: segRows,
        frameIndices: indices,
      });
      idx += rowsPerSegment;
    }
  } else if (
    (groupingPolicy === "passthrough" || groupingPolicy === undefined) &&
    profile.behavior.grouping === "chunks" &&
    n >= 6
  ) {
    // Workshop "chunks" only fires in passthrough — when an explicit
    // orientation overrides, its groupingPolicy is the source of truth.
    const rowsPerCluster = 2;
    let idx = 0;
    while (idx < rows.length) {
      const clusterRows = rows.slice(idx, idx + rowsPerCluster);
      const indices = [];
      for (let rr = 0; rr < clusterRows.length; rr++) {
        for (let ii = 0; ii < clusterRows[rr].length; ii++) {
          indices.push(clusterRows[rr][ii]);
        }
      }
      groups.push({
        label: "Cluster " + (groups.length + 1),
        rows: clusterRows,
        frameIndices: indices,
      });
      idx += rowsPerCluster;
    }
  }

  return {
    boardType: profile.id,
    orientation: ori.id,
    operation: "compose",
    strategy: strategy,
    columns: columns,
    maxPerStrip: profile.behavior.maxPerStrip,
    rows: rows,
    groups: groups,
    emphasis: emphasis,
    cardWidthPolicy: profile.behavior.cardWidthPolicy,
    annotationPolicy: profile.behavior.annotationPolicy,
    isWide: isWide,
    maxFrameWidth: maxW,
    screenCount: n,
  };
}

function osRowName(plan, rowIndex) {
  if (plan.strategy === "heroSupporting") {
    return rowIndex === 0 ? "Hero" : "Supporting " + rowIndex;
  }
  if (plan.strategy === "horizontalStrip") return "Strip " + (rowIndex + 1);
  if (plan.strategy === "singleRow") return "Row";
  if (plan.strategy === "singleColumn") return "Column";
  if (plan.strategy === "verticalFlow") return "Step " + (rowIndex + 1);
  if (plan.strategy === "balancedGrid") return "Row " + (rowIndex + 1);
  return "Row " + (rowIndex + 1);
}

// ---------------------------------------------------------------------------
// Builders.
// ---------------------------------------------------------------------------

// Resolve the per-frame annotation config + preserved note. A preserved entry
// (frameId -> { text, position, mode }) overrides the board-level position/mode
// so a replay restores *where* the note sat, not only its words.
function osEffectiveAnnotation(ctx, frame) {
  const base = ctx.annotations;
  const pre =
    ctx.annotationOverrides && frame && frame.id
      ? ctx.annotationOverrides[frame.id]
      : null;
  if (!pre || typeof pre !== "object") {
    return { config: base, preserved: null };
  }
  const config = {
    enabled: base.enabled,
    mode: pre.mode === "compact" || pre.mode === "expanded" ? pre.mode : base.mode,
    position:
      pre.position === "aboveScreen" || pre.position === "belowDescription"
        ? pre.position
        : base.position,
    heightCompact: base.heightCompact,
    heightExpanded: base.heightExpanded,
    skipHero: base.skipHero,
  };
  return { config: config, preserved: pre };
}

async function osAppendAnnotationSlot(card, frame, tokens, ann, preserved) {
  // Dedupe guard: never append a second slot for a frame that already has one
  // (e.g. a patch on a Design Review-origin board with a nested slot).
  const existing = osCardAnnotationSlot(card);
  if (existing && !existing.removed) return existing;

  const slot = figma.createFrame();
  slot.name = "Annotation Slot";
  card.appendChild(slot);
  // Plain frame (no nested auto-layout) keeps the slot a stable, fixed-size
  // affordance regardless of card layout direction.
  slot.fills = [{ type: "SOLID", color: tokens.annotationBgColor }];
  slot.strokes = [{ type: "SOLID", color: tokens.annotationStroke }];
  slot.strokeWeight = 1;
  slot.cornerRadius = 8;
  const h = ann.mode === "expanded" ? ann.heightExpanded : ann.heightCompact;
  const w = (frame && typeof frame.width === "number") ? frame.width : 800;
  try { slot.resize(w, h); } catch (e) {}
  osPreserveFrameSize(slot);

  // Preserved text (incl. an intentionally empty edit) wins over the
  // mode-specific placeholder so a board-type round trip restores the note.
  const preservedText =
    preserved && typeof preserved.text === "string" ? preserved.text : null;
  const hint = await osCreateText(
    preservedText !== null
      ? preservedText
      : ann.mode === "expanded"
        ? "Workshop notes — observations, questions, parking lot."
        : "Add notes, comments, or callouts here.",
    tokens.annotationFontSize,
    tokens.annotationStyle,
    tokens.mutedTextColor
  );
  hint.name = "Annotation Hint";
  // Tag the hint with its source frame id so extraction can find the note
  // deterministically even after a reviewer renames or moves layers.
  if (frame && frame.id) {
    try {
      hint.setSharedPluginData(
        OS_REVIEW_NAMESPACE,
        OS_ANNOTATION_FIELD_KEY,
        frame.id
      );
    } catch (e) {}
  }
  slot.appendChild(hint);
  // Slot is a plain (non-auto-layout) frame, so we cannot use FILL
  // sizing. Set HEIGHT-only auto-resize and constrain the text width
  // to the slot's content box so long copy wraps in place.
  try { hint.textAutoResize = "HEIGHT"; } catch (e) {}
  try {
    hint.resize(Math.max(1, slot.width - 48), hint.height);
  } catch (e) {}
  hint.x = 24;
  hint.y = 24;
  return slot;
}

// ---------------------------------------------------------------------------
// Review Card (Design Review board type).
//
// A structured, editable feedback surface appended below each Screen Card.
// Every field is a native text node tagged via sharedPluginData so the plugin
// (and future extraction tooling) can locate it deterministically. Empty
// fields render their muted placeholder; a reviewer just clicks and types.
// ---------------------------------------------------------------------------

// Resolve what a review field should display. A preserved value that differs
// from the placeholder is shown as real (dark) text; anything else falls back
// to the muted placeholder so the field reads as an empty prompt.
function osResolveReviewFieldText(override, fieldKey, placeholder) {
  const stored =
    override && typeof override[fieldKey] === "string"
      ? override[fieldKey]
      : null;
  const hasReal =
    stored !== null && stored.length > 0 && stored !== placeholder;
  return { text: hasReal ? stored : placeholder, isPlaceholder: !hasReal };
}

async function osCreateReviewFieldNode(value, fontSize, style, color, fieldKey) {
  const t = await osCreateText(value, fontSize, style, color);
  try {
    t.setSharedPluginData(OS_REVIEW_NAMESPACE, OS_REVIEW_FIELD_KEY, fieldKey);
  } catch (e) {}
  return t;
}

// One labelled, boxed feedback section (label + an input-like field box).
async function osBuildReviewSection(
  parent,
  labelText,
  fieldKey,
  override,
  placeholder,
  tokens,
  minHeight
) {
  const section = figma.createFrame();
  section.name = "Review Section / " + fieldKey;
  parent.appendChild(section);
  section.layoutMode = "VERTICAL";
  section.primaryAxisSizingMode = "AUTO";
  section.counterAxisSizingMode = "AUTO";
  section.itemSpacing = tokens.reviewLabelFieldGap;
  section.fills = [];
  try { section.layoutSizingHorizontal = "FILL"; } catch (e) {}

  const label = await osCreateText(
    labelText,
    tokens.reviewLabelFontSize,
    tokens.reviewLabelStyle,
    tokens.reviewLabelColor
  );
  label.name = "Review Field Label";
  section.appendChild(label);
  osMakeTextFill(label);

  const box = figma.createFrame();
  box.name = "Review Field";
  section.appendChild(box);
  box.layoutMode = "VERTICAL";
  box.primaryAxisSizingMode = "AUTO";
  box.counterAxisSizingMode = "AUTO";
  box.paddingTop = tokens.reviewFieldPaddingY;
  box.paddingBottom = tokens.reviewFieldPaddingY;
  box.paddingLeft = tokens.reviewFieldPaddingX;
  box.paddingRight = tokens.reviewFieldPaddingX;
  box.fills = [{ type: "SOLID", color: tokens.reviewFieldBgColor }];
  box.strokes = [{ type: "SOLID", color: tokens.reviewFieldStroke }];
  box.strokeWeight = 1;
  box.cornerRadius = tokens.reviewFieldCornerRadius;
  try { box.layoutSizingHorizontal = "FILL"; } catch (e) {}
  if (typeof minHeight === "number" && minHeight > 0) {
    try { box.minHeight = minHeight; } catch (e) {}
  }

  const resolved = osResolveReviewFieldText(override, fieldKey, placeholder);
  const field = await osCreateReviewFieldNode(
    resolved.text,
    tokens.reviewFieldFontSize,
    tokens.reviewFieldStyle,
    resolved.isPlaceholder ? tokens.reviewPlaceholderColor : tokens.textColor,
    fieldKey
  );
  field.name = "Review Field Text";
  box.appendChild(field);
  osMakeTextFill(field);
  // Review framework sections are list-first fields, including their muted
  // placeholders, so a reviewer can click and keep typing in a native list.
  if (osIsReviewListFieldKey(fieldKey)) {
    osApplyReviewFieldListFormatting(field, true);
  } else {
    osClearTextListOptions(field);
  }
  return section;
}

// ---------------------------------------------------------------------------
// Review Status component (Design Review board type).
//
// Status is an INSTANCE of a document-scoped COMPONENT_SET. The plugin prefers
// an existing file master named ".Design Review" (User-Centric Hub design
// system); otherwise it creates "Review Status" on the assets page. Reviewers
// change status through Figma's native variant picker.
// ---------------------------------------------------------------------------

// Locate the off-canvas assets page by name. Reading the page list does not
// require loading the pages, so this stays cheap under dynamic-page access.
function osFindAssetsPage() {
  const pages = figma.root.children;
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].name === OS_ASSETS_PAGE_NAME) return pages[i];
  }
  return null;
}

function osStoreReviewStatusSetId(id) {
  try {
    figma.root.setSharedPluginData(
      OS_REVIEW_NAMESPACE,
      OS_REVIEW_STATUS_SET_KEY,
      id
    );
  } catch (e) {}
}

function osStoreDesignReviewStatusSetId(id) {
  try {
    figma.root.setSharedPluginData(
      OS_REVIEW_NAMESPACE,
      OS_DESIGN_REVIEW_STATUS_SET_KEY,
      id
    );
    osStoreReviewStatusSetId(id);
  } catch (e) {}
}

function osIsPluginCreatedReviewStatusSet(set) {
  return !!(set && set.name === OS_REVIEW_STATUS_SET_NAME);
}

// Find the file's ".Design Review" status COMPONENT_SET (design-system master).
async function osFindDesignReviewStatusSet() {
  let stored = "";
  try {
    stored = figma.root.getSharedPluginData(
      OS_REVIEW_NAMESPACE,
      OS_DESIGN_REVIEW_STATUS_SET_KEY
    );
  } catch (e) {}
  if (stored) {
    let node = null;
    try { node = await figma.getNodeByIdAsync(stored); } catch (e) { node = null; }
    if (node && !node.removed && node.type === "COMPONENT_SET") return node;
  }
  if (typeof figma.loadAllPagesAsync === "function") {
    try { await figma.loadAllPagesAsync(); } catch (e) {}
  }
  const names = OS_DESIGN_REVIEW_STATUS_SET_NAMES;
  for (let pi = 0; pi < figma.root.children.length; pi++) {
    const page = figma.root.children[pi];
    let sets = [];
    if (typeof page.findAllWithCriteria === "function") {
      sets = page.findAllWithCriteria({ types: ["COMPONENT_SET"] });
    } else if (typeof page.findAll === "function") {
      sets = page.findAll(function (n) {
        return n.type === "COMPONENT_SET";
      });
    }
    for (let si = 0; si < sets.length; si++) {
      const s = sets[si];
      for (let ni = 0; ni < names.length; ni++) {
        if (s.name === names[ni]) {
          osStoreDesignReviewStatusSetId(s.id);
          return s;
        }
      }
    }
  }
  return null;
}

// Normalize a resolved component set into the shape the builder consumes.
function osReviewStatusAssets(set) {
  let defaultVariant = OS_REVIEW_STATUS.default;
  if (set.defaultVariant && typeof set.defaultVariant.name === "string") {
    const parts = set.defaultVariant.name.split("=");
    if (parts.length === 2 && parts[1]) defaultVariant = parts[1];
  }
  const variants = [];
  if ("children" in set) {
    for (let i = 0; i < set.children.length; i++) {
      const c = set.children[i];
      if (c.type !== "COMPONENT") continue;
      const v = osParseReviewStatusVariantName(c.name);
      if (v && variants.indexOf(v) < 0) variants.push(v);
    }
  }
  if (!variants.length) {
    for (let j = 0; j < OS_REVIEW_STATUS_VARIANTS.length; j++) {
      variants.push(OS_REVIEW_STATUS_VARIANTS[j]);
    }
  }
  if (variants.indexOf(defaultVariant) < 0 && variants.length) {
    defaultVariant = variants[0];
  }
  return {
    set: set,
    propertyName: OS_REVIEW_STATUS_PROPERTY,
    variants: variants,
    defaultVariant: defaultVariant,
  };
}

function osNormalizeReviewStatusValue(value, assets) {
  if (!value || !assets || !assets.variants) return value;
  if (assets.variants.indexOf(value) >= 0) return value;
  if (value === "In Review" && assets.variants.indexOf("Needs work") >= 0) {
    return "Needs work";
  }
  return assets.defaultVariant;
}

function osReviewStatusStyleFor(value) {
  const styles = OS_REVIEW_STATUS_VARIANT_STYLES;
  if (value && styles[value]) return styles[value];
  return styles[OS_REVIEW_STATUS.default] || styles.Draft;
}

function osParseReviewStatusVariantName(componentName) {
  const parts =
    typeof componentName === "string" ? componentName.split("=") : [];
  if (parts.length >= 2) return parts.slice(1).join("=");
  return typeof componentName === "string" ? componentName : "";
}

// Apply per-status bg + label colors to one variant COMPONENT (or legacy pill).
function osApplyReviewStatusVariantColors(node, value) {
  const style = osReviewStatusStyleFor(value);
  if (!node || !style) return;
  try {
    node.fills = [{ type: "SOLID", color: style.bg }];
  } catch (e) {}
  if ("children" in node) {
    for (let i = 0; i < node.children.length; i++) {
      const ch = node.children[i];
      if (ch.type === "TEXT") {
        try {
          ch.fills = [{ type: "SOLID", color: style.text }];
        } catch (e2) {}
      }
    }
  }
}

// Re-apply palette on an existing Review Status set (e.g. created when every
// variant shared one color). Safe to run on every resolve — only touches fills.
async function osSyncReviewStatusComponentSetColors(set) {
  if (!set || !("children" in set)) return;
  for (let i = 0; i < set.children.length; i++) {
    const comp = set.children[i];
    if (comp.type !== "COMPONENT") continue;
    const value = osParseReviewStatusVariantName(comp.name);
    osApplyReviewStatusVariantColors(comp, value);
  }
}

// One variant COMPONENT ("Status=Draft", ...): a hugging pill with a single
// centered label. Each status value uses its own bg + text color.
async function osCreateReviewStatusVariantComponent(value, tokens) {
  const style = osReviewStatusStyleFor(value);
  const comp = figma.createComponent();
  comp.name = OS_REVIEW_STATUS_PROPERTY + "=" + value;
  comp.layoutMode = "HORIZONTAL";
  comp.primaryAxisSizingMode = "AUTO";
  comp.counterAxisSizingMode = "AUTO";
  comp.counterAxisAlignItems = "CENTER";
  comp.paddingTop = tokens.reviewStatusPaddingY;
  comp.paddingBottom = tokens.reviewStatusPaddingY;
  comp.paddingLeft = tokens.reviewStatusPaddingX;
  comp.paddingRight = tokens.reviewStatusPaddingX;
  comp.fills = [{ type: "SOLID", color: style.bg }];
  comp.cornerRadius = tokens.reviewStatusCornerRadius;
  const label = await osCreateText(
    value,
    tokens.reviewStatusFontSize,
    tokens.reviewStatusStyle,
    style.text
  );
  label.name = "Status";
  comp.appendChild(label);
  return comp;
}

// Resolve (creating if needed) the document's Review Status component set.
// Returns the assets descriptor, or null when this Figma build cannot create
// variant sets (callers then fall back to the legacy inline text pill).
async function osEnsureReviewStatusComponentSet(tokens) {
  // 1. Prefer the file's design-system ".Design Review" master when present.
  const adopted = await osFindDesignReviewStatusSet();
  if (adopted) return osReviewStatusAssets(adopted);

  // 2. Stored id — fastest path on later boards in the same document.
  let stored = "";
  try {
    stored = figma.root.getSharedPluginData(
      OS_REVIEW_NAMESPACE,
      OS_REVIEW_STATUS_SET_KEY
    );
  } catch (e) {}
  if (stored) {
    let node = null;
    try { node = await figma.getNodeByIdAsync(stored); } catch (e) { node = null; }
    if (node && !node.removed && node.type === "COMPONENT_SET") {
      if (osIsPluginCreatedReviewStatusSet(node)) {
        await osSyncReviewStatusComponentSetColors(node);
      }
      return osReviewStatusAssets(node);
    }
  }

  // 3. Existing set on the assets page (id lost or never stored).
  let assetsPage = osFindAssetsPage();
  if (assetsPage) {
    try { await assetsPage.loadAsync(); } catch (e) {}
    for (let i = 0; i < assetsPage.children.length; i++) {
      const child = assetsPage.children[i];
      if (
        child.type === "COMPONENT_SET" &&
        child.name === OS_REVIEW_STATUS_SET_NAME
      ) {
        osStoreReviewStatusSetId(child.id);
        await osSyncReviewStatusComponentSetColors(child);
        return osReviewStatusAssets(child);
      }
    }
  }

  // 4. Create the set. Bail out (text fallback) if the API is unavailable.
  if (typeof figma.combineAsVariants !== "function") return null;
  if (!assetsPage) {
    try { assetsPage = figma.createPage(); } catch (e) { return null; }
    assetsPage.name = OS_ASSETS_PAGE_NAME;
  }

  const comps = [];
  for (let i = 0; i < OS_REVIEW_STATUS_VARIANTS.length; i++) {
    const comp = await osCreateReviewStatusVariantComponent(
      OS_REVIEW_STATUS_VARIANTS[i],
      tokens
    );
    assetsPage.appendChild(comp);
    comps.push(comp);
  }

  let set;
  try {
    set = figma.combineAsVariants(comps, assetsPage);
  } catch (e) {
    for (let i = 0; i < comps.length; i++) {
      try { comps[i].remove(); } catch (e2) {}
    }
    return null;
  }
  set.name = OS_REVIEW_STATUS_SET_NAME;
  try { set.x = -20000; set.y = -20000; } catch (e) {}
  osStoreReviewStatusSetId(set.id);
  return osReviewStatusAssets(set);
}

// Read the variant value off a status instance (e.g. "In Review").
function osReadInstanceStatus(instance) {
  try {
    const props = instance.componentProperties;
    const entry = props ? props[OS_REVIEW_STATUS_PROPERTY] : null;
    if (entry && typeof entry.value === "string") return entry.value;
  } catch (e) {}
  return "";
}

// Append the status instance to a Review Header, applying a preserved value.
async function osAppendReviewStatusInstance(header, assets, override) {
  const set = assets.set;
  let master = set.defaultVariant;
  if (!master && set.children && set.children.length) master = set.children[0];
  if (!master || typeof master.createInstance !== "function") return null;
  const instance = master.createInstance();
  instance.name = "Review Status";
  header.appendChild(instance);
  try {
    instance.setSharedPluginData(
      OS_REVIEW_NAMESPACE,
      OS_REVIEW_FIELD_KEY,
      OS_REVIEW_STATUS.key
    );
  } catch (e) {}
  const raw =
    override && typeof override[OS_REVIEW_STATUS.key] === "string"
      ? override[OS_REVIEW_STATUS.key]
      : "";
  const want = osNormalizeReviewStatusValue(raw, assets);
  if (want && want !== assets.defaultVariant && assets.variants.indexOf(want) >= 0) {
    const props = {};
    props[assets.propertyName] = want;
    try { instance.setProperties(props); } catch (e) {}
  }
  return instance;
}

// Legacy inline text pill — used only when the component set cannot be created
// (older Figma builds) so design-review boards still render a status.
async function osAppendReviewStatusTextPill(header, tokens, override) {
  const pill = figma.createFrame();
  pill.name = "Review Status";
  header.appendChild(pill);
  pill.layoutMode = "HORIZONTAL";
  pill.primaryAxisSizingMode = "AUTO";
  pill.counterAxisSizingMode = "AUTO";
  pill.paddingTop = tokens.reviewStatusPaddingY;
  pill.paddingBottom = tokens.reviewStatusPaddingY;
  pill.paddingLeft = tokens.reviewStatusPaddingX;
  pill.paddingRight = tokens.reviewStatusPaddingX;
  pill.cornerRadius = tokens.reviewStatusCornerRadius;
  const statusStored =
    override &&
    typeof override[OS_REVIEW_STATUS.key] === "string" &&
    override[OS_REVIEW_STATUS.key].length > 0
      ? override[OS_REVIEW_STATUS.key]
      : OS_REVIEW_STATUS.default;
  const statusStyle = osReviewStatusStyleFor(statusStored);
  pill.fills = [{ type: "SOLID", color: statusStyle.bg }];
  const statusText = await osCreateReviewFieldNode(
    statusStored,
    tokens.reviewStatusFontSize,
    tokens.reviewStatusStyle,
    statusStyle.text,
    OS_REVIEW_STATUS.key
  );
  statusText.name = "Review Status Text";
  pill.appendChild(statusText);
  return pill;
}

// Append the Review Status to a header. Resolves the document component set
// once per board (cached on ctx) and prefers an instance; on failure falls
// back to the legacy text pill so the card always renders a status.
async function osAppendReviewStatus(header, tokens, ctx, override) {
  let assets;
  if (ctx) {
    if (!ctx.reviewStatusResolved) {
      ctx.reviewStatusAssets = await osEnsureReviewStatusComponentSet(tokens);
      ctx.reviewStatusResolved = true;
    }
    assets = ctx.reviewStatusAssets;
  } else {
    assets = await osEnsureReviewStatusComponentSet(tokens);
  }
  if (assets && assets.set && !assets.set.removed) {
    await osAppendReviewStatusInstance(header, assets, override);
  } else {
    await osAppendReviewStatusTextPill(header, tokens, override);
  }
}

// Build and append the Review Card inside the Review Column (Design Review v2).
// `reviewCfg` supplies `status` / `notes` toggles; `framework` supplies sections;
// `override` carries preserved field text on recompose.
async function osBuildReviewCard(parent, frame, tokens, reviewCfg, framework, override, ctx) {
  framework = framework || REVIEW_FRAMEWORKS.standard;
  const review = figma.createFrame();
  review.name = "Review Card";
  parent.appendChild(review);
  review.layoutMode = "VERTICAL";
  review.primaryAxisSizingMode = "AUTO";
  review.counterAxisSizingMode = "AUTO";
  review.itemSpacing = tokens.reviewSectionGap;
  review.paddingTop = 0;
  review.paddingBottom = 0;
  review.paddingLeft = 0;
  review.paddingRight = 0;
  review.fills = [];
  review.strokes = [];
  review.cornerRadius = tokens.reviewCardCornerRadius;
  try { review.layoutSizingHorizontal = "FILL"; } catch (e) {}
  try {
    review.setSharedPluginData(
      OS_REVIEW_NAMESPACE,
      OS_REVIEW_CARD_KEY,
      frame && frame.id ? frame.id : ""
    );
  } catch (e) {}

  // ----- Pill header: title + optional status -----
  const header = figma.createFrame();
  header.name = "Review Header";
  review.appendChild(header);
  header.layoutMode = "HORIZONTAL";
  header.primaryAxisSizingMode = "AUTO";
  header.counterAxisSizingMode = "AUTO";
  header.counterAxisAlignItems = "CENTER";
  header.itemSpacing = tokens.reviewGap;
  header.paddingTop = tokens.reviewHeaderPaddingY;
  header.paddingBottom = tokens.reviewHeaderPaddingY;
  header.paddingLeft = tokens.reviewHeaderPaddingX;
  header.paddingRight = tokens.reviewHeaderPaddingX;
  header.cornerRadius = tokens.reviewHeaderCornerRadius;
  header.fills = [];
  header.strokes = [{ type: "SOLID", color: tokens.reviewHeaderStroke }];
  header.strokeWeight = 1;
  try { header.layoutSizingHorizontal = "FILL"; } catch (e) {}

  const title = await osCreateText(
    OS_REVIEW_HEADER.title,
    tokens.reviewTitleFontSize,
    tokens.reviewTitleStyle,
    tokens.reviewLabelColor
  );
  title.name = "Review Title";
  header.appendChild(title);
  osMakeTextFill(title);

  if (reviewCfg.status) {
    await osAppendReviewStatus(header, tokens, ctx, override);
  }

  // ----- Review Content: description + sections -----
  const content = figma.createFrame();
  content.name = "Review Content";
  review.appendChild(content);
  content.layoutMode = "VERTICAL";
  content.primaryAxisSizingMode = "AUTO";
  content.counterAxisSizingMode = "AUTO";
  content.itemSpacing = tokens.reviewSectionGap;
  content.paddingTop = 0;
  content.paddingBottom = 0;
  content.paddingLeft = tokens.reviewContentPaddingX;
  content.paddingRight = tokens.reviewContentPaddingX;
  content.fills = [];
  try { content.layoutSizingHorizontal = "FILL"; } catch (e) {}

  const descResolved = osResolveReviewFieldText(
    override,
    OS_REVIEW_HEADER.descriptionKey,
    OS_REVIEW_HEADER.descriptionPlaceholder
  );
  const headerDesc = await osCreateReviewFieldNode(
    descResolved.text,
    tokens.reviewFieldFontSize,
    tokens.reviewFieldStyle,
    descResolved.isPlaceholder
      ? tokens.reviewPlaceholderColor
      : tokens.mutedTextColor,
    OS_REVIEW_HEADER.descriptionKey
  );
  headerDesc.name = "Review Header Description";
  content.appendChild(headerDesc);
  osMakeTextFill(headerDesc);

  for (let i = 0; i < framework.sections.length; i++) {
    const def = framework.sections[i];
    if (!def) continue;
    await osBuildReviewSection(
      content,
      def.label,
      def.key,
      override,
      def.placeholder,
      tokens,
      tokens.reviewFieldMinHeight
    );
  }

  if (reviewCfg.notes) {
    await osBuildReviewSection(
      content,
      framework.notes.label,
      framework.notes.key,
      override,
      framework.notes.placeholder,
      tokens,
      tokens.reviewNotesMinHeight
    );
  }

  return review;
}

// ---------------------------------------------------------------------------
// Functional Card (Functional Analysis board type).
//
// A structured, editable documentation surface stacked full-width BELOW each
// Screen Card's screen + description. Every section is exactly one native TEXT
// node tagged via sharedPluginData (OS_FUNC_FIELD_KEY = sectionKey) so the
// plugin can locate it deterministically. Empty fields render their muted
// placeholder; a reviewer just clicks and types, or runs Create Documentation.
// Mirrors the Review Card builders so the design-review path is untouched.
// ---------------------------------------------------------------------------

async function osCreateFuncFieldNode(value, fontSize, style, color, fieldKey) {
  const t = await osCreateText(value, fontSize, style, color);
  try {
    t.setSharedPluginData(OS_REVIEW_NAMESPACE, OS_FUNC_FIELD_KEY, fieldKey);
  } catch (e) {}
  return t;
}

// One labelled, boxed functional section (label + an input-like field box).
// Reuses the Review Card's field tokens for visual consistency.
async function osBuildFuncSection(
  parent,
  labelText,
  fieldKey,
  override,
  placeholder,
  tokens,
  minHeight
) {
  const section = figma.createFrame();
  section.name = "Functional Section / " + fieldKey;
  parent.appendChild(section);
  section.layoutMode = "VERTICAL";
  section.primaryAxisSizingMode = "AUTO";
  section.counterAxisSizingMode = "AUTO";
  section.itemSpacing = tokens.reviewLabelFieldGap;
  section.fills = [];
  try { section.layoutSizingHorizontal = "FILL"; } catch (e) {}

  const label = await osCreateText(
    labelText,
    tokens.reviewLabelFontSize,
    tokens.reviewLabelStyle,
    tokens.reviewLabelColor
  );
  label.name = "Functional Label";
  section.appendChild(label);
  osMakeTextFill(label);

  const box = figma.createFrame();
  box.name = "Functional Field";
  section.appendChild(box);
  box.layoutMode = "VERTICAL";
  box.primaryAxisSizingMode = "AUTO";
  box.counterAxisSizingMode = "AUTO";
  box.paddingTop = tokens.reviewFieldPaddingY;
  box.paddingBottom = tokens.reviewFieldPaddingY;
  box.paddingLeft = tokens.reviewFieldPaddingX;
  box.paddingRight = tokens.reviewFieldPaddingX;
  box.fills = [{ type: "SOLID", color: tokens.reviewFieldBgColor }];
  box.strokes = [{ type: "SOLID", color: tokens.reviewFieldStroke }];
  box.strokeWeight = 1;
  box.cornerRadius = tokens.reviewFieldCornerRadius;
  try { box.layoutSizingHorizontal = "FILL"; } catch (e) {}
  if (typeof minHeight === "number" && minHeight > 0) {
    try { box.minHeight = minHeight; } catch (e) {}
  }

  // Reuses the generic review field-text resolver (override/placeholder logic
  // is identical): a stored value that differs from the placeholder reads as
  // real (dark) text; otherwise the muted placeholder.
  const resolved = osResolveReviewFieldText(override, fieldKey, placeholder);
  const field = await osCreateFuncFieldNode(
    resolved.text,
    tokens.reviewFieldFontSize,
    tokens.reviewFieldStyle,
    resolved.isPlaceholder ? tokens.reviewPlaceholderColor : tokens.textColor,
    fieldKey
  );
  field.name = "Functional Field Text";
  box.appendChild(field);
  osMakeTextFill(field);
  return section;
}

// Build and append the Functional Card. `cfg` supplies the ordered section
// keys; `override` carries preserved field text on recompose; an optional
// `override.funcConfidence` renders a muted confidence note in the header.
async function osBuildFunctionalCard(parent, frame, tokens, cfg, override, ctx) {
  void ctx;
  const isAdvanced = !!(cfg && cfg.mode === "advanced");
  // Basic mode renders the 8 structured section fields; Advanced renders a
  // single long-form documentation field. The builder reads only its mode's
  // keys from `override`, so a mode switch naturally yields placeholders for
  // the new structure (no cross-mode content leak).
  const sectionsKeys = isAdvanced
    ? [OS_FUNCTIONAL_DOC_KEY]
    : cfg && Array.isArray(cfg.sections) && cfg.sections.length
    ? cfg.sections
    : OS_FUNCTIONAL_SECTION_KEYS;

  const fcard = figma.createFrame();
  fcard.name = "Functional Card";
  parent.appendChild(fcard);
  fcard.layoutMode = "VERTICAL";
  fcard.primaryAxisSizingMode = "AUTO";
  fcard.counterAxisSizingMode = "AUTO";
  fcard.itemSpacing = tokens.reviewSectionGap;
  fcard.paddingTop = 0;
  fcard.paddingBottom = 0;
  fcard.paddingLeft = 0;
  fcard.paddingRight = 0;
  fcard.fills = [];
  fcard.strokes = [];
  fcard.cornerRadius = tokens.reviewCardCornerRadius;
  try { fcard.layoutSizingHorizontal = "FILL"; } catch (e) {}
  try {
    fcard.setSharedPluginData(
      OS_REVIEW_NAMESPACE,
      OS_FUNC_CARD_KEY,
      frame && frame.id ? frame.id : ""
    );
  } catch (e) {}

  // ----- Pill header: title + optional confidence note -----
  const header = figma.createFrame();
  header.name = "Functional Header";
  fcard.appendChild(header);
  header.layoutMode = "HORIZONTAL";
  header.primaryAxisSizingMode = "AUTO";
  header.counterAxisSizingMode = "AUTO";
  header.counterAxisAlignItems = "CENTER";
  header.itemSpacing = tokens.reviewGap;
  header.paddingTop = tokens.reviewHeaderPaddingY;
  header.paddingBottom = tokens.reviewHeaderPaddingY;
  header.paddingLeft = tokens.reviewHeaderPaddingX;
  header.paddingRight = tokens.reviewHeaderPaddingX;
  header.cornerRadius = tokens.reviewHeaderCornerRadius;
  header.fills = [];
  header.strokes = [{ type: "SOLID", color: tokens.reviewHeaderStroke }];
  header.strokeWeight = 1;
  try { header.layoutSizingHorizontal = "FILL"; } catch (e) {}

  const title = await osCreateText(
    OS_FUNCTIONAL_HEADER.title,
    tokens.reviewTitleFontSize,
    tokens.reviewTitleStyle,
    tokens.reviewLabelColor
  );
  title.name = "Functional Title";
  header.appendChild(title);
  osMakeTextFill(title);

  // Confidence note: a muted, tagged TEXT that Create Documentation overwrites
  // with the model's confidence. Always present (empty by default) so the apply
  // path can resolve it by tag without rebuilding the header.
  const confidenceStored =
    override && typeof override[OS_FUNCTIONAL_HEADER.confidenceKey] === "string"
      ? override[OS_FUNCTIONAL_HEADER.confidenceKey]
      : "";
  const confidence = await osCreateFuncFieldNode(
    confidenceStored,
    tokens.reviewFieldFontSize,
    tokens.reviewFieldStyle,
    tokens.mutedTextColor,
    OS_FUNCTIONAL_HEADER.confidenceKey
  );
  confidence.name = "Functional Confidence";
  header.appendChild(confidence);
  // Hug, not FILL: this note is empty at build time and a FILL + HEIGHT node
  // collapses to ~0 width, wrapping the later "Confidence: …" text vertically.
  osMakeTextHug(confidence);

  // ----- Functional Content: per-section fields -----
  const content = figma.createFrame();
  content.name = "Functional Content";
  fcard.appendChild(content);
  content.layoutMode = "VERTICAL";
  content.primaryAxisSizingMode = "AUTO";
  content.counterAxisSizingMode = "AUTO";
  content.itemSpacing = tokens.reviewSectionGap;
  content.paddingTop = 0;
  content.paddingBottom = 0;
  content.paddingLeft = tokens.reviewContentPaddingX;
  content.paddingRight = tokens.reviewContentPaddingX;
  content.fills = [];
  try { content.layoutSizingHorizontal = "FILL"; } catch (e) {}

  for (let i = 0; i < sectionsKeys.length; i++) {
    const def = OS_FUNCTIONAL_SECTION_BY_KEY[sectionsKeys[i]];
    if (!def) continue;
    // The single Advanced doc field holds a full report — give it more room.
    const minHeight = isAdvanced
      ? Math.max(tokens.reviewFieldMinHeight, tokens.reviewNotesMinHeight) * 2
      : tokens.reviewFieldMinHeight;
    await osBuildFuncSection(
      content,
      def.label,
      def.key,
      override,
      def.placeholder,
      tokens,
      minHeight
    );
  }

  return fcard;
}

// Left column of a Design Review card: optional annotations, screen, description.
async function osBuildCardScreenColumn(
  parent,
  frame,
  tokens,
  ctx,
  isHero,
  descText,
  allowAnnotation
) {
  const col = figma.createFrame();
  col.name = "Screen Column";
  parent.appendChild(col);
  col.layoutMode = "VERTICAL";
  col.primaryAxisSizingMode = "AUTO";
  col.counterAxisSizingMode = "AUTO";
  col.itemSpacing = tokens.cardGap;
  col.fills = [];
  col.clipsContent = false;

  const ann = osEffectiveAnnotation(ctx, frame);

  if (allowAnnotation && ann.config.position === "aboveScreen") {
    await osAppendAnnotationSlot(col, frame, tokens, ann.config, ann.preserved);
  }

  col.appendChild(frame);
  osPreserveFrameSize(frame);

  const cardDesc = await osCreateText(
    descText,
    tokens.cardDescFontSize,
    tokens.cardDescStyle,
    tokens.mutedTextColor
  );
  cardDesc.name = "Card Description";
  col.appendChild(cardDesc);
  osMakeTextFill(cardDesc);

  if (allowAnnotation && ann.config.position === "belowDescription") {
    await osAppendAnnotationSlot(col, frame, tokens, ann.config, ann.preserved);
  }

  const screenW =
    frame && typeof frame.width === "number" && frame.width > 0
      ? frame.width
      : 800;
  try {
    col.layoutSizingHorizontal = "FIXED";
    col.resize(screenW, col.height);
  } catch (e) {}

  return col;
}

async function osBuildCard(parent, frame, tokens, plan, ctx, frameIndex, profile) {
  const card = figma.createFrame();
  card.name = "Screen Card / " + (frame.name || "Untitled");
  parent.appendChild(card);
  card.layoutMode = "VERTICAL";
  card.primaryAxisSizingMode = "AUTO";
  card.counterAxisSizingMode = "AUTO";
  card.counterAxisAlignItems = "MIN";
  card.itemSpacing = tokens.cardGap;
  card.paddingTop = tokens.cardPadding;
  card.paddingBottom = tokens.cardPadding;
  card.paddingLeft = tokens.cardPadding;
  card.paddingRight = tokens.cardPadding;
  card.fills = [{ type: "SOLID", color: tokens.cardBgColor }];

  const isHero =
    plan.emphasis && typeof plan.emphasis.heroIndex === "number" &&
    plan.emphasis.heroIndex === frameIndex;
  card.strokes = [{
    type: "SOLID",
    color: isHero ? tokens.heroStroke : tokens.cardStroke,
  }];
  card.strokeWeight = isHero ? 2 : 1;
  card.cornerRadius = tokens.cardCornerRadius;

  // Resolve copy. Edit/recompose passes per-frame overrides keyed by the
  // source frame's id; the override is the snapshot taken from the live
  // board text right before the rebuild, so anything the user typed --
  // including an intentionally empty string -- is preserved verbatim.
  // First-time compose has no override and falls back to the cleaned
  // frame name and a personality-aware placeholder description.
  const override =
    ctx.copyOverrides && frame && frame.id
      ? ctx.copyOverrides[frame.id]
      : null;
  const titleText =
    override && typeof override.title === "string"
      ? override.title
      : osCleanTitle(frame.name);
  const descText =
    override && typeof override.description === "string"
      ? override.description
      : osPlaceholderDescription(profile);

  const cardTitle = await osCreateText(
    titleText,
    tokens.cardTitleFontSize,
    tokens.cardTitleStyle,
    tokens.textColor
  );
  cardTitle.name = "Card Title";
  card.appendChild(cardTitle);
  osMakeTextFill(cardTitle);

  const allowAnnotation =
    ctx.annotations.enabled && !(isHero && ctx.annotations.skipHero);

  const useSideBySideReview =
    profile.id === "design-review" &&
    profile.reviewCard &&
    profile.reviewCard.enabled &&
    !ctx.suppressReview;

  let reviewBaseline = null;

  if (useSideBySideReview) {
    const body = figma.createFrame();
    body.name = "Card Body";
    card.appendChild(body);
    body.layoutMode = "HORIZONTAL";
    body.primaryAxisSizingMode = "AUTO";
    body.counterAxisSizingMode = "AUTO";
    body.counterAxisAlignItems = "MIN";
    body.primaryAxisAlignItems = "MIN";
    body.itemSpacing = tokens.cardBodyGapX;
    body.fills = [];
    body.clipsContent = false;
    try { body.layoutSizingHorizontal = "FILL"; } catch (e) {}

    await osBuildCardScreenColumn(
      body,
      frame,
      tokens,
      ctx,
      isHero,
      descText,
      allowAnnotation
    );

    // Empty Review Column placeholder. The Review Card itself is built in the
    // pipeline's step 4 (osBuildSection_createReviewCards) by draining the
    // queue below; column width is finalized in step 5. Capturing the review
    // framework here snapshots comparative vs standard so it cannot leak
    // across the variant loop.
    const reviewCol = figma.createFrame();
    reviewCol.name = "Review Column";
    body.appendChild(reviewCol);
    reviewCol.layoutMode = "VERTICAL";
    reviewCol.primaryAxisSizingMode = "AUTO";
    reviewCol.counterAxisSizingMode = "AUTO";
    reviewCol.fills = [];

    const reviewOverride =
      ctx.reviewOverrides && frame && frame.id
        ? ctx.reviewOverrides[frame.id]
        : null;

    if (ctx.pendingReviews) {
      ctx.pendingReviews.push({
        reviewCol: reviewCol,
        frame: frame,
        reviewOverride: reviewOverride,
        reviewFrameworkId: ctx.reviewFrameworkId,
        fixedColumnWidth: tokens.reviewColumnWidth,
      });
    }

    if (reviewOverride && typeof reviewOverride === "object") {
      reviewBaseline = reviewOverride;
    }
  } else {
    const ann = osEffectiveAnnotation(ctx, frame);

    if (allowAnnotation && ann.config.position === "aboveScreen") {
      await osAppendAnnotationSlot(card, frame, tokens, ann.config, ann.preserved);
    }

    card.appendChild(frame);
    osPreserveFrameSize(frame);

    const cardDesc = await osCreateText(
      descText,
      tokens.cardDescFontSize,
      tokens.cardDescStyle,
      tokens.mutedTextColor
    );
    cardDesc.name = "Card Description";
    card.appendChild(cardDesc);
    osMakeTextFill(cardDesc);

    if (allowAnnotation && ann.config.position === "belowDescription") {
      await osAppendAnnotationSlot(card, frame, tokens, ann.config, ann.preserved);
    }

    if (profile.reviewCard && profile.reviewCard.enabled && !ctx.suppressReview) {
      // Defensive path: a non-design-review board type with reviews enabled
      // would render the Review Card stacked vertically inside the card. Built
      // in step 4 like the side-by-side path (no fixed column width).
      const reviewOverride =
        ctx.reviewOverrides && frame && frame.id
          ? ctx.reviewOverrides[frame.id]
          : null;

      if (ctx.pendingReviews) {
        ctx.pendingReviews.push({
          reviewCol: card,
          frame: frame,
          reviewOverride: reviewOverride,
          reviewFrameworkId: ctx.reviewFrameworkId,
          fixedColumnWidth: 0,
        });
      }

      if (reviewOverride && typeof reviewOverride === "object") {
        reviewBaseline = reviewOverride;
      }
    }

    // Functional Analysis: stacked, full-width documentation card built below
    // the screen + description. Enqueued here and drained in pipeline step 4b
    // (osBuildSection_createFunctionalCards) so width/layout finalize with the
    // rest of the board, mirroring how Review Cards are deferred.
    if (
      profile.functionalCard &&
      profile.functionalCard.enabled &&
      !ctx.suppressDocs
    ) {
      const funcOverride =
        ctx.funcOverrides && frame && frame.id
          ? ctx.funcOverrides[frame.id]
          : null;
      if (ctx.pendingDocs) {
        ctx.pendingDocs.push({
          funcCol: card,
          frame: frame,
          funcOverride: funcOverride,
        });
      }
    }
  }

  ctx.cardIds.push(card.id);
  if (ctx.cardNodes) ctx.cardNodes.push(card);
  ctx.currentRowCards.push(card);
  if (ctx.copyBaselineCards) {
    const baselineEntry = {
      frameId: frame && frame.id ? frame.id : "",
      title: titleText,
      description: descText,
    };
    if (reviewBaseline) baselineEntry.review = reviewBaseline;
    // Persist the functional documentation baseline even when this board type
    // does not render a Functional Card, so a Functional -> Custom -> Functional
    // round trip keeps the generated/edited text (parallel to the annotation
    // preservation just below).
    const docOverrideForBaseline =
      ctx.funcOverrides && frame && frame.id
        ? ctx.funcOverrides[frame.id]
        : null;
    if (docOverrideForBaseline && typeof docOverrideForBaseline === "object") {
      baselineEntry.doc = docOverrideForBaseline;
    }
    // Persist the preserved note even when this board type does not render it,
    // so a Custom -> Design Review -> Custom round trip keeps text + placement.
    const annBaseline =
      ctx.annotationOverrides && frame && frame.id
        ? ctx.annotationOverrides[frame.id]
        : null;
    if (annBaseline && typeof annBaseline === "object") {
      baselineEntry.annotation = {
        text: typeof annBaseline.text === "string" ? annBaseline.text : "",
        position:
          annBaseline.position === "aboveScreen" ? "aboveScreen" : "belowDescription",
        mode: annBaseline.mode === "expanded" ? "expanded" : "compact",
      };
    }
    ctx.copyBaselineCards.push(baselineEntry);
  }
  if (isHero) ctx.heroCardId = card.id;
  return card;
}

async function osBuildRow(parent, indices, rowIndex, frames, tokens, plan, ctx, profile) {
  const row = figma.createFrame();
  row.name = osRowName(plan, rowIndex);
  parent.appendChild(row);
  row.layoutMode = "HORIZONTAL";
  row.primaryAxisSizingMode = "AUTO";
  row.counterAxisSizingMode = "AUTO";
  row.itemSpacing = tokens.gridGapX;
  row.counterAxisAlignItems = "MIN";
  row.primaryAxisAlignItems = "MIN";
  row.fills = [];

  ctx.currentRowCards = [];
  ctx.cardsByRow.push(ctx.currentRowCards);

  for (let i = 0; i < indices.length; i++) {
    await osBuildCard(row, frames[indices[i]], tokens, plan, ctx, indices[i], profile);
  }
}

async function osBuildGroup(parent, group, frames, tokens, plan, ctx, profile) {
  const cluster = figma.createFrame();
  cluster.name = group.label;
  parent.appendChild(cluster);
  cluster.layoutMode = "VERTICAL";
  cluster.primaryAxisSizingMode = "AUTO";
  cluster.counterAxisSizingMode = "AUTO";
  cluster.itemSpacing = tokens.stripGapY;
  cluster.fills = [];

  const label = await osCreateText(
    group.label,
    tokens.groupLabelFontSize,
    tokens.groupLabelStyle,
    tokens.textColor
  );
  label.name = "Cluster Label";
  cluster.appendChild(label);
  osMakeTextFill(label);

  const innerGrid = figma.createFrame();
  innerGrid.name = "Cluster Rows";
  cluster.appendChild(innerGrid);
  innerGrid.layoutMode = "VERTICAL";
  innerGrid.primaryAxisSizingMode = "AUTO";
  innerGrid.counterAxisSizingMode = "AUTO";
  innerGrid.itemSpacing = tokens.stripGapY;
  innerGrid.fills = [];

  for (let r = 0; r < group.rows.length; r++) {
    await osBuildRow(innerGrid, group.rows[r], r, frames, tokens, plan, ctx, profile);
  }
}

// ---------------------------------------------------------------------------
// Variant builders (multi-proposal A/B/C).
// ---------------------------------------------------------------------------

async function osBuildAssessmentColumn(
  parent,
  name,
  titleText,
  hintText,
  bgColor,
  titleColor,
  tokens
) {
  const col = figma.createFrame();
  col.name = name;
  parent.appendChild(col);
  col.layoutMode = "VERTICAL";
  col.primaryAxisSizingMode = "AUTO";
  col.counterAxisSizingMode = "AUTO";
  col.itemSpacing = Math.round(tokens.cardGap / 2);
  col.paddingTop = Math.round(tokens.cardPadding / 2);
  col.paddingBottom = Math.round(tokens.cardPadding / 2);
  col.paddingLeft = Math.round(tokens.cardPadding / 2);
  col.paddingRight = Math.round(tokens.cardPadding / 2);
  col.cornerRadius = tokens.cardCornerRadius;
  col.fills = [{ type: "SOLID", color: bgColor }];
  // Equal-width columns within the horizontal Assessment frame.
  if ("layoutSizingHorizontal" in col) {
    try { col.layoutSizingHorizontal = "FILL"; } catch (e) {}
  }

  const title = await osCreateText(
    titleText,
    tokens.cardTitleFontSize,
    tokens.cardTitleStyle,
    titleColor
  );
  title.name = "Title";
  col.appendChild(title);
  osMakeTextFill(title);

  const content = figma.createFrame();
  content.name = "Content";
  col.appendChild(content);
  content.layoutMode = "VERTICAL";
  content.primaryAxisSizingMode = "AUTO";
  content.counterAxisSizingMode = "AUTO";
  content.fills = [];
  if ("layoutSizingHorizontal" in content) {
    try { content.layoutSizingHorizontal = "FILL"; } catch (e) {}
  }

  const hint = await osCreateText(
    hintText,
    tokens.annotationFontSize,
    tokens.annotationStyle,
    tokens.mutedTextColor
  );
  hint.name = "Annotation Hint";
  content.appendChild(hint);
  osMakeTextFill(hint);
  return col;
}

// Build the "Assessment" frame (Pros + Cons) and append it to `card`.
// Caller is responsible for moving it to the desired index. `prosText` /
// `consText` default to the design's placeholder copy when undefined, so
// recompose can pass preserved user text verbatim.
async function osBuildAssessmentSlot(card, tokens, prosText, consText) {
  const assessment = figma.createFrame();
  assessment.name = "Assessment";
  card.appendChild(assessment);
  assessment.layoutMode = "HORIZONTAL";
  assessment.primaryAxisSizingMode = "AUTO";
  assessment.counterAxisSizingMode = "AUTO";
  assessment.itemSpacing = tokens.cardGap;
  assessment.counterAxisAlignItems = "MIN";
  assessment.fills = [];
  if ("layoutSizingHorizontal" in assessment) {
    try { assessment.layoutSizingHorizontal = "FILL"; } catch (e) {}
  }

  await osBuildAssessmentColumn(
    assessment,
    "Pros",
    "Pro's",
    typeof prosText === "string" ? prosText : "Add pro's from this version here",
    OS_VARIANT_COLORS.prosBg,
    OS_VARIANT_COLORS.prosText,
    tokens
  );
  await osBuildAssessmentColumn(
    assessment,
    "Cons",
    "Con's",
    typeof consText === "string" ? consText : "Add cons here",
    OS_VARIANT_COLORS.consBg,
    OS_VARIANT_COLORS.consText,
    tokens
  );
  return assessment;
}

// Build a single variant card. Two structured surfaces are possible:
//   - Design Review board type: a Comparative Review Card (Pros / Cons / Open
//     Questions / Improvement Ideas / Decision Notes), appended at the bottom of
//     the card like a singleton Review Card.
//   - Custom board type: the legacy Assessment (Pros/Cons) block spliced in just
//     before the Card Description (unchanged, byte-stable output).
// The variant label is appended to the Card Title on first compose only; on
// recompose a preserved title override already carries the label.
async function osBuildVariantCard(
  strip,
  frame,
  label,
  tokens,
  plan,
  ctx,
  profile
) {
  const comparativeReview =
    !!(profile.reviewCard && profile.reviewCard.enabled);

  let card;
  if (comparativeReview) {
    // Route through osBuildCard's review path with the comparative framework so
    // the variant gets a full Comparative Review Card (no Assessment block).
    const prevFramework = ctx.reviewFrameworkId;
    ctx.reviewFrameworkId = "comparative";
    card = await osBuildCard(strip, frame, tokens, plan, ctx, -1, profile);
    ctx.reviewFrameworkId = prevFramework;
  } else {
    // Custom board type: suppress the Review Card and use the Assessment block.
    const prevSuppress = ctx.suppressReview;
    ctx.suppressReview = true;
    card = await osBuildCard(strip, frame, tokens, plan, ctx, -1, profile);
    ctx.suppressReview = prevSuppress;
  }

  const override =
    ctx.copyOverrides && frame && frame.id ? ctx.copyOverrides[frame.id] : null;
  const hasTitleOverride = override && typeof override.title === "string";

  const titleNode = osFindNamedTextChild(card, "Card Title");
  if (titleNode && label && !hasTitleOverride) {
    const base =
      typeof titleNode.characters === "string" ? titleNode.characters : "";
    const labelled = base ? base + " \u2014 " + label : label;
    try { titleNode.characters = labelled; } catch (e) {}
  }

  if (!comparativeReview) {
    const prosText =
      override && typeof override.pros === "string" ? override.pros : undefined;
    const consText =
      override && typeof override.cons === "string" ? override.cons : undefined;
    const assessment = await osBuildAssessmentSlot(
      card,
      tokens,
      prosText,
      consText
    );

    // Splice Assessment in just before "Card Description".
    const descNode = osFindNamedTextChild(card, "Card Description");
    if (descNode) {
      const descIdx = card.children.indexOf(descNode);
      if (descIdx >= 0) {
        try { card.insertChild(descIdx, assessment); } catch (e) {}
      }
    }
  }
  return card;
}

// Build the cross-option Decision card for a comparative variant group. It is a
// sibling of the variant Screen Cards inside the Variant Strip (not a Screen
// Card itself, so it never enters osCollectCardsInGrid). Fields are tagged like
// review fields so they read as editable native text; the frame is tagged with
// the group key so recompose can replay preserved decisions. `override` is the
// preserved { fieldKey: text } map for this group.
async function osBuildDecisionCard(strip, groupKey, tokens, override) {
  const decision = figma.createFrame();
  decision.name = "Decision Card";
  strip.appendChild(decision);
  decision.layoutMode = "VERTICAL";
  decision.primaryAxisSizingMode = "AUTO";
  decision.counterAxisSizingMode = "AUTO";
  decision.itemSpacing = tokens.reviewSectionGap;
  decision.paddingTop = tokens.reviewPadding;
  decision.paddingBottom = tokens.reviewPadding;
  decision.paddingLeft = tokens.reviewPadding;
  decision.paddingRight = tokens.reviewPadding;
  decision.fills = [{ type: "SOLID", color: tokens.decisionBgColor }];
  decision.strokes = [{ type: "SOLID", color: tokens.reviewStroke }];
  decision.strokeWeight = 1;
  decision.cornerRadius = tokens.reviewCardCornerRadius;
  try {
    decision.setSharedPluginData(
      OS_REVIEW_NAMESPACE,
      OS_DECISION_CARD.cardKey,
      groupKey || ""
    );
  } catch (e) {}

  const title = await osCreateText(
    OS_DECISION_CARD.title,
    tokens.reviewTitleFontSize,
    tokens.reviewTitleStyle,
    tokens.reviewLabelColor
  );
  title.name = "Decision Title";
  decision.appendChild(title);
  osMakeTextFill(title);

  for (let i = 0; i < OS_DECISION_CARD.fields.length; i++) {
    const f = OS_DECISION_CARD.fields[i];
    await osBuildReviewSection(
      decision,
      f.label,
      f.key,
      override,
      f.placeholder,
      tokens,
      tokens.reviewFieldMinHeight
    );
  }
  return decision;
}

// Build a Variant Group: a titled, tinted panel ("N variants") wrapping a
// horizontal strip of variant cards (and, for Design Review boards, a final
// Decision card column). Pushes a result entry onto `ctx.variantGroupResults`
// (used for the metadata envelope + the compose result). Cards are equal-width
// within the strip.
async function osBuildVariantStrip(parent, group, tokens, plan, ctx, profile) {
  // Outer panel — groups the comparison into one visual unit with its own
  // background so it reads as distinct from singleton screens on the board.
  const wrapper = figma.createFrame();
  wrapper.name = "Variant Group / " + group.label;
  parent.appendChild(wrapper);
  wrapper.layoutMode = "VERTICAL";
  wrapper.primaryAxisSizingMode = "AUTO";
  wrapper.counterAxisSizingMode = "AUTO";
  wrapper.itemSpacing = tokens.variantGroupTitleGap;
  wrapper.counterAxisAlignItems = "MIN";
  wrapper.paddingTop = tokens.variantGroupPadding;
  wrapper.paddingBottom = tokens.variantGroupPadding;
  wrapper.paddingLeft = tokens.variantGroupPadding;
  wrapper.paddingRight = tokens.variantGroupPadding;
  wrapper.fills = [{ type: "SOLID", color: tokens.variantGroupBgColor }];
  wrapper.strokes = [{ type: "SOLID", color: tokens.variantGroupStroke }];
  wrapper.strokeWeight = 1;
  wrapper.cornerRadius = tokens.variantGroupCornerRadius;

  const variantCount = group.frames.length;
  const titleText = group.label
    ? group.label + " \u00B7 " + variantCount + " variants"
    : variantCount + " variants";
  const groupTitle = await osCreateText(
    titleText,
    tokens.groupLabelFontSize,
    tokens.groupLabelStyle,
    tokens.variantGroupTitleColor
  );
  groupTitle.name = "Variant Group Title";
  wrapper.appendChild(groupTitle);
  osMakeTextFill(groupTitle);

  const strip = figma.createFrame();
  strip.name = "Variant Strip / " + group.label;
  wrapper.appendChild(strip);
  strip.layoutMode = "HORIZONTAL";
  strip.primaryAxisSizingMode = "AUTO";
  strip.counterAxisSizingMode = "AUTO";
  strip.itemSpacing = tokens.gridGapX;
  strip.counterAxisAlignItems = "MIN";
  strip.primaryAxisAlignItems = "MIN";
  strip.fills = [];

  const result = {
    key: group.key,
    label: group.label,
    variantLabels: group.variantLabels.slice(),
    source: group.source,
    sourceFrameIds: [],
    cardIds: [],
  };
  const stripCards = [];
  for (let i = 0; i < group.frames.length; i++) {
    const frame = group.frames[i];
    const label = group.variantLabels[i] || String(i + 1);
    const card = await osBuildVariantCard(
      strip,
      frame,
      label,
      tokens,
      plan,
      ctx,
      profile
    );
    stripCards.push(card);
    result.sourceFrameIds.push(frame && frame.id ? frame.id : "");
    result.cardIds.push(card.id);
  }

  // Design Review: append a cross-option Decision card as the final column.
  if (profile.reviewCard && profile.reviewCard.enabled) {
    const decisionOverride =
      ctx.decisionOverrides && group.key
        ? ctx.decisionOverrides[group.key]
        : null;
    const decisionCard = await osBuildDecisionCard(
      strip,
      group.key,
      tokens,
      decisionOverride
    );
    stripCards.push(decisionCard);
  }

  // Defer strip width equalization to the pipeline's step 5 so it measures
  // cards after their Review Columns are filled (osEqualizeStripCardWidths).
  if (!ctx.stripCardSets) ctx.stripCardSets = [];
  ctx.stripCardSets.push(stripCards);

  if (!ctx.variantGroupResults) ctx.variantGroupResults = [];
  ctx.variantGroupResults.push(result);
  return wrapper;
}

async function osBuildScreensGrid(gridFrame, plan, tokens, frames, ctx, profile) {
  const rows = plan.rows;

  // Single row: all cards are direct children of Screens Grid (horizontal).
  if (
    (plan.strategy === "horizontalStrip" || plan.strategy === "singleRow") &&
    rows.length === 1 &&
    !plan.groups.length
  ) {
    gridFrame.layoutMode = "HORIZONTAL";
    gridFrame.itemSpacing = tokens.gridGapX;
    gridFrame.counterAxisAlignItems = "MIN";
    gridFrame.primaryAxisAlignItems = "MIN";
    ctx.currentRowCards = [];
    ctx.cardsByRow.push(ctx.currentRowCards);
    for (let i = 0; i < rows[0].length; i++) {
      await osBuildCard(gridFrame, frames[rows[0][i]], tokens, plan, ctx, rows[0][i], profile);
    }
    return;
  }

  // Single column: all cards are direct children of Screens Grid (vertical).
  if (
    plan.strategy === "singleColumn" &&
    rows.length === 1 &&
    !plan.groups.length
  ) {
    gridFrame.layoutMode = "VERTICAL";
    gridFrame.itemSpacing = tokens.stripGapY;
    gridFrame.counterAxisAlignItems = "MIN";
    gridFrame.primaryAxisAlignItems = "MIN";
    ctx.currentRowCards = [];
    ctx.cardsByRow.push(ctx.currentRowCards);
    for (let i = 0; i < rows[0].length; i++) {
      await osBuildCard(gridFrame, frames[rows[0][i]], tokens, plan, ctx, rows[0][i], profile);
    }
    return;
  }

  gridFrame.layoutMode = "VERTICAL";
  gridFrame.itemSpacing = tokens.stripGapY;

  if (plan.groups.length) {
    for (let g = 0; g < plan.groups.length; g++) {
      await osBuildGroup(gridFrame, plan.groups[g], frames, tokens, plan, ctx, profile);
    }
    return;
  }

  for (let r = 0; r < rows.length; r++) {
    await osBuildRow(gridFrame, rows[r], r, frames, tokens, plan, ctx, profile);
  }
}

function osApplyCardWidthPolicy(plan, ctx) {
  if (plan.cardWidthPolicy === "hug") return;

  function setCardWidth(cards, w) {
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if ("layoutSizingHorizontal" in c) {
        try { c.layoutSizingHorizontal = "FIXED"; } catch (e) {}
      } else if ("counterAxisSizingMode" in c) {
        try { c.counterAxisSizingMode = "FIXED"; } catch (e) {}
      }
      try { c.resize(w, c.height); } catch (e) {}
    }
  }

  if (plan.cardWidthPolicy === "rowMax") {
    for (let i = 0; i < ctx.cardsByRow.length; i++) {
      const cards = ctx.cardsByRow[i];
      let maxW = 0;
      for (let j = 0; j < cards.length; j++) {
        maxW = Math.max(maxW, cards[j].width);
      }
      if (maxW > 0) setCardWidth(cards, maxW);
    }
  } else if (plan.cardWidthPolicy === "sectionMax") {
    const all = [];
    for (let i = 0; i < ctx.cardsByRow.length; i++) {
      for (let j = 0; j < ctx.cardsByRow[i].length; j++) {
        all.push(ctx.cardsByRow[i][j]);
      }
    }
    let maxW = 0;
    for (let k = 0; k < all.length; k++) {
      maxW = Math.max(maxW, all[k].width);
    }
    if (maxW > 0) setCardWidth(all, maxW);
  }
}

// Equalize the widths of one variant strip's cards (variant Screen Cards plus
// the Decision card) to the widest, so a comparison reads as a tidy row. Used
// by the pipeline's step 5 after reviews exist, mirroring osApplyCardWidthPolicy.
function osEqualizeStripCardWidths(cards) {
  if (!cards || !cards.length) return;
  let maxW = 0;
  for (let c = 0; c < cards.length; c++) {
    if (cards[c] && !cards[c].removed) maxW = Math.max(maxW, cards[c].width);
  }
  if (maxW <= 0) return;
  for (let c2 = 0; c2 < cards.length; c2++) {
    const card2 = cards[c2];
    if (!card2 || card2.removed) continue;
    if ("layoutSizingHorizontal" in card2) {
      try { card2.layoutSizingHorizontal = "FIXED"; } catch (e) {}
    } else if ("counterAxisSizingMode" in card2) {
      try { card2.counterAxisSizingMode = "FIXED"; } catch (e) {}
    }
    try { card2.resize(maxW, card2.height); } catch (e) {}
  }
}

// Pin each Design Review side-by-side card's Review Column to the fixed review
// width recorded at enqueue time. Runs in step 5 (after step 4 fills the
// columns) and before strip equalization so card widths include the review.
function osFinalizeDesignReviewColumns(ctx, tokens) {
  const pending = (ctx && ctx.pendingReviews) || [];
  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    if (!entry || !entry.fixedColumnWidth) continue;
    const col = entry.reviewCol;
    if (!col || col.removed) continue;
    try {
      col.layoutSizingHorizontal = "FIXED";
      col.resize(entry.fixedColumnWidth, col.height);
    } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// Build Section pipeline.
//
// A board is built through eight ordered steps that share one mutable
// `osBuildSectionCtx` (bsc). Compose runs steps 1-8; recompose runs its own
// preamble (extract state, teardown, move frames out) then joins at step 2.
//
//   1 Read Selection      — resolve profile/orientation/tokens/selection (in
//                           organizeScreensFromSelection / recompose preamble)
//   2 Prepare Section Shell— Section + Container + Overview Header + Screens Grid
//   3 Create Screen Cards  — composition plan, builder ctx, grid/strips (shells
//                           + custom variant Assessment + Decision columns)
//   4 Create Review Cards  — drain ctx.pendingReviews into each Review Column
//   5 Apply Auto Layout    — card width policy, strip + review column sizing
//   6 Create Flow          — optional Flow Overlay arrows
//   7 Write Metadata       — osWriteBoardMetadata
//   8 Final Positioning    — section x/y, resize, name, selection, viewport
//
// Runtime order keeps Auto Layout (5) before Flow (6): the overlay anchors to
// laid-out card positions, so widths must be final before arrows are drawn.
// ---------------------------------------------------------------------------

// Normalize a compose/recompose options bag into the shared pipeline context.
function osMakeBuildSectionCtx(opts) {
  return {
    mode: opts.mode || "compose",
    profile: opts.profile,
    orientation: opts.orientation,
    tokens: opts.tokens,
    annotations: opts.annotations,
    sectionTitle: opts.sectionTitle,
    sectionDescription: opts.sectionDescription,
    singletonFrames: opts.singletonFrames || opts.frames || [],
    variantGroups: opts.variantGroups || [],
    cardCopyOverrides: opts.cardCopyOverrides || null,
    reviewOverrides: opts.reviewOverrides || null,
    funcOverrides: opts.funcOverrides || null,
    annotationOverrides: opts.annotationOverrides || null,
    decisionOverrides: opts.decisionOverrides || null,
    // Functional Card mode ("basic" | "advanced"). Dynamic setting threaded from
    // the compose/recompose params; the static board-type profile is unaware of
    // it (mirrors how `flow` rides on opts, not the profile).
    functionalMode: opts.functionalMode === "advanced" ? "advanced" : "basic",
    flow: opts.flow === true,
    flowLabels: opts.flowLabels || [],
    flowFrameIds: Array.isArray(opts.flowFrameIds) ? opts.flowFrameIds : null,
    origin: opts.origin || null,
    section: opts.section || null,
    container: opts.container || null,
    header: null,
    gridFrame: null,
    plan: null,
    ctx: null,
    buildTokens: null,
    flowArrowCount: 0,
  };
}

// Step 2a (compose only) — Create the Section + Section Container. Position is
// deferred to step 8 (osBuildSection_finalPositioning); recompose reuses an
// existing section/container instead of calling this.
function osBuildSection_createSection(bsc) {
  const section = figma.createSection();
  section.name = bsc.sectionTitle;
  figma.currentPage.appendChild(section);

  const container = figma.createFrame();
  container.name = "Section Container";
  section.appendChild(container);
  container.x = 0;
  container.y = 0;

  bsc.section = section;
  bsc.container = container;
}

// Step 2 — Prepare Section Shell. Styles the container and builds the Overview
// Header (title + description) and an empty Screens Grid. `bsc.container` must
// already exist (compose: osBuildSection_createSection; recompose: existing).
async function osBuildSection_prepareSectionShell(bsc) {
  const container = bsc.container;
  const tokens = bsc.tokens;

  container.layoutMode = "VERTICAL";
  container.primaryAxisSizingMode = "AUTO";
  container.counterAxisSizingMode = "AUTO";
  container.paddingTop = tokens.sectionPadding;
  container.paddingBottom = tokens.sectionPadding;
  container.paddingLeft = tokens.sectionPadding;
  container.paddingRight = tokens.sectionPadding;
  container.itemSpacing = tokens.sectionContentGap;
  container.fills = [{ type: "SOLID", color: tokens.bgColor }];

  const header = figma.createFrame();
  header.name = "Overview Header";
  container.appendChild(header);
  header.layoutMode = "VERTICAL";
  header.primaryAxisSizingMode = "AUTO";
  header.counterAxisSizingMode = "AUTO";
  header.itemSpacing = tokens.headerGap;
  header.fills = [];
  // Header must fill the container's width so its FILL text children
  // have a definite width to resolve against. Container width is
  // driven by the gridFrame sibling (HUG), so this resolves to the
  // grid's width.
  if ("layoutSizingHorizontal" in header) {
    try { header.layoutSizingHorizontal = "FILL"; } catch (e) {}
  }

  const titleNode = await osCreateText(
    bsc.sectionTitle,
    tokens.titleFontSize,
    tokens.titleStyle,
    tokens.textColor
  );
  titleNode.name = "Section Title";
  header.appendChild(titleNode);
  osMakeTextFill(titleNode);

  const descNode = await osCreateText(
    bsc.sectionDescription,
    tokens.headerDescFontSize,
    tokens.headerDescStyle,
    tokens.mutedTextColor
  );
  descNode.name = "Section Description";
  header.appendChild(descNode);
  osApplySectionDescriptionWidth(descNode, tokens.sectionDescriptionMaxWidth);

  const gridFrame = figma.createFrame();
  gridFrame.name = "Screens Grid";
  container.appendChild(gridFrame);
  gridFrame.primaryAxisSizingMode = "AUTO";
  gridFrame.counterAxisSizingMode = "AUTO";
  gridFrame.fills = [];

  bsc.header = header;
  bsc.gridFrame = gridFrame;
}

// Step 3 — Create Screen Cards. Builds the composition plan and the builder
// `ctx`, then lays out variant strips and/or the singleton grid. Cards are
// built as shells; any Design Review Review Cards are enqueued on
// `ctx.pendingReviews` for step 4.
async function osBuildSection_createScreenCards(bsc) {
  const profile = bsc.profile;
  const tokens = bsc.tokens;
  const gridFrame = bsc.gridFrame;
  const variantGroups = bsc.variantGroups;
  const singletonFrames = bsc.singletonFrames;

  const plan = osCreateCompositionPlan(
    singletonFrames,
    profile,
    tokens,
    bsc.orientation
  );
  bsc.plan = plan;

  const ctx = {
    cardIds: [],
    cardNodes: [],
    cardsByRow: [],
    currentRowCards: [],
    annotations: bsc.annotations,
    heroCardId: null,
    copyOverrides: bsc.cardCopyOverrides,
    reviewOverrides: bsc.reviewOverrides,
    funcOverrides: bsc.funcOverrides,
    annotationOverrides: bsc.annotationOverrides,
    decisionOverrides: bsc.decisionOverrides,
    copyBaselineCards: [],
    variantGroupResults: [],
    // Step 3 enqueues, step 4 drains: { reviewCol, frame, reviewOverride,
    // reviewFrameworkId } per Design Review Screen Card.
    pendingReviews: [],
    // Step 3 enqueues, step 4b drains: { funcCol, frame, funcOverride } per
    // Functional Analysis Screen Card.
    pendingDocs: [],
    // Step 5 equalizes each variant strip's card widths.
    stripCardSets: [],
  };
  bsc.ctx = ctx;

  // With flow active, widen inter-card spacing so the arrows sit between
  // screens instead of overlapping them. Plan/columns are unchanged.
  const buildTokens = bsc.flow ? osFlowSpacingTokens(tokens) : tokens;
  bsc.buildTokens = buildTokens;

  if (variantGroups.length) {
    // Comparison strips lead the board; the singleton grid (if any) follows
    // in a nested frame so the existing grid builder owns its own layout
    // mode without fighting the strips' vertical stacking.
    gridFrame.layoutMode = "VERTICAL";
    gridFrame.itemSpacing = buildTokens.stripGapY;
    gridFrame.counterAxisAlignItems = "MIN";
    gridFrame.primaryAxisAlignItems = "MIN";
    for (let g = 0; g < variantGroups.length; g++) {
      await osBuildVariantStrip(
        gridFrame,
        variantGroups[g],
        buildTokens,
        plan,
        ctx,
        profile
      );
    }
    if (singletonFrames.length) {
      const singlesFrame = figma.createFrame();
      singlesFrame.name = "Screens";
      gridFrame.appendChild(singlesFrame);
      singlesFrame.primaryAxisSizingMode = "AUTO";
      singlesFrame.counterAxisSizingMode = "AUTO";
      singlesFrame.fills = [];
      if ("layoutSizingHorizontal" in singlesFrame) {
        try { singlesFrame.layoutSizingHorizontal = "FILL"; } catch (e) {}
      }
      await osBuildScreensGrid(
        singlesFrame,
        plan,
        buildTokens,
        singletonFrames,
        ctx,
        profile
      );
    }
  } else {
    await osBuildScreensGrid(
      gridFrame,
      plan,
      buildTokens,
      singletonFrames,
      ctx,
      profile
    );
  }
}

// Step 4 — Create Review Cards. Drains the per-card review queue enqueued in
// step 3, building each Design Review Review Card into its (empty) Review
// Column. The review framework captured at enqueue time wins, so comparative /
// standard cannot leak between variants. No-op for custom boards.
async function osBuildSection_createReviewCards(bsc) {
  const ctx = bsc.ctx;
  const pending = (ctx && ctx.pendingReviews) || [];
  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    if (!entry || !entry.reviewCol || entry.reviewCol.removed) continue;
    const framework = osResolveReviewFramework(entry.reviewFrameworkId);
    const prev = ctx.reviewFrameworkId;
    ctx.reviewFrameworkId = entry.reviewFrameworkId;
    await osBuildReviewCard(
      entry.reviewCol,
      entry.frame,
      bsc.tokens,
      bsc.profile.reviewCard,
      framework,
      entry.reviewOverride,
      ctx
    );
    ctx.reviewFrameworkId = prev;
  }
}

// Step 4b — Create Functional Cards. Drains the per-card functional queue
// enqueued in step 3, building each Functional Analysis Functional Card
// stacked full-width under the screen + description. No-op for non-functional
// boards (empty queue).
async function osBuildSection_createFunctionalCards(bsc) {
  const ctx = bsc.ctx;
  const pending = (ctx && ctx.pendingDocs) || [];
  if (!pending.length) return;
  // Merge the dynamic mode into the static profile cfg so the builder can
  // branch basic (8 fields) vs advanced (single doc) without the profile
  // carrying mode.
  const baseCfg = bsc.profile.functionalCard || {};
  const cfg = {};
  for (const k in baseCfg) {
    if (Object.prototype.hasOwnProperty.call(baseCfg, k)) cfg[k] = baseCfg[k];
  }
  cfg.mode = bsc.functionalMode === "advanced" ? "advanced" : "basic";
  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    if (!entry || !entry.funcCol || entry.funcCol.removed) continue;
    await osBuildFunctionalCard(
      entry.funcCol,
      entry.frame,
      bsc.tokens,
      cfg,
      entry.funcOverride,
      ctx
    );
  }
}

// Step 5 — Apply Auto Layout. Finalizes card widths once all content (screens
// + reviews) exists: section-wide card width policy, per-strip equalization,
// and Design Review screen/review column sizing.
function osBuildSection_applyAutoLayout(bsc) {
  const ctx = bsc.ctx;

  // Pin Review Column widths first so strip equalization measures full cards.
  osFinalizeDesignReviewColumns(ctx, bsc.tokens);

  const stripSets = (ctx && ctx.stripCardSets) || [];
  for (let i = 0; i < stripSets.length; i++) {
    osEqualizeStripCardWidths(stripSets[i]);
  }

  // Singleton grid card width policy (no-op for the "hug" baseline).
  osApplyCardWidthPolicy(bsc.plan, ctx);
}

// Step 6 — Create Flow Connections. Draws the Flow Overlay when flow is on.
// Uses base `tokens` (not the widened build tokens) for the overlay itself.
async function osBuildSection_createFlowConnections(bsc) {
  bsc.flowArrowCount = 0;
  if (bsc.flow) {
    bsc.flowArrowCount = await osBuildFlowOverlay(
      bsc.container,
      bsc.ctx,
      bsc.tokens,
      bsc.flowLabels || [],
      bsc.flowFrameIds || null
    );
  }
}

// Step 7 — Write Metadata. Persists the board envelope so recompose can replay
// copy, reviews, decisions, grouping, and flow.
function osBuildSection_writeMetadata(bsc) {
  osWriteBoardMetadata(bsc.container, {
    profile: bsc.profile,
    orientation: bsc.orientation,
    annotations: bsc.annotations,
    plan: bsc.plan,
    sectionTitle: bsc.sectionTitle,
    sectionDescription: bsc.sectionDescription,
    cards: bsc.ctx.copyBaselineCards,
    variantGroups: bsc.ctx.variantGroupResults,
    flow: bsc.flow,
    flowFrameIds: bsc.flowFrameIds,
    functionalMode: bsc.functionalMode,
  });
}

// Step 8 — Final Positioning. Places and sizes the section, selects it, and
// (compose only) pans the viewport to it.
function osBuildSection_finalPositioning(bsc) {
  const section = bsc.section;
  const container = bsc.container;

  if (bsc.mode === "compose" && bsc.origin) {
    try {
      section.x = bsc.origin.x;
      section.y = bsc.origin.y;
    } catch (e) {}
  }

  if (typeof section.resizeWithoutConstraints === "function") {
    section.resizeWithoutConstraints(container.width, container.height);
  } else if (typeof section.resize === "function") {
    section.resize(container.width, container.height);
  }

  if (bsc.mode === "recompose") {
    try { section.name = bsc.sectionTitle; } catch (e) {}
  }

  figma.currentPage.selection = [section];

  if (
    bsc.mode === "compose" &&
    figma.viewport &&
    typeof figma.viewport.scrollAndZoomIntoView === "function"
  ) {
    figma.viewport.scrollAndZoomIntoView([section, container]);
  }
}

// Run the interior steps (3-6) shared by compose and recompose. Steps 1-2
// (shell) and 7-8 (metadata, positioning) are invoked by the entry points so
// they can build the section / construct their distinct result payloads.
async function osRunBuildSectionPipeline(bsc) {
  await osBuildSection_createScreenCards(bsc);
  await osBuildSection_createReviewCards(bsc);
  await osBuildSection_createFunctionalCards(bsc);
  osBuildSection_applyAutoLayout(bsc);
  await osBuildSection_createFlowConnections(bsc);
  return {
    header: bsc.header,
    gridFrame: bsc.gridFrame,
    plan: bsc.plan,
    ctx: bsc.ctx,
    cardsForBaseline: bsc.ctx.copyBaselineCards,
    flowArrowCount: bsc.flowArrowCount || 0,
  };
}

// Build a Flow Overlay: an ABSOLUTE-positioned, transparent frame layered over
// the board that holds one-directional arrows between consecutive cards in
// reading order. Lives as a child of the Section Container so it moves and
// recomposes with the board. Returns the number of arrows drawn.
async function osBuildFlowOverlay(container, ctx, tokens, preservedLabels, scopeFrameIds) {
  let cards = (ctx.cardNodes || []).filter(function (n) {
    return n && !n.removed;
  });
  // Selective flow: when a scope of 2+ source-frame ids is present, connect
  // only those cards, in the scope's order. Map each live card to its embedded
  // source-frame id (the same stable key recompose uses). Fall back to the full
  // sequence if fewer than 2 scoped cards survive.
  if (Array.isArray(scopeFrameIds) && scopeFrameIds.length >= 2) {
    const byFrameId = {};
    for (let i = 0; i < cards.length; i++) {
      const ef = osCardEmbeddedFrame(cards[i]);
      if (ef && ef.id) byFrameId[ef.id] = cards[i];
    }
    const scoped = [];
    for (let i = 0; i < scopeFrameIds.length; i++) {
      const c = byFrameId[scopeFrameIds[i]];
      if (c) scoped.push(c);
    }
    if (scoped.length >= 2) cards = scoped;
  }
  if (cards.length < 2) return 0;
  const labels = Array.isArray(preservedLabels) ? preservedLabels : [];

  const overlay = figma.createFrame();
  overlay.name = "Flow Overlay";
  // Insert at the bottom of the z-order (index 0) rather than appending to the
  // top, so the full-board overlay renders behind the screen cards and never
  // intercepts clicks — the screens above stay directly selectable/editable.
  if (typeof container.insertChild === "function") {
    container.insertChild(0, overlay);
  } else {
    container.appendChild(overlay);
  }
  overlay.fills = [];
  overlay.clipsContent = false;
  // Escape the container's VERTICAL auto-layout so the overlay can be sized
  // and positioned freely on top of the laid-out content.
  if ("layoutPositioning" in overlay) {
    try {
      overlay.layoutPositioning = "ABSOLUTE";
    } catch (e) {}
  }
  try {
    overlay.resize(
      Math.max(1, container.width),
      Math.max(1, container.height)
    );
  } catch (e) {}
  overlay.x = 0;
  overlay.y = 0;
  try {
    overlay.setSharedPluginData(OS_METADATA_NAMESPACE, "osFlow", "1");
  } catch (e) {}

  const origin = osAbsOrigin(container);
  let count = 0;
  for (let i = 0; i < cards.length - 1; i++) {
    const a = cards[i];
    const b = cards[i + 1];
    if (!a || a.removed || !b || b.removed) continue;
    const ba = osAbsBox(a);
    const bb = osAbsBox(b);
    const la = {
      x: ba.x - origin.x,
      y: ba.y - origin.y,
      width: ba.width,
      height: ba.height,
    };
    const lb = {
      x: bb.x - origin.x,
      y: bb.y - origin.y,
      width: bb.width,
      height: bb.height,
    };
    const an = osArrowAnchors(la, lb, tokens.flowAnchorGap, tokens.flowArrowLength);
    if (overlay.removed) break;
    await osCreateFlowArrow(overlay, an.x1, an.y1, an.x2, an.y2, tokens);
    const labelText =
      typeof labels[count] === "string"
        ? labels[count]
        : tokens.flowLabelPlaceholder;
    await osCreateFlowLabel(
      overlay,
      (an.x1 + an.x2) / 2,
      (an.y1 + an.y2) / 2,
      labelText,
      tokens
    );
    count++;
    if (count % 8 === 0) {
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Metadata I/O (versioned envelope + legacy migration).
// ---------------------------------------------------------------------------

function osCoerceMetadata(raw) {
  if (typeof raw !== "string" || !raw.length) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  // Already in an envelope shape (any version). The presence of `settings`
  // distinguishes an envelope from the legacy flat shape. osNormalizeMetadata
  // backfills any fields a newer schema added (e.g. variantGroups) and stamps
  // the current schemaVersion, so older AND newer envelopes both migrate
  // transparently — a future schema bump never demotes a board to null/legacy.
  if (parsed.settings && typeof parsed.settings === "object") {
    return osNormalizeMetadata(parsed);
  }

  // Legacy v3 flat shape -> envelope.
  if (parsed.personality || parsed.engineVersion) {
    const annotationsObj = osParseLegacyAnnotationPolicy(parsed.annotationPolicy);
    const envelope = {
      schemaVersion: OS_METADATA_SCHEMA_VERSION,
      engineVersion:
        typeof parsed.engineVersion === "number"
          ? parsed.engineVersion
          : OS_ENGINE_VERSION,
      composedAt: 0,
      settings: {
        // Legacy flat metadata predates Board Types and carries an old
        // personality id; collapse to the `custom` baseline (osNormalizeMetadata
        // also enforces it via the boardType fallback).
        boardType: "custom",
        orientation:
          typeof parsed.orientation === "string"
            ? parsed.orientation
            : "passthrough",
        annotations: annotationsObj,
      },
      layout: {
        strategy:
          typeof parsed.strategy === "string" ? parsed.strategy : "compactGrid",
        columns: typeof parsed.columns === "number" ? parsed.columns : 1,
        screenCount:
          typeof parsed.screenCount === "number" ? parsed.screenCount : 0,
        maxFrameWidth:
          typeof parsed.maxFrameWidth === "number" ? parsed.maxFrameWidth : 0,
      },
    };
    return osNormalizeMetadata(envelope);
  }

  return null;
}

function osParseLegacyAnnotationPolicy(value) {
  if (typeof value !== "string" || !value.length || value === "none") {
    return { enabled: false, mode: "compact", position: "belowDescription" };
  }
  const parts = value.split(":");
  const mode = parts[0] === "expanded" ? "expanded" : "compact";
  const position =
    parts[1] === "aboveScreen" ? "aboveScreen" : "belowDescription";
  return { enabled: true, mode: mode, position: position };
}

// Coerce the stored review-surface settings. When absent, the defaults follow
// the board type (design-review => enabled), so older boards without the field
// migrate transparently.
function osNormalizeReviewSettings(rv, boardTypeId) {
  const isReview = boardTypeId === "design-review";
  const validKeys = { workingWell: 1, questions: 1, concerns: 1, ideas: 1 };
  let sections = ["workingWell", "questions", "concerns", "ideas"];
  if (rv && Array.isArray(rv.sections)) {
    const filtered = rv.sections.filter(function (k) {
      return validKeys[k] === 1;
    });
    if (filtered.length) sections = filtered;
  }
  return {
    enabled: rv && typeof rv.enabled === "boolean" ? rv.enabled : isReview,
    status: rv && typeof rv.status === "boolean" ? rv.status : true,
    sections: sections,
    notes: rv && typeof rv.notes === "boolean" ? rv.notes : true,
  };
}

function osNormalizeMetadata(env) {
  // Defensive coercion of stored fields; never throw on partial data.
  const s = env.settings || {};
  const ann = s.annotations || {};
  const layout = env.layout || {};
  const allowedOrientations = {
    passthrough: 1,
    row: 1,
    column: 1,
    grid: 1,
  };
  let boardType =
    s.boardType === "design-review" || s.personality === "design-review"
      ? "design-review"
      : s.boardType === "functional-analysis" ||
        s.personality === "functional-analysis"
      ? "functional-analysis"
      : "custom";
  let review = osNormalizeReviewSettings(
    s.review,
    s.boardType || s.personality
  );
  if (boardType === "custom" && review.enabled === true) {
    boardType = "design-review";
    review = osNormalizeReviewSettings(s.review, boardType);
  }
  return {
    schemaVersion: OS_METADATA_SCHEMA_VERSION,
    engineVersion:
      typeof env.engineVersion === "number"
        ? env.engineVersion
        : OS_ENGINE_VERSION,
    composedAt:
      typeof env.composedAt === "number" ? env.composedAt : 0,
    settings: {
      boardType: boardType,
      orientation: allowedOrientations[s.orientation]
        ? s.orientation
        : "passthrough",
      annotations: {
        enabled: ann.enabled === true,
        mode: ann.mode === "expanded" ? "expanded" : "compact",
        position:
          ann.position === "aboveScreen" ? "aboveScreen" : "belowDescription",
      },
      flow: s.flow === true,
      flowFrameIds:
        Array.isArray(s.flowFrameIds) && s.flowFrameIds.length
          ? s.flowFrameIds.map(String)
          : null,
      review: review,
      functional: osNormalizeFunctionalSettings(s.functional, boardType),
    },
    layout: {
      strategy:
        typeof layout.strategy === "string" ? layout.strategy : "compactGrid",
      columns: typeof layout.columns === "number" ? layout.columns : 1,
      screenCount:
        typeof layout.screenCount === "number" ? layout.screenCount : 0,
      maxFrameWidth:
        typeof layout.maxFrameWidth === "number" ? layout.maxFrameWidth : 0,
    },
    copyBaseline:
      env.copyBaseline && typeof env.copyBaseline === "object"
        ? {
            sectionTitle:
              typeof env.copyBaseline.sectionTitle === "string"
                ? env.copyBaseline.sectionTitle
                : "",
            sectionDescription:
              typeof env.copyBaseline.sectionDescription === "string"
                ? env.copyBaseline.sectionDescription
                : "",
            cards: Array.isArray(env.copyBaseline.cards)
              ? env.copyBaseline.cards
                  .filter(function (c) {
                    return c && typeof c === "object";
                  })
                  .map(function (c) {
                    const entry = {
                      frameId: typeof c.frameId === "string" ? c.frameId : "",
                      title: typeof c.title === "string" ? c.title : "",
                      description:
                        typeof c.description === "string" ? c.description : "",
                    };
                    if (c.annotation && typeof c.annotation === "object") {
                      entry.annotation = {
                        text:
                          typeof c.annotation.text === "string"
                            ? c.annotation.text
                            : "",
                        position:
                          c.annotation.position === "aboveScreen"
                            ? "aboveScreen"
                            : "belowDescription",
                        mode:
                          c.annotation.mode === "expanded"
                            ? "expanded"
                            : "compact",
                      };
                    }
                    // Preserve the functional documentation baseline (string
                    // values keyed by known section keys) even on non-functional
                    // board types, so a Functional -> Custom -> Functional round
                    // trip restores the generated/edited text (mirrors how the
                    // annotation note is preserved above).
                    if (c.doc && typeof c.doc === "object") {
                      const doc = {};
                      for (let di = 0; di < OS_FUNCTIONAL_SECTION_KEYS.length; di++) {
                        const dk = OS_FUNCTIONAL_SECTION_KEYS[di];
                        if (typeof c.doc[dk] === "string") doc[dk] = c.doc[dk];
                      }
                      // Also preserve the Advanced single-document field so an
                      // Advanced doc survives a Functional -> Custom -> Functional
                      // round trip within the same mode.
                      if (typeof c.doc[OS_FUNCTIONAL_DOC_KEY] === "string") {
                        doc[OS_FUNCTIONAL_DOC_KEY] = c.doc[OS_FUNCTIONAL_DOC_KEY];
                      }
                      if (Object.keys(doc).length) entry.doc = doc;
                    }
                    return entry;
                  })
              : [],
          }
        : null,
    variantGroups: Array.isArray(env.variantGroups)
      ? env.variantGroups
          .filter(function (g) {
            return g && typeof g === "object";
          })
          .map(function (g) {
            return {
              key: typeof g.key === "string" ? g.key : "",
              label: typeof g.label === "string" ? g.label : "",
              variantLabels: Array.isArray(g.variantLabels)
                ? g.variantLabels.map(String)
                : [],
              sourceFrameIds: Array.isArray(g.sourceFrameIds)
                ? g.sourceFrameIds.map(String)
                : [],
              cardIds: Array.isArray(g.cardIds) ? g.cardIds.map(String) : [],
              source:
                g.source === "marked-parent" ||
                g.source === "naming" ||
                g.source === "component"
                  ? g.source
                  : "naming",
            };
          })
      : [],
  };
}

function osReadBoardMetadata(container) {
  if (
    !container ||
    typeof container.getSharedPluginData !== "function"
  ) {
    return null;
  }
  try {
    const raw = container.getSharedPluginData(
      OS_METADATA_NAMESPACE,
      OS_METADATA_KEY
    );
    return osCoerceMetadata(raw);
  } catch (e) {
    return null;
  }
}

// Read the tiny positive modern-board marker, if present. Returns a known
// board-type id ("custom" / "design-review") or null. This is the explicit
// signal that a board is modern even when the full envelope failed to persist.
function osReadBoardTypeMarker(container) {
  if (!container || typeof container.getSharedPluginData !== "function") {
    return null;
  }
  try {
    const raw = container.getSharedPluginData(
      OS_METADATA_NAMESPACE,
      OS_BOARDTYPE_KEY
    );
    if (
      raw === "custom" ||
      raw === "design-review" ||
      raw === "functional-analysis"
    ) {
      return raw;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function osWriteBoardMetadata(container, info) {
  if (
    !container ||
    typeof container.setSharedPluginData !== "function"
  ) {
    return;
  }
  const profile = info.profile;
  const orientation = info.orientation;
  const annotations = info.annotations;
  const plan = info.plan;
  const envelope = {
    schemaVersion: OS_METADATA_SCHEMA_VERSION,
    engineVersion: OS_ENGINE_VERSION,
    composedAt: Date.now(),
    settings: {
      boardType: profile.id,
      orientation: orientation.id,
      annotations: {
        // Persist the user's INTENT (not the capability-gated render value), so
        // a Custom -> Design Review -> Custom round trip restores annotations
        // the user had turned on but were merely hidden on the incapable type.
        enabled:
          (typeof annotations.intendedEnabled === "boolean"
            ? annotations.intendedEnabled
            : annotations.enabled) === true,
        mode: annotations.mode === "expanded" ? "expanded" : "compact",
        position:
          annotations.position === "aboveScreen"
            ? "aboveScreen"
            : "belowDescription",
      },
      flow: info.flow === true,
      // Scoped-flow subset (ordered embedded source-frame ids), or null for a
      // whole-board overlay. Lives in `settings` so it survives envelope
      // trimming (which drops copyBaseline / variantGroups first).
      flowFrameIds:
        Array.isArray(info.flowFrameIds) && info.flowFrameIds.length
          ? info.flowFrameIds.slice()
          : null,
      review: profile.reviewCard
        ? {
            enabled: profile.reviewCard.enabled === true,
            status: profile.reviewCard.status === true,
            sections: profile.reviewCard.sections.slice(),
            notes: profile.reviewCard.notes === true,
          }
        : { enabled: false, status: true, sections: [], notes: true },
      // Functional mode is a dynamic setting (not part of the static board-type
      // profile), threaded in via info.functionalMode. Persisted regardless of
      // board type so a Functional -> Custom -> Functional round trip restores it.
      functional: osNormalizeFunctionalSettings(
        { mode: info.functionalMode },
        profile.id
      ),
    },
    layout: {
      strategy: plan.strategy,
      columns: plan.columns,
      screenCount: plan.screenCount,
      maxFrameWidth: plan.maxFrameWidth,
    },
    copyBaseline: {
      sectionTitle:
        typeof info.sectionTitle === "string" ? info.sectionTitle : "",
      sectionDescription:
        typeof info.sectionDescription === "string"
          ? info.sectionDescription
          : "",
      cards: Array.isArray(info.cards) ? info.cards.slice() : [],
    },
    variantGroups: Array.isArray(info.variantGroups)
      ? info.variantGroups.map(function (g) {
          return {
            key: typeof g.key === "string" ? g.key : "",
            label: typeof g.label === "string" ? g.label : "",
            variantLabels: Array.isArray(g.variantLabels)
              ? g.variantLabels.slice()
              : [],
            sourceFrameIds: Array.isArray(g.sourceFrameIds)
              ? g.sourceFrameIds.slice()
              : [],
            cardIds: Array.isArray(g.cardIds) ? g.cardIds.slice() : [],
            source: typeof g.source === "string" ? g.source : "naming",
          };
        })
      : [],
  };
  // Always write the tiny boardType marker first. It is far below the 100 kB
  // per-entry limit, so it persists even when the full envelope cannot, and is
  // the positive signal that this is a modern board.
  try {
    container.setSharedPluginData(
      OS_METADATA_NAMESPACE,
      OS_BOARDTYPE_KEY,
      profile.id
    );
  } catch (e) {
    console.warn(
      "[organize-screens] failed to write boardType marker:",
      e && e.message ? e.message : e
    );
  }
  osPersistBoardEnvelope(container, envelope);
}

// Shallow envelope copy with the large copy baseline dropped (keeps the section
// title/description, which are small, but clears per-card copy).
function osTrimEnvelopeCopy(env) {
  const copy = {};
  for (const k in env) {
    if (Object.prototype.hasOwnProperty.call(env, k)) copy[k] = env[k];
  }
  const base = env.copyBaseline || {};
  copy.copyBaseline = {
    sectionTitle: typeof base.sectionTitle === "string" ? base.sectionTitle : "",
    sectionDescription:
      typeof base.sectionDescription === "string" ? base.sectionDescription : "",
    cards: [],
  };
  return copy;
}

// Further-trimmed envelope: also drops variant groups. The result is just the
// core (settings + layout), which always drives classification and labelling.
function osTrimEnvelopeAll(env) {
  const copy = osTrimEnvelopeCopy(env);
  copy.variantGroups = [];
  return copy;
}

// Persist the envelope under OS_METADATA_KEY, degrading gracefully if it would
// exceed Figma's 100 kB per-entry shared-plugin-data limit. Each attempt is
// smaller than the last; only the core (settings + layout) is essential for
// classification, so even the smallest attempt keeps the board recognized as
// modern. Errors are surfaced via console.warn, never swallowed silently.
function osPersistBoardEnvelope(container, envelope) {
  const attempts = [envelope, osTrimEnvelopeCopy(envelope), osTrimEnvelopeAll(envelope)];
  for (let i = 0; i < attempts.length; i++) {
    try {
      container.setSharedPluginData(
        OS_METADATA_NAMESPACE,
        OS_METADATA_KEY,
        JSON.stringify(attempts[i])
      );
      if (i > 0) {
        console.warn(
          "[organize-screens] board metadata exceeded the 100 kB limit; persisted a trimmed envelope (edited-copy preservation on recompose is reduced for this board)."
        );
      }
      return;
    } catch (e) {
      if (i === attempts.length - 1) {
        console.warn(
          "[organize-screens] failed to persist board metadata:",
          e && e.message ? e.message : e
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Board recognition + extraction.
// ---------------------------------------------------------------------------

function osFindContainerInSection(section) {
  if (!section || section.type !== "SECTION" || !("children" in section)) {
    return null;
  }
  for (const child of section.children) {
    if (child.type === "FRAME" && child.name === "Section Container") {
      return child;
    }
  }
  return null;
}

function osFindBoardRoot(node) {
  if (!node) return null;
  // Selected node may be: the SECTION, its Section Container, a Screen Card,
  // an embedded screen FRAME, or an inner text node. Walk up looking for the
  // owning SECTION whose direct child frame is named "Section Container".
  let cursor = node;
  let safety = 0;
  while (cursor && safety < 24) {
    if (cursor.type === "SECTION") {
      const container = osFindContainerInSection(cursor);
      if (container) return { section: cursor, container: container };
    }
    if (cursor.type === "FRAME" && cursor.name === "Section Container") {
      const parent = cursor.parent;
      if (parent && parent.type === "SECTION") {
        return { section: parent, container: cursor };
      }
    }
    cursor = cursor.parent || null;
    safety += 1;
  }
  return null;
}

function osStructuralBoardMatch(section, container) {
  if (!section || !container) return false;
  if (section.type !== "SECTION") return false;
  if (container.type !== "FRAME" || container.name !== "Section Container") {
    return false;
  }
  if (!("children" in container)) return false;
  let header = null;
  let grid = null;
  for (const c of container.children) {
    if (c.name === "Overview Header") header = c;
    if (c.name === "Screens Grid") grid = c;
  }
  if (!header || !grid) return false;
  // Header + grid are enough to recognize a plugin board shell. Requiring at
  // least one Screen Card made section-only selection flaky (empty grid moment,
  // or a probe that ran before cards finished mounting).
  return true;
}

function osCollectCardsInGrid(node) {
  const out = [];
  function walk(n) {
    if (!n) return;
    if (n.type === "FRAME" && typeof n.name === "string") {
      if (n.name.indexOf("Screen Card / ") === 0) {
        out.push(n);
        return; // do not descend into cards (their screen frame is a leaf for us)
      }
    }
    if ("children" in n && Array.isArray(n.children)) {
      for (const child of n.children) walk(child);
    }
  }
  walk(node);
  return out;
}

function osFindNamedTextChild(parent, name) {
  if (!parent || !("children" in parent)) return null;
  for (const c of parent.children) {
    if (c.type === "TEXT" && c.name === name) return c;
  }
  return null;
}

function osFindHeader(container) {
  if (!container || !("children" in container)) return null;
  for (const c of container.children) {
    if (c.name === "Overview Header") return c;
  }
  return null;
}

function osFindGrid(container) {
  if (!container || !("children" in container)) return null;
  for (const c of container.children) {
    if (c.name === "Screens Grid") return c;
  }
  return null;
}

function osIsCardLayoutWrapperName(name) {
  if (!name || typeof name !== "string") return false;
  if (
    name === "Card Body" ||
    name === "Screen Column" ||
    name === "Review Column" ||
    name === "Review Card" ||
    name === "Review Content" ||
    name === "Review Header" ||
    name === "Annotation Slot" ||
    name === "Assessment" ||
    name === "Review Field"
  ) {
    return true;
  }
  return name.indexOf("Review Section /") === 0;
}

function osCardEmbeddedFrame(card) {
  if (!card || !("children" in card)) return null;
  const stack = [];
  for (let i = 0; i < card.children.length; i++) stack.push(card.children[i]);
  while (stack.length) {
    const n = stack.pop();
    // The Functional Card is a direct sibling of the embedded screen with a
    // non-wrapper name, so without this guard it is popped first and returned
    // as the "embedded frame" — which made Create Documentation export the
    // empty analysis scaffold instead of the screen. Skip it WITHOUT descending
    // (its interior "Functional Section / …" frames are non-wrapper frames that
    // would otherwise be mistaken for the screen). The Review Card is already an
    // osIsCardLayoutWrapperName wrapper whose interior is all wrapper-named, so
    // the existing descend handles it; this guard only adds the functional case.
    if (n.type === "FRAME" && n.name === "Functional Card") continue;
    if ("children" in n) {
      for (let i = 0; i < n.children.length; i++) stack.push(n.children[i]);
    }
    if (n.type !== "FRAME") continue;
    if (osIsCardLayoutWrapperName(n.name)) continue;
    return n;
  }
  return null;
}

// Find the Review Card frame inside a Screen Card (design-review boards).
function osCardReviewCard(card) {
  if (!card || !("children" in card)) return null;
  const stack = [];
  for (let i = 0; i < card.children.length; i++) stack.push(card.children[i]);
  while (stack.length) {
    const n = stack.pop();
    if (n.type === "FRAME" && n.name === "Review Card") return n;
    if ("children" in n) {
      for (let i = 0; i < n.children.length; i++) stack.push(n.children[i]);
    }
  }
  return null;
}

// Read every tagged review field's verbatim text into a { fieldKey: text } map
// so recompose can replay reviewer feedback. Returns null when the card has no
// Review Card. Placeholder text is preserved verbatim and re-detected as empty
// on rebuild, so this stays idempotent for untouched fields.
function osExtractReviewFields(card) {
  return osExtractReviewFieldsFromReviewCard(osCardReviewCard(card));
}

// Same extraction, but from an already-resolved Review Card node. The probe's
// single-pass card index reuses this so it does not re-walk the card to find
// the Review Card it already located.
function osExtractReviewFieldsFromReviewCard(rc) {
  if (!rc) return null;
  const out = {};
  let found = false;
  const stack = [rc];
  while (stack.length) {
    const node = stack.pop();
    let key = "";
    try {
      key = node.getSharedPluginData(OS_REVIEW_NAMESPACE, OS_REVIEW_FIELD_KEY);
    } catch (e) {}
    if (key && node.type === "TEXT") {
      // Editable fields (and legacy text status) store verbatim text.
      out[key] = typeof node.characters === "string" ? node.characters : "";
      found = true;
    } else if (key === OS_REVIEW_STATUS.key && node.type === "INSTANCE") {
      // New boards model status as a component instance; read its variant.
      const variant = osReadInstanceStatus(node);
      if (variant) {
        out[key] = variant;
        found = true;
      }
    }
    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }
  return found ? out : null;
}

// Find the Functional Card frame inside a Screen Card (functional-analysis
// boards). Mirrors osCardReviewCard.
function osCardFunctionalCard(card) {
  if (!card || !("children" in card)) return null;
  const stack = [];
  for (let i = 0; i < card.children.length; i++) stack.push(card.children[i]);
  while (stack.length) {
    const n = stack.pop();
    if (n.type === "FRAME" && n.name === "Functional Card") return n;
    if ("children" in n) {
      for (let i = 0; i < n.children.length; i++) stack.push(n.children[i]);
    }
  }
  return null;
}

// Read every tagged functional field's verbatim text into a { sectionKey: text }
// map so recompose / board-type switches can replay documentation. Returns null
// when the card has no Functional Card. Placeholder text is preserved verbatim
// and re-detected as empty on rebuild, so this stays idempotent. Mirrors
// osExtractReviewFields.
function osExtractFuncFields(card) {
  const fc = osCardFunctionalCard(card);
  if (!fc) return null;
  const out = {};
  let found = false;
  const stack = [fc];
  while (stack.length) {
    const node = stack.pop();
    let key = "";
    try {
      key = node.getSharedPluginData(OS_REVIEW_NAMESPACE, OS_FUNC_FIELD_KEY);
    } catch (e) {}
    if (key && node.type === "TEXT") {
      out[key] = typeof node.characters === "string" ? node.characters : "";
      found = true;
    }
    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }
  return found ? out : null;
}

// Single bounded walk of one Screen Card that records the structural frames the
// section resolvers need: the embedded screen frame, the Review Card, the
// Functional Card, and the Card Title text. The key perf property is that it
// treats the embedded user screen as a LEAF (records it, never descends), so a
// card with a huge embedded design costs O(card layout) instead of O(embedded
// design). Child push order mirrors osCardEmbeddedFrame/osCardReviewCard (push
// 0..n, pop LIFO) so "first match" resolves to the same nodes those helpers
// would return. Used only by the probe's read path; the apply path keeps
// calling the standalone helpers.
function osBuildProbeCardEntry(card) {
  const entry = {
    card: card,
    embeddedFrame: null,
    reviewCard: null,
    functionalCard: null,
    cardTitle: null,
  };
  if (!card || !("children" in card)) return entry;
  const stack = [];
  for (let i = 0; i < card.children.length; i++) stack.push(card.children[i]);
  while (stack.length) {
    const n = stack.pop();
    if (n.type === "TEXT") {
      if (!entry.cardTitle && n.name === "Card Title") entry.cardTitle = n;
      continue;
    }
    if (n.type === "FRAME") {
      if (n.name === "Review Card") {
        if (!entry.reviewCard) entry.reviewCard = n;
        continue; // fields read separately from this node; do not descend
      }
      if (n.name === "Functional Card") {
        if (!entry.functionalCard) entry.functionalCard = n;
        continue;
      }
      if (!osIsCardLayoutWrapperName(n.name)) {
        // First non-wrapper, non-card frame = embedded user screen. Record it
        // once and STOP — never descend into the user's design subtree.
        if (!entry.embeddedFrame) entry.embeddedFrame = n;
        continue;
      }
      // Layout wrapper (Card Body / Screen Column / Review Column / ...): descend.
    }
    if ("children" in n) {
      for (let i = 0; i < n.children.length; i++) stack.push(n.children[i]);
    }
  }
  return entry;
}

// Display name from a prebuilt entry (mirrors osCardDisplayName). Card Title is
// a direct child of the card, so the bounded walk always captures it.
function osEntryDisplayName(entry) {
  const t = entry && entry.cardTitle;
  if (t && typeof t.characters === "string" && t.characters.trim()) {
    return t.characters.trim();
  }
  const card = entry && entry.card;
  if (card && typeof card.name === "string") {
    return card.name.replace("Screen Card / ", "");
  }
  return "Screen";
}

// Build one shared index for every card on a board in a single bounded pass.
// Reused by the section resolvers (via an optional arg) so a 10-card board is
// walked once instead of ~4 unbounded subtree walks per card. Probe-only.
function osBuildProbeCardIndex(container) {
  const grid = osFindGrid(container);
  const cards = osCollectCardsInGrid(grid || container);
  const byId = {};
  const entries = [];
  let hasReviewSurface = false;
  let hasFunctionalSurface = false;
  for (let i = 0; i < cards.length; i++) {
    const entry = osBuildProbeCardEntry(cards[i]);
    entries.push(entry);
    if (cards[i] && cards[i].id) byId[cards[i].id] = entry;
    if (entry.reviewCard) hasReviewSurface = true;
    if (entry.functionalCard) hasFunctionalSurface = true;
  }
  return {
    container: container,
    grid: grid,
    cards: cards,
    entries: entries,
    byId: byId,
    hasReviewSurface: hasReviewSurface,
    hasFunctionalSurface: hasFunctionalSurface,
  };
}

// Find a card's Annotation Slot. Custom cards keep it as a direct child;
// Design Review cards nest it under Card Body -> Screen Column, so walk those
// wrappers (mirrors osCardEmbeddedFrame's traversal). The Review Column is
// skipped so a (future) note inside a review never masquerades as the slot.
function osCardAnnotationSlot(card) {
  if (!card || !("children" in card)) return null;
  const stack = [card];
  while (stack.length) {
    const node = stack.pop();
    if (!("children" in node)) continue;
    for (const c of node.children) {
      if (c.type === "FRAME" && c.name === "Annotation Slot") return c;
      if (
        c.type === "FRAME" &&
        (c.name === "Card Body" || c.name === "Screen Column")
      ) {
        stack.push(c);
      }
    }
  }
  return null;
}

// Read the preserved note for a card: text from the tagged Annotation Hint
// (name fallback for legacy untagged nodes) plus its resolved position + mode.
// Returns { text, position, mode } | null when the card has no slot.
function osExtractAnnotationText(card) {
  const slot = osCardAnnotationSlot(card);
  if (!slot || slot.removed) return null;

  let hint = null;
  const stack = [slot];
  while (stack.length) {
    const node = stack.pop();
    let tagged = false;
    try {
      tagged = !!node.getSharedPluginData(
        OS_REVIEW_NAMESPACE,
        OS_ANNOTATION_FIELD_KEY
      );
    } catch (e) {}
    if (node.type === "TEXT" && (tagged || node.name === "Annotation Hint")) {
      hint = node;
      break;
    }
    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }

  const text =
    hint && typeof hint.characters === "string" ? hint.characters : "";

  // Position: above the embedded frame -> aboveScreen, else belowDescription.
  // The slot and the frame share a parent (Screen Column in Design Review, the
  // card itself in Custom), so a sibling index comparison is reliable.
  let position = "belowDescription";
  const parent = slot.parent;
  const frame = osCardEmbeddedFrame(card);
  if (parent && "children" in parent && frame) {
    const si = parent.children.indexOf(slot);
    const fi = parent.children.indexOf(frame);
    if (si >= 0 && fi >= 0) {
      position = si < fi ? "aboveScreen" : "belowDescription";
    }
  }

  const mode = slot.height >= OS_ANNOTATION_EXPANDED_MIN ? "expanded" : "compact";

  return { text: text, position: position, mode: mode };
}

function osCardAssessmentSlot(card) {
  if (!card || !("children" in card)) return null;
  for (const c of card.children) {
    if (c.type === "FRAME" && c.name === "Assessment") return c;
  }
  return null;
}

// Read the Annotation Hint text inside a named Assessment column ("Pros" /
// "Cons"). Returns "" when the column or hint is missing.
function osExtractAssessmentColumnText(assessment, columnName) {
  if (!assessment || !("children" in assessment)) return "";
  for (const col of assessment.children) {
    if (col.type !== "FRAME" || col.name !== columnName) continue;
    if (!("children" in col)) return "";
    for (const inner of col.children) {
      if (inner.type === "FRAME" && inner.name === "Content") {
        for (const t of inner.children) {
          if (t.type === "TEXT" && t.name === "Annotation Hint") {
            return typeof t.characters === "string" ? t.characters : "";
          }
        }
      }
    }
  }
  return "";
}

function osExtractCardCopy(card) {
  const titleNode = osFindNamedTextChild(card, "Card Title");
  const descNode = osFindNamedTextChild(card, "Card Description");
  const assessment = osCardAssessmentSlot(card);
  return {
    title: titleNode && typeof titleNode.characters === "string"
      ? titleNode.characters
      : "",
    description: descNode && typeof descNode.characters === "string"
      ? descNode.characters
      : "",
    pros: osExtractAssessmentColumnText(assessment, "Pros"),
    cons: osExtractAssessmentColumnText(assessment, "Cons"),
  };
}

// Walk every Variant Strip's Decision card and return { groupKey: { fieldKey:
// text } } so recompose can replay cross-option decisions. The Decision card is
// a sibling of the Screen Cards (not collected by osCollectCardsInGrid), so its
// fields are owned solely here. Returns null when no Decision card is present.
function osExtractDecisionCards(container) {
  const grid = osFindGrid(container);
  if (!grid) return null;
  const out = {};
  let found = false;
  const stack = [grid];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === "FRAME" && node.name === "Decision Card") {
      let groupKey = "";
      try {
        groupKey = node.getSharedPluginData(
          OS_REVIEW_NAMESPACE,
          OS_DECISION_CARD.cardKey
        );
      } catch (e) {}
      const fields = {};
      const fstack = [node];
      while (fstack.length) {
        const fn = fstack.pop();
        let key = "";
        try {
          key = fn.getSharedPluginData(OS_REVIEW_NAMESPACE, OS_REVIEW_FIELD_KEY);
        } catch (e) {}
        if (key && fn.type === "TEXT") {
          fields[key] = typeof fn.characters === "string" ? fn.characters : "";
        }
        if ("children" in fn) {
          for (let i = 0; i < fn.children.length; i++) fstack.push(fn.children[i]);
        }
      }
      if (groupKey) {
        out[groupKey] = fields;
        found = true;
      }
      continue; // already walked this card's subtree
    }
    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }
  return found ? out : null;
}

// Shared capture path: read a card's annotation note before any node is torn
// down (full recompose) or removed (annotations-only disable). Both lifecycle
// paths call this so the preservation guarantee cannot be forgotten in one.
function osCaptureAnnotation(card) {
  return osExtractAnnotationText(card);
}

function osExtractBoardState(section) {
  const container = osFindContainerInSection(section);
  if (!container) return null;
  const header = osFindHeader(container);
  const grid = osFindGrid(container);
  if (!header || !grid) return null;

  const titleNode = osFindNamedTextChild(header, "Section Title");
  const descNode = osFindNamedTextChild(header, "Section Description");
  const cards = osCollectCardsInGrid(grid);

  const cardEntries = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const frame = osCardEmbeddedFrame(card);
    const copy = osExtractCardCopy(card);
    cardEntries.push({
      card: card,
      frame: frame,
      slot: osCardAnnotationSlot(card),
      annotation: osCaptureAnnotation(card),
      title: copy.title,
      description: copy.description,
      pros: copy.pros,
      cons: copy.cons,
      review: osExtractReviewFields(card),
      doc: osExtractFuncFields(card),
    });
  }

  return {
    section: section,
    container: container,
    header: header,
    grid: grid,
    sectionTitle:
      titleNode && typeof titleNode.characters === "string"
        ? titleNode.characters
        : section.name || "",
    sectionDescription:
      descNode && typeof descNode.characters === "string"
        ? descNode.characters
        : "",
    cards: cardEntries,
    decisions: osExtractDecisionCards(container),
  };
}

// ---------------------------------------------------------------------------
// Settings delta classification.
// ---------------------------------------------------------------------------

// Order-sensitive array equality for scoped-flow frame-id lists. A null/absent
// list and an empty list both mean "whole board", so they compare equal.
function osFlowFrameIdsEqual(a, b) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

function osClassifySettingsDelta(prev, next) {
  if (!prev || !next) return "layout";
  const a = prev.settings || prev;
  const b = next.settings || next;
  if ((a.boardType || a.personality) !== (b.boardType || b.personality)) {
    return "layout";
  }
  if (a.orientation !== b.orientation) return "layout";
  // A functional mode switch (Basic <-> Advanced) rebuilds the Functional Card
  // structure, so it is a layout change. Missing functional settings default to
  // "basic" so older boards compare equal.
  {
    const aMode =
      a.functional && a.functional.mode === "advanced" ? "advanced" : "basic";
    const bMode =
      b.functional && b.functional.mode === "advanced" ? "advanced" : "basic";
    if (aMode !== bMode) return "layout";
  }
  if ((a.flow === true) !== (b.flow === true)) return "layout";
  // A change to the scoped-flow subset (or its order) requires rebuilding the
  // overlay; an identical "keep" leaves it for the annotation/none paths.
  if (!osFlowFrameIdsEqual(a.flowFrameIds, b.flowFrameIds)) return "layout";
  const aAnn = a.annotations || {};
  const bAnn = b.annotations || {};
  const annDelta =
    aAnn.enabled !== bAnn.enabled ||
    aAnn.mode !== bAnn.mode ||
    aAnn.position !== bAnn.position;
  if (annDelta) return "annotationsOnly";
  return "none";
}

// ---------------------------------------------------------------------------
// In-place annotation patch.
// ---------------------------------------------------------------------------

// Returns capturedByFrameId (frameId -> { text, position, mode }) so the caller
// can persist the preserved note into metadata. `preservedByFrameId` seeds the
// rebuild path so re-enabling annotations restores previously captured text.
async function osPatchBoardAnnotations(
  state,
  profile,
  orientation,
  annotations,
  tokens,
  preservedByFrameId
) {
  // Load fonts for the annotation hint text.
  await figma.loadFontAsync({
    family: tokens.fontFamily,
    style: tokens.annotationStyle,
  });
  void orientation;

  const preserved = preservedByFrameId || {};
  const capturedByFrameId = {};

  for (let i = 0; i < state.cards.length; i++) {
    const entry = state.cards[i];
    const card = entry.card;
    const frame = entry.frame;
    if (!card || card.removed) continue;
    const frameId = frame && frame.id ? frame.id : "";

    const cardIsHero =
      profile.id === "portfolio" &&
      i === 0 &&
      annotations.skipHero === true;

    const desiredEnabled = annotations.enabled && !cardIsHero;
    const existingSlot = osCardAnnotationSlot(card);

    // Capture-before-remove: read the current note, falling back to the stored
    // baseline when this card currently renders no slot, so a disable never
    // destroys retrievable content.
    const liveCapture = osCaptureAnnotation(card);
    const retained = liveCapture || (frameId ? preserved[frameId] : null) || null;
    if (frameId && retained) capturedByFrameId[frameId] = retained;

    if (!desiredEnabled) {
      if (existingSlot && !existingSlot.removed) {
        try {
          existingSlot.remove();
        } catch (e) {}
      }
      continue;
    }

    // Desired slot present. Reuse if it exists; rebuild only when missing.
    // On rebuild, replay the preserved note (text + placement) instead of the
    // placeholder so re-enabling restores what the user had written.
    let slot = existingSlot;
    if (!slot || slot.removed) {
      const replay = frameId ? preserved[frameId] : null;
      slot = await osAppendAnnotationSlot(
        card,
        frame,
        tokens,
        annotations,
        replay
      );
    }

    // Ensure slot size + position match the resolved annotation config.
    const w =
      frame && typeof frame.width === "number" ? frame.width : slot.width;
    const h =
      annotations.mode === "expanded"
        ? annotations.heightExpanded
        : annotations.heightCompact;
    try {
      slot.resize(w, h);
    } catch (e) {}
    osPreserveFrameSize(slot);

    // Move the slot to the desired position within the card (above the
    // embedded frame for "aboveScreen", or last child for "belowDescription").
    if (annotations.position === "aboveScreen" && frame) {
      const frameIdx = card.children.indexOf(frame);
      const slotIdx = card.children.indexOf(slot);
      if (frameIdx >= 0 && slotIdx >= 0 && slotIdx >= frameIdx) {
        try {
          card.insertChild(frameIdx, slot);
        } catch (e) {}
      }
    } else {
      const slotIdx = card.children.indexOf(slot);
      const lastIdx = card.children.length - 1;
      if (slotIdx >= 0 && slotIdx !== lastIdx) {
        try {
          card.appendChild(slot);
        } catch (e) {}
      }
    }

    // Yield every 8 cards so very large boards stay responsive.
    if (i > 0 && i % 8 === 0) {
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
    }
  }

  return capturedByFrameId;
}

// ---------------------------------------------------------------------------
// Full interior recompose.
// ---------------------------------------------------------------------------

async function osRecomposeBoard(section, params) {
  if (figma.editorType && figma.editorType !== "figma") {
    throw new Error(
      "Organize Screens edits are only available in Figma design files."
    );
  }
  if (!section || section.removed || section.type !== "SECTION") {
    throw new Error("The selected board is no longer available.");
  }

  const container = osFindContainerInSection(section);
  if (!container) {
    throw new Error("Selected section is missing its Section Container.");
  }

  const state = osExtractBoardState(section);
  if (!state) {
    throw new Error("Could not read the existing board structure.");
  }

  // Stored variant grouping is replayed verbatim — we never re-detect on
  // recompose, so a user who dismissed a naming-based group does not see it
  // silently regroup.
  const prevMeta = osReadBoardMetadata(container);
  const storedGroups =
    prevMeta && Array.isArray(prevMeta.variantGroups)
      ? prevMeta.variantGroups
      : [];

  // Flow: an explicit param wins (UI always sends one); otherwise reuse the
  // board's stored flow setting so a non-flow edit preserves the overlay.
  const flowEnabled =
    typeof params.flow === "boolean"
      ? params.flow
      : !!(prevMeta && prevMeta.settings && prevMeta.settings.flow);

  // Functional mode: an explicit param wins; otherwise reuse the board's stored
  // mode so a non-mode recompose preserves the Functional Card structure.
  const functionalMode =
    params.functionalMode === "advanced" || params.functionalMode === "basic"
      ? params.functionalMode
      : prevMeta &&
        prevMeta.settings &&
        prevMeta.settings.functional &&
        prevMeta.settings.functional.mode === "advanced"
      ? "advanced"
      : "basic";
  // Selective flow scope: an explicit param wins (Apply path) — including an
  // explicit null which clears the scope; otherwise reuse the board's stored
  // scope. Filtered against surviving frames after teardown prep below.
  const prevFlowScope =
    prevMeta && prevMeta.settings && Array.isArray(prevMeta.settings.flowFrameIds)
      ? prevMeta.settings.flowFrameIds
      : null;
  let flowFrameIds;
  if (params.flowFrameIds === null) {
    flowFrameIds = null;
  } else if (Array.isArray(params.flowFrameIds)) {
    flowFrameIds = params.flowFrameIds;
  } else {
    flowFrameIds = prevFlowScope;
  }
  // Capture any user-edited flow labels before teardown so a recompose
  // replays them by index instead of resetting to the placeholder.
  const preservedFlowLabels = osCollectFlowLabels(container);

  // Extract embedded screen frames in document order; skip cards whose
  // embedded frame was removed by the user. Preserve title/description and
  // Pros/Cons copy verbatim (empty string counts as an edit).
  // Stored annotation baseline (text + placement) keyed by frame id. Used as
  // the fallback when the current board did not render annotation slots (e.g.
  // a Design Review board): live extraction returns null there, but the note
  // must survive the round trip, so we replay it from metadata.
  const prevAnnByFrameId = {};
  // Stored functional documentation baseline keyed by frame id. Used as the
  // fallback when the current board did not render a Functional Card (e.g. a
  // Custom board): live extraction returns null there, but the doc text must
  // survive the round trip, so we replay it from metadata (mirrors annotations).
  const prevDocByFrameId = {};
  if (prevMeta && prevMeta.copyBaseline && Array.isArray(prevMeta.copyBaseline.cards)) {
    for (const c of prevMeta.copyBaseline.cards) {
      if (c && c.frameId && c.annotation && typeof c.annotation === "object") {
        prevAnnByFrameId[c.frameId] = c.annotation;
      }
      if (c && c.frameId && c.doc && typeof c.doc === "object") {
        prevDocByFrameId[c.frameId] = c.doc;
      }
    }
  }

  const frames = [];
  const liveCopyByFrameId = {};
  const liveReviewByFrameId = {};
  const liveDocByFrameId = {};
  const liveAnnotationByFrameId = {};
  for (const entry of state.cards) {
    if (entry.frame && !entry.frame.removed) {
      frames.push(entry.frame);
      liveCopyByFrameId[entry.frame.id] = {
        title: entry.title,
        description: entry.description,
        pros: entry.pros,
        cons: entry.cons,
      };
      // Prefer the live note (current board rendered a slot); else fall back to
      // the stored baseline so an incapable board type preserves placement.
      const liveAnn =
        entry.annotation && typeof entry.annotation === "object"
          ? entry.annotation
          : null;
      const preservedAnn = liveAnn || prevAnnByFrameId[entry.frame.id] || null;
      if (preservedAnn) {
        liveAnnotationByFrameId[entry.frame.id] = preservedAnn;
      }
      // Prefer the live functional doc (current board rendered a Functional
      // Card); else fall back to the stored baseline so an incapable board type
      // preserves the documentation text across the round trip.
      const liveDoc =
        entry.doc && typeof entry.doc === "object" ? entry.doc : null;
      const preservedDoc = liveDoc || prevDocByFrameId[entry.frame.id] || null;
      if (preservedDoc) {
        liveDocByFrameId[entry.frame.id] = preservedDoc;
      }
      if (entry.review && typeof entry.review === "object") {
        liveReviewByFrameId[entry.frame.id] = entry.review;
      } else if (entry.pros || entry.cons) {
        // Migration: a former variant Assessment block (pre-comparative). Seed
        // the comparative pros/cons fields so feedback survives the upgrade to a
        // Comparative Review Card. Harmless for singletons (no Assessment text).
        liveReviewByFrameId[entry.frame.id] = {
          pros: entry.pros,
          cons: entry.cons,
        };
      }
    }
  }
  if (!frames.length) {
    throw new Error("No screen frames found inside this board.");
  }

  const profile = osResolveBoardType(params.boardType || params.personality);
  const orientation = osResolveOrientation(params.orientation);
  const tokens = osResolveTokens(OS_BASE_TOKENS, profile, orientation);
  const annotations = osResolveAnnotations(
    profile,
    params.annotations,
    orientation
  );

  await osLoadFonts(tokens);

  // Font loading is async; the user could have deleted the board (or
  // individual screen frames) while we were waiting. Re-resolve so we
  // never write into a removed node.
  if (section.removed || container.removed) {
    throw new Error("The selected board was removed while recompose was preparing.");
  }
  const liveFrames = [];
  for (const f of frames) {
    if (f && !f.removed) liveFrames.push(f);
  }
  if (!liveFrames.length) {
    throw new Error("All screen frames were removed before recompose could run.");
  }

  // Drop scoped flow ids whose frame the user removed; fall back to whole-board
  // when fewer than 2 survive (a 0/1-card flow is meaningless). When the scope
  // set changes, reset preserved labels to placeholder so a label never
  // reattaches to a different transition than the user intended.
  if (Array.isArray(flowFrameIds) && flowFrameIds.length) {
    const liveSet = {};
    for (let i = 0; i < liveFrames.length; i++) liveSet[liveFrames[i].id] = true;
    const survivors = [];
    for (let i = 0; i < flowFrameIds.length; i++) {
      if (liveSet[flowFrameIds[i]]) survivors.push(flowFrameIds[i]);
    }
    flowFrameIds = survivors.length >= 2 ? survivors : null;
  } else {
    flowFrameIds = null;
  }
  const flowScopeChanged = !osFlowFrameIdsEqual(flowFrameIds, prevFlowScope);
  const flowLabelsForBuild = flowScopeChanged ? [] : preservedFlowLabels;

  // Replay stored variant groups: map each group's sourceFrameIds onto live
  // frames (dropping any removed). A group with fewer than 2 survivors
  // degrades to singletons. Remaining live frames are singletons.
  const liveById = {};
  for (let li = 0; li < liveFrames.length; li++) {
    liveById[liveFrames[li].id] = liveFrames[li];
  }
  const replayGroups = [];
  const groupedFrameIds = {};
  for (let sg = 0; sg < storedGroups.length; sg++) {
    const stored = storedGroups[sg];
    const gframes = [];
    const glabels = [];
    for (let i = 0; i < stored.sourceFrameIds.length; i++) {
      const fid = stored.sourceFrameIds[i];
      if (liveById[fid]) {
        gframes.push(liveById[fid]);
        glabels.push(stored.variantLabels[i] || String(i + 1));
      }
    }
    if (gframes.length >= 2) {
      replayGroups.push({
        key: stored.key,
        label: stored.label,
        frames: gframes,
        variantLabels: glabels,
        source: stored.source,
        confidence: "high",
      });
      for (let gf = 0; gf < gframes.length; gf++) {
        groupedFrameIds[gframes[gf].id] = true;
      }
    }
  }
  const replaySingletons = [];
  for (let rs = 0; rs < liveFrames.length; rs++) {
    if (!groupedFrameIds[liveFrames[rs].id]) {
      replaySingletons.push(liveFrames[rs]);
    }
  }

  // Tear down the existing interior. Move embedded screen frames out to a
  // temporary holder on the same page so they survive the container teardown
  // (they will be re-appended into new cards by the builder).
  const page = osGetPageForNode(section) || figma.currentPage;
  for (const f of liveFrames) {
    try {
      page.appendChild(f);
    } catch (e) {}
  }
  // Remove all current children of the container (header + grid trees).
  for (const child of container.children.slice()) {
    try {
      child.remove();
    } catch (e) {}
  }

  // Section title/description: explicit params win (agent/MCP path);
  // otherwise always reuse the live snapshot from the board so any user
  // edit -- even an intentionally empty string -- is preserved. The
  // section name and personality default are only used when the board
  // never had a snapshot (extraction returned null/undefined).
  const resolvedTitle =
    typeof params.sectionTitle === "string"
      ? params.sectionTitle
      : typeof state.sectionTitle === "string"
        ? state.sectionTitle
        : section.name || "Screen Overview";
  const resolvedDescription =
    typeof params.sectionDescription === "string"
      ? params.sectionDescription
      : typeof state.sectionDescription === "string"
        ? state.sectionDescription
        : osDefaultSectionDescription(profile);

  // Steps 2-8 of the Build Section pipeline on the existing section/container.
  const bsc = osMakeBuildSectionCtx({
    mode: "recompose",
    profile: profile,
    orientation: orientation,
    tokens: tokens,
    annotations: annotations,
    singletonFrames: replaySingletons,
    variantGroups: replayGroups,
    sectionTitle: resolvedTitle,
    sectionDescription: resolvedDescription,
    cardCopyOverrides: liveCopyByFrameId,
    reviewOverrides: liveReviewByFrameId,
    funcOverrides: liveDocByFrameId,
    annotationOverrides: liveAnnotationByFrameId,
    decisionOverrides: state.decisions || null,
    functionalMode: functionalMode,
    flow: flowEnabled,
    flowLabels: flowLabelsForBuild,
    flowFrameIds: flowFrameIds,
    section: section,
    container: container,
  });
  await osBuildSection_prepareSectionShell(bsc);
  const build = await osRunBuildSectionPipeline(bsc);
  osBuildSection_writeMetadata(bsc);
  osBuildSection_finalPositioning(bsc);

  return {
    operation: "recompose",
    boardType: profile.id,
    orientation: orientation.id,
    sectionId: section.id,
    sectionName: section.name,
    pageName: figma.currentPage.name,
    cardCount: build.ctx.cardIds.length,
    cardIds: build.ctx.cardIds,
    columns: build.plan.columns,
    strategy: build.plan.strategy,
    flow: flowEnabled,
    flowArrowCount: build.flowArrowCount || 0,
    skippedFrameCount: Math.max(
      0,
      state.cards.length - liveFrames.length
    ),
    engineVersion: OS_ENGINE_VERSION,
    compositionPlanSummary: {
      boardType: build.plan.boardType,
      orientation: build.plan.orientation,
      strategy: build.plan.strategy,
      columns: build.plan.columns,
      maxPerStrip: build.plan.maxPerStrip,
      rowCount: build.plan.rows.length,
      groupCount: build.plan.groups.length,
      heroIndex:
        build.plan.emphasis &&
        typeof build.plan.emphasis.heroIndex === "number"
          ? build.plan.emphasis.heroIndex
          : null,
      cardWidthPolicy: build.plan.cardWidthPolicy,
      annotations: annotations.enabled
        ? { mode: annotations.mode, position: annotations.position }
        : null,
      isWide: build.plan.isWide,
      maxFrameWidth: build.plan.maxFrameWidth,
      screenCount: build.plan.screenCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Apply edit (entry point — picks patch vs recompose based on delta).
// ---------------------------------------------------------------------------

async function osApplyBoardEdit(sectionId, params) {
  if (figma.editorType && figma.editorType !== "figma") {
    throw new Error(
      "Organize Screens edits are only available in Figma design files."
    );
  }
  const node = await figma.getNodeByIdAsync(sectionId);
  if (!node || node.removed || node.type !== "SECTION") {
    throw new Error("The board you were editing is no longer on the canvas.");
  }
  const container = osFindContainerInSection(node);
  if (!container) {
    throw new Error("Selected section is missing its Section Container.");
  }
  const prev = osReadBoardMetadata(container);

  const nextProfile = osResolveBoardType(
    params.boardType ||
      params.personality ||
      (prev && prev.settings && (prev.settings.boardType || prev.settings.personality)) ||
      "custom"
  );
  const nextOrientation = osResolveOrientation(
    params.orientation || (prev && prev.settings.orientation) || "passthrough"
  );
  const nextTokens = osResolveTokens(
    OS_BASE_TOKENS,
    nextProfile,
    nextOrientation
  );
  // Annotations: if params didn't specify, fall back to stored settings.
  let annParam = params.annotations;
  if (annParam === undefined && prev) {
    const a = prev.settings.annotations;
    annParam = a.enabled
      ? { enabled: true, mode: a.mode, position: a.position }
      : false;
  }
  const nextAnnotations = osResolveAnnotations(
    nextProfile,
    annParam,
    nextOrientation
  );

  // Flow: an explicit param wins; otherwise keep the board's stored value so
  // a non-flow edit does not silently toggle the overlay.
  const nextFlow =
    typeof params.flow === "boolean"
      ? params.flow
      : !!(prev && prev.settings && prev.settings.flow);

  // Functional mode: explicit param wins; otherwise keep the board's stored
  // mode (defaults to basic) so a non-mode edit does not silently switch it.
  const nextFunctionalMode =
    params.functionalMode === "advanced" || params.functionalMode === "basic"
      ? params.functionalMode
      : prev &&
        prev.settings &&
        prev.settings.functional &&
        prev.settings.functional.mode === "advanced"
      ? "advanced"
      : "basic";

  // Selective flow scope: derive from the live selection at apply time. Only an
  // explicit gesture changes the durable scope (a 2+ subset sets it; selecting
  // all cards clears it; anything else keeps the stored value). Resolve before
  // teardown so the selection still points at the live cards. Flow OFF drops
  // any scope so re-enabling starts from a clean whole-board overlay.
  const prevFlowFrameIds =
    prev && prev.settings && Array.isArray(prev.settings.flowFrameIds)
      ? prev.settings.flowFrameIds
      : null;
  let nextFlowFrameIds = prevFlowFrameIds;
  if (nextFlow) {
    const scope = osResolveSelectedFlowScope(container);
    if (scope.action === "set") nextFlowFrameIds = scope.ids;
    else if (scope.action === "clear") nextFlowFrameIds = null;
  } else {
    nextFlowFrameIds = null;
  }

  const nextSettings = {
    boardType: nextProfile.id,
    orientation: nextOrientation.id,
    annotations: {
      // Compare against the intent (matches what metadata stores) so a board-type
      // switch that only hides annotations is not misclassified.
      enabled:
        (typeof nextAnnotations.intendedEnabled === "boolean"
          ? nextAnnotations.intendedEnabled
          : nextAnnotations.enabled) === true,
      mode: nextAnnotations.mode,
      position: nextAnnotations.position,
    },
    flow: nextFlow,
    flowFrameIds: nextFlowFrameIds,
    functional: { mode: nextFunctionalMode },
  };
  const delta = osClassifySettingsDelta(prev, { settings: nextSettings });

  if (delta === "none") {
    return {
      operation: "apply",
      delta: "none",
      sectionId: node.id,
      sectionName: node.name,
      engineVersion: OS_ENGINE_VERSION,
    };
  }

  if (delta === "annotationsOnly") {
    const state = osExtractBoardState(node);
    if (!state) {
      throw new Error("Could not read the existing board structure.");
    }
    // Seed the patch with the stored annotation baseline so re-enabling
    // annotations replays previously captured text + placement.
    const preservedByFrameId = {};
    if (prev && prev.copyBaseline && Array.isArray(prev.copyBaseline.cards)) {
      for (const c of prev.copyBaseline.cards) {
        if (c && c.frameId && c.annotation && typeof c.annotation === "object") {
          preservedByFrameId[c.frameId] = c.annotation;
        }
      }
    }

    const capturedByFrameId = await osPatchBoardAnnotations(
      state,
      nextProfile,
      nextOrientation,
      nextAnnotations,
      nextTokens,
      preservedByFrameId
    );

    // Update metadata so future deltas compare against the patched state.
    const plan = {
      strategy: prev ? prev.layout.strategy : "compactGrid",
      columns: prev ? prev.layout.columns : 1,
      screenCount: state.cards.length,
      maxFrameWidth: prev ? prev.layout.maxFrameWidth : 0,
    };
    // Keep existing copy baseline; refresh from live text snapshot. Persist the
    // captured note (text + placement) even when the slot was just removed, so
    // a disable -> enable round trip restores content.
    const cards = [];
    for (const entry of state.cards) {
      if (entry.frame && entry.frame.id) {
        const cardEntry = {
          frameId: entry.frame.id,
          title: entry.title,
          description: entry.description,
        };
        const ann = capturedByFrameId[entry.frame.id];
        if (ann && typeof ann === "object") cardEntry.annotation = ann;
        cards.push(cardEntry);
      }
    }
    osWriteBoardMetadata(state.container, {
      profile: nextProfile,
      orientation: nextOrientation,
      annotations: nextAnnotations,
      plan: plan,
      sectionTitle: state.sectionTitle,
      sectionDescription: state.sectionDescription,
      cards: cards,
      // Flow is unchanged on an annotations-only patch; preserve the stored
      // value (and its scope) so the metadata stays accurate.
      flow: nextFlow,
      flowFrameIds: nextFlowFrameIds,
      // Functional mode is unchanged on an annotations-only patch; preserve the
      // stored value so the metadata write does not reset it to basic.
      functionalMode: nextFunctionalMode,
      // Preserve stored grouping — an annotations-only patch must not wipe
      // it, or a later layout recompose would lose the comparison strips.
      variantGroups: prev && Array.isArray(prev.variantGroups)
        ? prev.variantGroups
        : [],
    });

    return {
      operation: "apply",
      delta: "annotationsOnly",
      sectionId: node.id,
      sectionName: node.name,
      cardCount: state.cards.length,
      annotations: nextAnnotations.enabled
        ? {
            mode: nextAnnotations.mode,
            position: nextAnnotations.position,
          }
        : null,
      engineVersion: OS_ENGINE_VERSION,
    };
  }

  // delta === "layout"  => full recompose.
  const recomposeParams = {
    boardType: nextProfile.id,
    orientation: nextOrientation.id,
    annotations: annParam,
    sectionTitle: params.sectionTitle,
    sectionDescription: params.sectionDescription,
    flow: nextFlow,
    flowFrameIds: nextFlowFrameIds,
    functionalMode: nextFunctionalMode,
  };
  const result = await osRecomposeBoard(node, recomposeParams);
  result.delta = "layout";
  return result;
}

// ---------------------------------------------------------------------------
// Reset to screens only (entry point).
//
// Deconstructs a plugin-generated board: lifts the original screen frames out
// to the page (kept exactly where they sit inside the section) and deletes all
// generated scaffolding (cards, header/description, review cards + status
// instances, annotation layers, flow overlay, container, section) plus its
// metadata. Original frames are never deleted or mutated beyond re-parenting +
// repositioning to their current on-canvas location. Document-scoped shared
// assets (the Review Status component set, its id on figma.root) are left
// intact. Idempotent: once the section is gone, a re-run cannot find a board.
// ---------------------------------------------------------------------------

async function osResetBoardToScreens(sectionId) {
  if (figma.editorType && figma.editorType !== "figma") {
    throw new Error(
      "Organize Screens edits are only available in Figma design files."
    );
  }
  const node = await figma.getNodeByIdAsync(sectionId);
  if (!node || node.removed || node.type !== "SECTION") {
    throw new Error("The board you were editing is no longer on the canvas.");
  }
  const container = osFindContainerInSection(node);
  if (!container) {
    throw new Error(
      "This section was not generated by Organize Screens, so there is nothing to reset."
    );
  }

  const state = osExtractBoardState(node);
  if (!state) {
    throw new Error("Could not read the existing board structure.");
  }

  // Live embedded screen frames in document order; skip any the user removed.
  const liveFrames = [];
  for (let i = 0; i < state.cards.length; i++) {
    const entry = state.cards[i];
    if (entry.frame && !entry.frame.removed) liveFrames.push(entry.frame);
  }
  const skippedRemovedCount = Math.max(
    0,
    state.cards.length - liveFrames.length
  );

  // Make the board's owning page current so the final selection / zoom is
  // valid even if the board lives on another page.
  const page = osGetPageForNode(node) || figma.currentPage;
  if (page && figma.currentPage !== page) {
    await figma.setCurrentPageAsync(page);
    // The page switch is async; the board could have been removed meanwhile.
    if (node.removed) {
      throw new Error("The board was removed before reset could run.");
    }
  }

  const removedSectionId = node.id;
  const removedSectionName = node.name;

  // Capture every frame's CURRENT absolute position (its spot inside the
  // section) in one pass BEFORE reparenting — moving one frame out of an
  // auto-layout card reflows its siblings and shifts their bounding boxes.
  const placements = [];
  for (let i = 0; i < liveFrames.length; i++) {
    placements.push({ frame: liveFrames[i], box: osAbsBox(liveFrames[i]) });
  }

  // Lift each frame to the page (page children use absolute coords) and
  // restore its captured position so it stays exactly where it appeared.
  for (let i = 0; i < placements.length; i++) {
    const frame = placements[i].frame;
    const box = placements[i].box;
    try {
      page.appendChild(frame);
    } catch (e) {}
    if (box) {
      try {
        frame.x = box.x;
        frame.y = box.y;
      } catch (e) {}
    }
  }

  // Remove the section and every generated descendant (and its sharedPluginData
  // metadata) in one shot. The freed frames are already out, so they survive.
  try {
    node.remove();
  } catch (e) {}

  if (liveFrames.length) {
    const survivors = [];
    for (let i = 0; i < liveFrames.length; i++) {
      if (liveFrames[i] && !liveFrames[i].removed) survivors.push(liveFrames[i]);
    }
    if (survivors.length) {
      figma.currentPage.selection = survivors;
      if (
        figma.viewport &&
        typeof figma.viewport.scrollAndZoomIntoView === "function"
      ) {
        figma.viewport.scrollAndZoomIntoView(survivors);
      }
    }
  }

  return {
    operation: "resetToScreens",
    removedSectionId: removedSectionId,
    removedSectionName: removedSectionName,
    pageName: figma.currentPage.name,
    freedFrameCount: liveFrames.length,
    skippedRemovedCount: skippedRemovedCount,
    engineVersion: OS_ENGINE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Selection-context probe (for the plugin UI).
// ---------------------------------------------------------------------------

// Resolve how the live selection should affect a board's scoped flow on Apply.
// Durable scope only changes on an explicit gesture; otherwise it is kept:
//   { action: "set", ids } -> a proper subset of 2..n-1 Screen Cards is
//                             selected; flow connects only these, in selection
//                             order (keyed by embedded source-frame id).
//   { action: "clear" }    -> all n Screen Cards selected (explicit "back to
//                             whole board" gesture).
//   { action: "keep" }     -> anything else (0/1 card, the section, the
//                             header, non-card nodes); leave stored scope
//                             untouched so incidental edits never rescope.
// `container` is the board's Section Container. ES2019-safe (no ?./??).
function osResolveSelectedFlowScope(container) {
  if (!container) return { action: "keep" };
  const sel = (figma.currentPage && figma.currentPage.selection) || [];
  const grid = osFindGrid(container) || container;
  const allCards = osCollectCardsInGrid(grid);
  const total = allCards.length;
  if (total < 2) return { action: "keep" };

  // Map each board card to its embedded source-frame id (the same stable key
  // recompose and copy preservation use).
  const cardIdToFrameId = {};
  for (let i = 0; i < allCards.length; i++) {
    const ef = osCardEmbeddedFrame(allCards[i]);
    if (ef && ef.id) cardIdToFrameId[allCards[i].id] = ef.id;
  }

  // Walk each selected node up to its owning Screen Card, dedup the resulting
  // frame ids in selection order, keep only cards that belong to this board.
  const orderedFrameIds = [];
  const seen = {};
  for (let s = 0; s < sel.length; s++) {
    const card = osFindScreenCard(sel[s]);
    if (!card) continue;
    const fid = cardIdToFrameId[card.id];
    if (!fid) continue;
    if (seen[fid]) continue;
    seen[fid] = true;
    orderedFrameIds.push(fid);
  }

  const count = orderedFrameIds.length;
  if (count >= total) return { action: "clear" };
  if (count >= 2) return { action: "set", ids: orderedFrameIds };
  return { action: "keep" };
}

// True when the current selection can drive an in-place flow: 2+ FRAMEs, or
// any selected SECTION holding 2+ direct child FRAMEs.
function osComputeFlowEligible(sel) {
  let frameCount = 0;
  for (let i = 0; i < sel.length; i++) {
    const n = sel[i];
    if (!n) continue;
    if (n.type === "FRAME") frameCount++;
    else if (n.type === "SECTION" && "children" in n) {
      let childFrames = 0;
      for (let c = 0; c < n.children.length; c++) {
        if (n.children[c].type === "FRAME") childFrames++;
      }
      if (childFrames >= 2) return true;
    }
  }
  return frameCount >= 2;
}

// Public probe: delegates to the core resolver, then attaches `flowEligible`
// to every object result so the panel can offer the in-place flow action
// regardless of compose / arrange / edit / idle mode.
// ---------------------------------------------------------------------------
// Analyze Design (AI) target resolution + apply.
//
// Analyze Design operates on ONE selected Screen Card on a Design Review board
// whose Review Card uses the `standard` framework. The engine owns selection
// resolution and every canvas write; the TS runtime owns export + the network
// call + JSON validation. Comparative variant cards are out of scope for v1.
// ---------------------------------------------------------------------------

// AI field key -> review section tag key (or the special "cardDescription").
const OS_ANALYZE_FIELD_LABELS = {
  cardDescription: "Card description",
  workingWell: "What's good",
  questions: "Questions",
  concerns: "Concerns",
  ideas: "Ideas",
  notes: "Notes",
};
const OS_ANALYZE_LIST_FIELDS = ["workingWell", "questions", "concerns", "ideas"];

// Walk up from a selected node to its owning Screen Card frame.
function osFindScreenCard(node) {
  let cursor = node;
  let safety = 0;
  while (cursor && safety < 24) {
    if (
      cursor.type === "FRAME" &&
      typeof cursor.name === "string" &&
      cursor.name.indexOf("Screen Card / ") === 0
    ) {
      return cursor;
    }
    cursor = cursor.parent || null;
    safety += 1;
  }
  return null;
}

// First TEXT descendant with the given name (used for the Card Description,
// which lives inside the Screen Column, not as a direct child of the card).
function osFindDescendantTextByName(root, name) {
  if (!root || !("children" in root)) return null;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === "TEXT" && node.name === name) return node;
    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }
  return null;
}

// Classify a card's review framework from its tagged fields: "comparative"
// (pros/cons/...) or "standard" (workingWell/...). null when no review fields.
function osCardReviewFrameworkId(card) {
  return osClassifyReviewFramework(osExtractReviewFields(card));
}

// Pure classification of a review-fields map. Split out so the probe's card
// index can classify from fields it already extracted, without re-walking.
function osClassifyReviewFramework(fields) {
  if (!fields) return null;
  const comparative = ["pros", "cons", "openQuestions", "improvementIdeas"];
  for (let i = 0; i < comparative.length; i++) {
    if (Object.prototype.hasOwnProperty.call(fields, comparative[i])) {
      return "comparative";
    }
  }
  const standard = ["workingWell", "questions", "concerns", "ideas"];
  for (let i = 0; i < standard.length; i++) {
    if (Object.prototype.hasOwnProperty.call(fields, standard[i])) {
      return "standard";
    }
  }
  return null;
}

// True when a review field's verbatim text is real (non-empty, not the
// framework placeholder for that key).
function osReviewFieldIsRealText(text, fieldKey) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed.length) return false;
  const placeholder = OS_REVIEW_PLACEHOLDERS[fieldKey];
  return trimmed !== (placeholder || "");
}

// Human display name for a card: Card Title text, else the frame name suffix.
function osCardDisplayName(card) {
  const title = osFindDescendantTextByName(card, "Card Title");
  if (title && typeof title.characters === "string" && title.characters.trim()) {
    return title.characters.trim();
  }
  if (card && typeof card.name === "string") {
    return card.name.replace("Screen Card / ", "");
  }
  return "Screen";
}

// Does this card already have real review text or a non-empty description?
function osAnalyzeDesignExistingContent(card) {
  let hasContent = false;
  let description = "";
  const desc = osFindDescendantTextByName(card, "Card Description");
  if (desc && typeof desc.characters === "string" && desc.characters.trim()) {
    description = desc.characters.trim();
    hasContent = true;
  }
  const fields = osExtractReviewFields(card);
  if (fields) {
    for (const key in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      if (osReviewFieldIsRealText(fields[key], key)) {
        hasContent = true;
        break;
      }
    }
  }
  return { hasContent: hasContent, description: description };
}

// Resolve the Analyze Design target for the current selection. Returns an
// eligibility object; `eligible:false` carries a human-readable `reason`.
function osResolveAnalyzeDesignTarget() {
  if (figma.editorType && figma.editorType !== "figma") {
    return { eligible: false, reason: "Analyze Design runs in the Figma editor only." };
  }
  const sel = (figma.currentPage && figma.currentPage.selection) || [];
  if (!sel.length) {
    return { eligible: false, reason: "Select a screen card on a Design Review board." };
  }
  const boards = osResolveSelectedBoards(sel);
  if (boards.length !== 1) {
    return {
      eligible: false,
      reason: "Select a single screen card on one Design Review board.",
    };
  }
  const root = boards[0];

  let card = null;
  for (let i = 0; i < sel.length; i++) {
    const found = osFindScreenCard(sel[i]);
    if (found) {
      card = found;
      break;
    }
  }
  if (!card) {
    return {
      eligible: false,
      reason: "Select one screen card (not the whole board) to analyze.",
    };
  }

  const frame = osCardEmbeddedFrame(card);
  if (!frame) {
    return { eligible: false, reason: "This card has no embedded screen to analyze." };
  }
  if (!osCardReviewCard(card)) {
    return {
      eligible: false,
      reason: "Analyze Design needs a Design Review card. Switch the board to Design Review first.",
    };
  }
  const frameworkId = osCardReviewFrameworkId(card);
  if (frameworkId === "comparative") {
    return {
      eligible: false,
      reason: "Comparative variant cards aren't supported yet — analyze a single-screen review card.",
    };
  }

  const content = osAnalyzeDesignExistingContent(card);
  return {
    eligible: true,
    sectionId: root.section.id,
    cardId: card.id,
    frameId: frame.id,
    cardName: osCardDisplayName(card),
    frameName: frame.name || "",
    frameworkId: "standard",
    boardType: "design-review",
    hasExistingContent: content.hasContent,
    existingDescription: content.description,
  };
}

// Section-scope analyze target: every standard Design Review screen in one
// selected board. Used when the selection is the section / container / header
// or multiple cards (card scope takes priority for a single card). The runtime
// re-resolves each frame by id at run time; the probe only needs the count.
//
// Optional `index` (probe-only fast path): a prebuilt osBuildProbeCardIndex for
// this board's container. When supplied, per-card lookups read from it instead
// of re-walking each card's subtree. The apply path calls this with no arg and
// behaves exactly as before.
function osResolveAnalyzeDesignSectionTarget(index) {
  if (figma.editorType && figma.editorType !== "figma") {
    return { eligible: false, reason: "Analyze Design runs in the Figma editor only." };
  }
  const sel = (figma.currentPage && figma.currentPage.selection) || [];
  if (!sel.length) {
    return { eligible: false, reason: "Select a Design Review section to analyze its screens." };
  }
  const boards = osResolveSelectedBoards(sel);
  if (boards.length !== 1) {
    return {
      eligible: false,
      reason: "Select a single Design Review section.",
    };
  }
  const root = boards[0];
  const container = root.container || osFindContainerInSection(root.section);
  const useIndex = index && index.container === container;
  const hasSurface = useIndex
    ? index.hasReviewSurface
    : osBoardHasDesignReviewSurface(container);
  if (!hasSurface) {
    return {
      eligible: false,
      reason: "Section analysis needs a Design Review board. Switch the board to Design Review first.",
    };
  }

  const grid = useIndex ? index.grid : osFindGrid(container);
  const cards = useIndex ? index.cards : osCollectCardsInGrid(grid || container);
  const screens = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const entry = useIndex ? index.byId[card.id] : null;
    const frame = entry ? entry.embeddedFrame : osCardEmbeddedFrame(card);
    if (!frame) continue;
    const reviewCard = entry ? entry.reviewCard : osCardReviewCard(card);
    if (!reviewCard) continue;
    const frameworkId = entry
      ? osClassifyReviewFramework(osExtractReviewFieldsFromReviewCard(entry.reviewCard))
      : osCardReviewFrameworkId(card);
    if (frameworkId === "comparative") continue;
    screens.push({
      cardId: card.id,
      frameId: frame.id,
      cardName: entry ? osEntryDisplayName(entry) : osCardDisplayName(card),
      frameName: frame.name || "",
      frameworkId: "standard",
    });
  }

  if (!screens.length) {
    return {
      eligible: false,
      reason: "No standard Design Review screens found in this section.",
    };
  }

  return {
    eligible: true,
    sectionId: root.section.id,
    sectionName: root.section.name || "",
    boardType: "design-review",
    screens: screens,
    screenCount: screens.length,
  };
}

// Set a text node's characters after loading its font (handles mixed fonts by
// falling back to the base family). Optionally repaint the fill.
async function osSetTextNodeCharacters(node, text, color) {
  if (!node || node.removed || node.type !== "TEXT") return false;
  try {
    if (node.fontName === figma.mixed) {
      const fallback = { family: OS_BASE_TOKENS.fontFamily, style: "Regular" };
      await figma.loadFontAsync(fallback);
      node.fontName = fallback;
    } else {
      await figma.loadFontAsync(node.fontName);
    }
    node.characters = text;
    if (color) {
      node.fills = [{ type: "SOLID", color: color }];
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Join a bullet array into a single text block (legacy `•` prefix join). Used by
// Functional Analysis apply; Design Review uses native UNORDERED lists instead.
function osJoinAnalysisBullets(items) {
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const s = typeof items[i] === "string" ? items[i].trim() : "";
    if (s) lines.push("\u2022 " + s);
  }
  return lines.join("\n");
}

// Trim and drop empty strings from a model list field.
function osNormalizeAnalysisLines(items) {
  const lines = [];
  if (!Array.isArray(items)) return lines;
  for (let i = 0; i < items.length; i++) {
    const s = typeof items[i] === "string" ? items[i].trim() : "";
    if (s) lines.push(s);
  }
  return lines;
}

function osClearTextListOptions(node) {
  if (!node || node.type !== "TEXT" || typeof node.setRangeListOptions !== "function") {
    return;
  }
  try {
    const len = typeof node.characters === "string" ? node.characters.length : 0;
    if (len > 0) node.setRangeListOptions(0, len, { type: "NONE" });
  } catch (e) {}
}

// Apply native UNORDERED list formatting to an already-populated review field
// TEXT node when forced or when its live text holds 2+ non-empty lines; clear to
// plain text otherwise. Single source of truth shared by the AI apply path AND
// the build/recompose path. Requires the node's font to be loaded (callers set
// characters with a loaded font first).
function osApplyReviewFieldListFormatting(node, forceUnordered) {
  if (!node || node.type !== "TEXT") return;
  if (typeof node.setRangeListOptions !== "function") return;
  const chars = typeof node.characters === "string" ? node.characters : "";
  if (!chars.length) {
    osClearTextListOptions(node);
    return;
  }
  let nonEmpty = 0;
  const parts = chars.split(/\r?\n/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].trim().length > 0) nonEmpty += 1;
  }
  if (!forceUnordered && nonEmpty < 2) {
    osClearTextListOptions(node);
    return;
  }
  try {
    node.setRangeListOptions(0, chars.length, { type: "UNORDERED" });
  } catch (e) {}
}

// Write a multi-line review field as a native Figma UNORDERED list (2+ items) or
// plain text (single item). Copy is unchanged — only list formatting differs.
async function osSetTextNodeUnorderedList(node, items, color) {
  const lines = osNormalizeAnalysisLines(items);
  if (!lines.length) return false;
  const text = lines.join("\n");
  const ok = await osSetTextNodeCharacters(node, text, color);
  if (!ok) return false;
  osApplyReviewFieldListFormatting(node);
  return true;
}

// Index every tagged review field TEXT node inside a Review Card by its key.
function osIndexReviewFieldNodes(reviewCard) {
  const map = {};
  if (!reviewCard) return map;
  const stack = [reviewCard];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === "TEXT") {
      let key = "";
      try {
        key = node.getSharedPluginData(OS_REVIEW_NAMESPACE, OS_REVIEW_FIELD_KEY);
      } catch (e) {}
      if (key && !map[key]) map[key] = node;
    }
    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }
  return map;
}

// Find the "Review Field Text" TEXT node for a given field key by structure
// (frame named "Review Section / <key>"), independent of plugin-data tags.
// Fallback for boards whose review fields were built before tagging, or where
// the tag was stripped by an edit/copy. Returns null when no such section.
function osFindReviewFieldNodeByName(reviewCard, fieldKey) {
  if (!reviewCard || !("children" in reviewCard)) return null;
  const sectionName = "Review Section / " + fieldKey;
  const stack = [reviewCard];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === "FRAME" && node.name === sectionName) {
      return osFindDescendantTextByName(node, "Review Field Text");
    }
    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }
  return null;
}

// Resolve a review field's editable TEXT node: prefer the tag index, then fall
// back to the structural ("Review Section / <key>") lookup.
function osResolveReviewFieldNode(reviewCard, fieldNodes, fieldKey) {
  if (fieldNodes && fieldNodes[fieldKey]) return fieldNodes[fieldKey];
  return osFindReviewFieldNodeByName(reviewCard, fieldKey);
}

// Re-resolve a Screen Card by id and assert it is still a valid card frame.
// Shared by the analyze-apply and reset paths (both run after an async gap).
async function osResolveScreenCardById(cardId) {
  const card = await figma.getNodeByIdAsync(cardId);
  if (
    !card ||
    card.removed ||
    card.type !== "FRAME" ||
    typeof card.name !== "string" ||
    card.name.indexOf("Screen Card / ") !== 0
  ) {
    throw new Error("The screen card is no longer on the canvas.");
  }
  return card;
}

// Apply a validated DesignReviewAnalysisV1 to the card's fields. Re-resolves
// nodes by id (never trusts references across the network await). Always
// replaces existing text when the model returned content for that field.
// `scope` narrows the write: "describe" only the Card Description, "review"
// only the review section; any other value writes both (back-compat default).
// Returns readable applied / skipped field labels (skipped = missing node or
// write failure only).
async function osApplyDesignReviewAnalysis(sectionId, cardId, analysis, scope) {
  if (figma.editorType && figma.editorType !== "figma") {
    throw new Error("Analyze Design is only available in Figma design files.");
  }
  if (!analysis || typeof analysis !== "object") {
    throw new Error("No analysis result to apply.");
  }

  const card = await osResolveScreenCardById(cardId);

  const tokens = osResolveTokens(
    OS_BASE_TOKENS,
    osResolveBoardType("design-review"),
    osResolveOrientation("passthrough")
  );

  const applied = [];
  const skipped = [];
  const doDescribe = scope !== "review";
  const doReview = scope !== "describe";

  // 1. Card Description (Screen Column, name-based).
  if (doDescribe) {
    const descText = typeof analysis.cardDescription === "string"
      ? analysis.cardDescription.trim()
      : "";
    if (descText) {
      const descNode = osFindDescendantTextByName(card, "Card Description");
      if (descNode) {
        const ok = await osSetTextNodeCharacters(descNode, descText, tokens.mutedTextColor);
        if (ok) applied.push(OS_ANALYZE_FIELD_LABELS.cardDescription);
        else skipped.push(OS_ANALYZE_FIELD_LABELS.cardDescription);
      }
    }
  }

  if (doReview) {
    // 2. Review fields (tagged TEXT nodes inside the Review Card).
    const reviewCard = osCardReviewCard(card);
    const fieldNodes = osIndexReviewFieldNodes(reviewCard);

    for (let i = 0; i < OS_ANALYZE_LIST_FIELDS.length; i++) {
      const key = OS_ANALYZE_LIST_FIELDS[i];
      const list = Array.isArray(analysis[key]) ? analysis[key] : [];
      if (!osNormalizeAnalysisLines(list).length) continue;
      const node = osResolveReviewFieldNode(reviewCard, fieldNodes, key);
      if (!node) {
        skipped.push(OS_ANALYZE_FIELD_LABELS[key] || key);
        continue;
      }
      const ok = await osSetTextNodeUnorderedList(node, list, tokens.textColor);
      if (ok) applied.push(OS_ANALYZE_FIELD_LABELS[key] || key);
      else skipped.push(OS_ANALYZE_FIELD_LABELS[key] || key);
    }

    // 3. Notes (optional single block).
    const notesText = typeof analysis.notes === "string" ? analysis.notes.trim() : "";
    if (notesText) {
      const notesNode = osResolveReviewFieldNode(reviewCard, fieldNodes, "notes");
      if (notesNode) {
        const ok = await osSetTextNodeCharacters(notesNode, notesText, tokens.textColor);
        if (ok) {
          osClearTextListOptions(notesNode);
          applied.push(OS_ANALYZE_FIELD_LABELS.notes);
        } else skipped.push(OS_ANALYZE_FIELD_LABELS.notes);
      }
    }
  }

  return {
    operation: scope === "describe" ? "describe" : "review",
    sectionId: sectionId,
    cardId: cardId,
    cardName: osCardDisplayName(card),
    applied: applied,
    skipped: skipped,
    engineVersion: OS_ENGINE_VERSION,
  };
}

// Reset every review section field (What's good / Questions / Concerns / Ideas
// / Notes) back to its framework placeholder, in the muted placeholder color.
// Offline (no network). Writing the byte-exact placeholder is required so
// `osReviewFieldIsRealText` re-classifies the field as empty and a later
// recompose (which reads live text) keeps it empty. The Card Description is
// intentionally left untouched.
async function osResetDesignReviewFields(sectionId, cardId) {
  if (figma.editorType && figma.editorType !== "figma") {
    throw new Error("Reset review is only available in Figma design files.");
  }

  const card = await osResolveScreenCardById(cardId);

  const tokens = osResolveTokens(
    OS_BASE_TOKENS,
    osResolveBoardType("design-review"),
    osResolveOrientation("passthrough")
  );

  const reviewCard = osCardReviewCard(card);
  const fieldNodes = osIndexReviewFieldNodes(reviewCard);

  const applied = [];
  const skipped = [];
  const keys = OS_ANALYZE_LIST_FIELDS.concat(["notes"]);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const node = osResolveReviewFieldNode(reviewCard, fieldNodes, key);
    if (!node) continue;
    const placeholder = OS_REVIEW_PLACEHOLDERS[key];
    if (typeof placeholder !== "string") continue;
    const ok = await osSetTextNodeCharacters(
      node,
      placeholder,
      tokens.reviewPlaceholderColor
    );
    if (ok) {
      osClearTextListOptions(node);
      applied.push(OS_ANALYZE_FIELD_LABELS[key] || key);
    } else skipped.push(OS_ANALYZE_FIELD_LABELS[key] || key);
  }

  return {
    operation: "resetReview",
    sectionId: sectionId,
    cardId: cardId,
    cardName: osCardDisplayName(card),
    applied: applied,
    skipped: skipped,
    engineVersion: OS_ENGINE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Functional Analysis: Create Documentation apply/reset/resolve (mirror of the
// design-review analyze path, gated on the Functional Card surface).
// ---------------------------------------------------------------------------

// True when a functional field's verbatim text is real (non-empty, not the
// registry placeholder for that key). Mirrors osReviewFieldIsRealText.
function osFuncFieldIsRealText(text, fieldKey) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed.length) return false;
  const placeholder = OS_FUNCTIONAL_PLACEHOLDERS[fieldKey];
  return trimmed !== (placeholder || "");
}

// Does this card already have real functional documentation text?
function osFuncExistingContent(card) {
  let hasContent = false;
  const fields = osExtractFuncFields(card);
  if (fields) {
    for (const key in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      if (osFuncFieldIsRealText(fields[key], key)) {
        hasContent = true;
        break;
      }
    }
  }
  return { hasContent: hasContent };
}

// Index every tagged functional field TEXT node by its key. Mirrors
// osIndexReviewFieldNodes.
function osIndexFuncFieldNodes(funcCard) {
  const map = {};
  if (!funcCard) return map;
  const stack = [funcCard];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === "TEXT") {
      let key = "";
      try {
        key = node.getSharedPluginData(OS_REVIEW_NAMESPACE, OS_FUNC_FIELD_KEY);
      } catch (e) {}
      if (key && !map[key]) map[key] = node;
    }
    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }
  return map;
}

// Structural fallback: find the "Functional Field Text" node for a key via its
// "Functional Section / <key>" frame, independent of plugin-data tags.
function osFindFuncFieldNodeByName(funcCard, fieldKey) {
  if (!funcCard || !("children" in funcCard)) return null;
  const sectionName = "Functional Section / " + fieldKey;
  const stack = [funcCard];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === "FRAME" && node.name === sectionName) {
      return osFindDescendantTextByName(node, "Functional Field Text");
    }
    if ("children" in node) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }
  return null;
}

// Resolve a functional field's editable TEXT node: prefer the tag index, then
// fall back to the structural lookup. Mirrors osResolveReviewFieldNode.
function osResolveFuncFieldNode(funcCard, fieldNodes, fieldKey) {
  if (fieldNodes && fieldNodes[fieldKey]) return fieldNodes[fieldKey];
  return osFindFuncFieldNodeByName(funcCard, fieldKey);
}

// Authoritative mode signal: a Functional Card's ACTUAL structure. A single
// `functionalDoc` field => Advanced; otherwise the 8 section fields => Basic.
// Used by apply/reset (so stale metadata can never write to the wrong shape)
// and by the Create Documentation resolvers (so the runtime binding requests
// the matching prompt + token ceiling). Tag index first, structural fallback
// second, so a tag-stripped card still resolves.
function osFunctionalCardMode(funcCard) {
  if (!funcCard) return "basic";
  const nodes = osIndexFuncFieldNodes(funcCard);
  if (nodes[OS_FUNCTIONAL_DOC_KEY]) return "advanced";
  if (osFindFuncFieldNodeByName(funcCard, OS_FUNCTIONAL_DOC_KEY)) {
    return "advanced";
  }
  return "basic";
}

// True when a board still has at least one Functional Card on canvas (the
// authoritative signal when metadata/marker are stale). Mirrors
// osBoardHasDesignReviewSurface.
function osBoardHasFunctionalSurface(container) {
  if (!container) return false;
  const grid = osFindGrid(container);
  const scope = grid || container;
  const cards = osCollectCardsInGrid(scope);
  // Bounded per-card scan: osBuildProbeCardEntry treats the embedded user
  // screen as a leaf, so this never descends into a card's design subtree.
  // A Functional Card only ever lives in the card layout, so pruning the
  // embedded screen is safe and turns ~200ms/card inference into ~0. This is
  // the only structural signal when the boardType marker is missing.
  for (let i = 0; i < cards.length; i++) {
    if (osBuildProbeCardEntry(cards[i]).functionalCard) return true;
  }
  return false;
}

// Structural functional mode for a whole board: the first Functional Card's
// structure (Advanced single doc vs Basic 8 fields), or null when the board has
// no Functional Card. Used as the edit-form fallback when metadata is missing
// or stale.
function osBoardFunctionalMode(container) {
  if (!container) return null;
  const grid = osFindGrid(container);
  const scope = grid || container;
  const cards = osCollectCardsInGrid(scope);
  for (let i = 0; i < cards.length; i++) {
    const fc = osBuildProbeCardEntry(cards[i]).functionalCard;
    if (fc) return osFunctionalCardMode(fc);
  }
  return null;
}

// Resolve the Create Documentation card target for the current selection.
// Mirrors osResolveAnalyzeDesignTarget, gated on the Functional Card surface.
function osResolveCreateDocumentationTarget() {
  if (figma.editorType && figma.editorType !== "figma") {
    return { eligible: false, reason: "Create Documentation runs in the Figma editor only." };
  }
  const sel = (figma.currentPage && figma.currentPage.selection) || [];
  if (!sel.length) {
    return { eligible: false, reason: "Select a screen card on a Functional Analysis board." };
  }
  const boards = osResolveSelectedBoards(sel);
  if (boards.length !== 1) {
    return {
      eligible: false,
      reason: "Select a single screen card on one Functional Analysis board.",
    };
  }
  const root = boards[0];

  let card = null;
  for (let i = 0; i < sel.length; i++) {
    const found = osFindScreenCard(sel[i]);
    if (found) {
      card = found;
      break;
    }
  }
  if (!card) {
    return {
      eligible: false,
      reason: "Select one screen card (not the whole board) to document.",
    };
  }

  const frame = osCardEmbeddedFrame(card);
  if (!frame) {
    return { eligible: false, reason: "This card has no embedded screen to document." };
  }
  const funcCard = osCardFunctionalCard(card);
  if (!funcCard) {
    return {
      eligible: false,
      reason: "Create Documentation needs a Functional Analysis card. Switch the board to Functional Analysis first.",
    };
  }

  const content = osFuncExistingContent(card);
  return {
    eligible: true,
    sectionId: root.section.id,
    cardId: card.id,
    frameId: frame.id,
    cardName: osCardDisplayName(card),
    frameName: frame.name || "",
    boardType: "functional-analysis",
    // Mode the runtime should request (structure-derived, so it always matches
    // what will be written back).
    mode: osFunctionalCardMode(funcCard),
    hasExistingContent: content.hasContent,
  };
}

// Section-scope documentation target: every Functional Analysis screen in one
// selected board. Mirrors osResolveAnalyzeDesignSectionTarget.
// Optional `index` (probe-only fast path) mirrors
// osResolveAnalyzeDesignSectionTarget: a prebuilt osBuildProbeCardIndex avoids
// re-walking each card. The apply path calls this with no arg (unchanged).
function osResolveCreateDocumentationSectionTarget(index) {
  if (figma.editorType && figma.editorType !== "figma") {
    return { eligible: false, reason: "Create Documentation runs in the Figma editor only." };
  }
  const sel = (figma.currentPage && figma.currentPage.selection) || [];
  if (!sel.length) {
    return { eligible: false, reason: "Select a Functional Analysis section to document its screens." };
  }
  const boards = osResolveSelectedBoards(sel);
  if (boards.length !== 1) {
    return { eligible: false, reason: "Select a single Functional Analysis section." };
  }
  const root = boards[0];
  const container = root.container || osFindContainerInSection(root.section);
  const useIndex = index && index.container === container;
  const hasSurface = useIndex
    ? index.hasFunctionalSurface
    : osBoardHasFunctionalSurface(container);
  if (!hasSurface) {
    return {
      eligible: false,
      reason: "Section documentation needs a Functional Analysis board. Switch the board to Functional Analysis first.",
    };
  }

  const grid = useIndex ? index.grid : osFindGrid(container);
  const cards = useIndex ? index.cards : osCollectCardsInGrid(grid || container);
  const screens = [];
  // Mode is board-level: the first Functional Card's structure decides it for
  // the whole section.
  let mode = null;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const entry = useIndex ? index.byId[card.id] : null;
    const frame = entry ? entry.embeddedFrame : osCardEmbeddedFrame(card);
    if (!frame) continue;
    const functionalCard = entry ? entry.functionalCard : osCardFunctionalCard(card);
    if (!functionalCard) continue;
    if (mode === null) mode = osFunctionalCardMode(functionalCard);
    screens.push({
      cardId: card.id,
      frameId: frame.id,
      cardName: entry ? osEntryDisplayName(entry) : osCardDisplayName(card),
      frameName: frame.name || "",
    });
  }

  if (!screens.length) {
    return {
      eligible: false,
      reason: "No Functional Analysis screens found in this section.",
    };
  }

  return {
    eligible: true,
    sectionId: root.section.id,
    sectionName: root.section.name || "",
    boardType: "functional-analysis",
    mode: mode || "basic",
    screens: screens,
    screenCount: screens.length,
  };
}

// Build a lightweight cross-screen "journey" context for one Functional
// Analysis section: the ordered set of functional screens plus any Flow arrow
// connections/labels. Fed into each per-screen Advanced documentation prompt so
// the model treats the batch as one connected user journey instead of reporting
// downstream screens as unavailable. Read-only; meant to be called once per run
// (resolves the section by id), so the hot selection-probe resolvers stay
// untouched. Returns { screens: [{cardId,name}], edges: [{from,to,trigger?}] }.
async function osBuildFunctionalJourneyContext(sectionId) {
  const empty = { screens: [], edges: [] };
  if (figma.editorType && figma.editorType !== "figma") return empty;
  if (!sectionId) return empty;

  let section = null;
  try {
    section = await figma.getNodeByIdAsync(sectionId);
  } catch (e) {
    section = null;
  }
  if (!section || section.removed) return empty;

  const container =
    section.type === "SECTION" ? osFindContainerInSection(section) : section;
  if (!container) return empty;

  const grid = osFindGrid(container);
  const cards = osCollectCardsInGrid(grid || container);

  // Ordered functional screens (grid order) + frameId -> entry index.
  const ordered = [];
  const byFrameId = {};
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const frame = osCardEmbeddedFrame(card);
    if (!frame) continue;
    const funcCard = osCardFunctionalCard(card);
    if (!funcCard) continue;
    const entry = {
      cardId: card.id,
      frameId: frame.id,
      name: osCardDisplayName(card),
    };
    ordered.push(entry);
    byFrameId[frame.id] = entry;
  }
  if (!ordered.length) return empty;

  const meta = osReadBoardMetadata(container);
  const settings = (meta && meta.settings) || {};
  const flowOn = settings.flow === true;
  const flowFrameIds = Array.isArray(settings.flowFrameIds)
    ? settings.flowFrameIds
    : null;

  // Ordered flow sequence, mirroring osBuildFlowOverlay so any collected labels
  // line up with the same arrows: scoped survivors (>=2) when present, else the
  // full grid sequence when flow is on, else no sequence.
  let sequence = [];
  if (flowOn) {
    if (flowFrameIds) {
      const scoped = [];
      for (let i = 0; i < flowFrameIds.length; i++) {
        const e = byFrameId[String(flowFrameIds[i])];
        if (e) scoped.push(e);
      }
      sequence = scoped.length >= 2 ? scoped : ordered.slice();
    } else {
      sequence = ordered.slice();
    }
  }

  const edges = [];
  if (sequence.length >= 2) {
    const labels = osCollectFlowLabels(container);
    // Only trust labels when their count matches the arrows this sequence
    // implies; a mismatch means the live overlay is stale (e.g. a screen was
    // deleted without a recompose), so drop triggers rather than misattribute.
    const useLabels =
      Array.isArray(labels) && labels.length === sequence.length - 1;
    for (let i = 0; i < sequence.length - 1; i++) {
      const edge = { from: sequence[i].name, to: sequence[i + 1].name };
      if (useLabels) {
        const t = typeof labels[i] === "string" ? labels[i].trim() : "";
        if (t && t !== "Describe interaction ...") edge.trigger = t;
      }
      edges.push(edge);
    }
  }

  // screens[] = ALL functional screens (flow sequence first, then any remaining
  // grid-order screens) so none are missing from "the set".
  const screens = [];
  const seen = {};
  for (let i = 0; i < sequence.length; i++) {
    const e = sequence[i];
    if (seen[e.cardId]) continue;
    seen[e.cardId] = true;
    screens.push({ cardId: e.cardId, name: e.name });
  }
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    if (seen[e.cardId]) continue;
    seen[e.cardId] = true;
    screens.push({ cardId: e.cardId, name: e.name });
  }

  return { screens: screens, edges: edges };
}

// Collect the Advanced functional documentation for export (read-only). Scope
// follows the live selection: when one or more Screen Cards are selected, only
// those are exported; when just the board/section is selected, every card is.
// Advanced-only — Basic cards have no single markdown document, so a board with
// no Advanced Functional Card is reported ineligible. Returns each card's name
// + markdown so the runtime can hand plain strings to the UI (which builds the
// zip + download). Empty/placeholder docs are skipped.
function osCollectFunctionalDocuments() {
  if (figma.editorType && figma.editorType !== "figma") {
    return { eligible: false, reason: "Export runs in the Figma editor only." };
  }
  const sel = (figma.currentPage && figma.currentPage.selection) || [];
  if (!sel.length) {
    return {
      eligible: false,
      reason: "Select a Functional Analysis board (or some of its cards) to export.",
    };
  }
  const boards = osResolveSelectedBoards(sel);
  if (boards.length !== 1) {
    return { eligible: false, reason: "Select a single Functional Analysis board." };
  }
  const root = boards[0];
  const container = root.container || osFindContainerInSection(root.section);
  if (!container) {
    return { eligible: false, reason: "This board has no content to export." };
  }

  // Cards explicitly selected (dedup by id). Empty => whole-board scope.
  const selectedCards = [];
  const seenSelected = {};
  for (let i = 0; i < sel.length; i++) {
    const card = osFindScreenCard(sel[i]);
    if (card && !seenSelected[card.id]) {
      seenSelected[card.id] = true;
      selectedCards.push(card);
    }
  }
  let cards;
  if (selectedCards.length) {
    cards = selectedCards;
  } else {
    const grid = osFindGrid(container);
    cards = osCollectCardsInGrid(grid || container);
  }

  let hasAdvanced = false;
  const documents = [];
  const placeholder = OS_FUNCTIONAL_PLACEHOLDERS[OS_FUNCTIONAL_DOC_KEY];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const funcCard = osCardFunctionalCard(card);
    if (!funcCard) continue;
    if (osFunctionalCardMode(funcCard) !== "advanced") continue;
    hasAdvanced = true;
    const fieldNodes = osIndexFuncFieldNodes(funcCard);
    const docNode = osResolveFuncFieldNode(
      funcCard,
      fieldNodes,
      OS_FUNCTIONAL_DOC_KEY
    );
    if (!docNode || docNode.type !== "TEXT") continue;
    const text = typeof docNode.characters === "string" ? docNode.characters : "";
    const trimmed = text.trim();
    if (!trimmed || trimmed === placeholder) continue;
    documents.push({
      cardId: card.id,
      name: osCardDisplayName(card),
      document: text,
    });
  }

  if (!hasAdvanced) {
    return {
      eligible: false,
      reason: "Export is only available for Advanced functional analysis.",
    };
  }

  return {
    eligible: true,
    sectionName: root.section.name || "",
    documents: documents,
  };
}

// Apply a validated FunctionalAnalysisV1 to a card's Functional Card fields.
// Re-resolves nodes by id (never trusts references across the network await).
// Overwrites each field the model returned content for (matching the shipped
// Analyze Design overwrite-and-warn behavior). Mirrors osApplyDesignReviewAnalysis.
async function osApplyFunctionalAnalysis(sectionId, cardId, analysis) {
  if (figma.editorType && figma.editorType !== "figma") {
    throw new Error("Create Documentation is only available in Figma design files.");
  }
  if (!analysis || typeof analysis !== "object") {
    throw new Error("No documentation result to apply.");
  }

  const card = await osResolveScreenCardById(cardId);

  const tokens = osResolveTokens(
    OS_BASE_TOKENS,
    osResolveBoardType("functional-analysis"),
    osResolveOrientation("passthrough")
  );

  const funcCard = osCardFunctionalCard(card);
  const fieldNodes = osIndexFuncFieldNodes(funcCard);

  const applied = [];
  const skipped = [];

  // Branch on the card's actual structure (authoritative mode signal), not on
  // the analysis shape, so a stale/mismatched result can never write into the
  // wrong structure.
  const structuralMode = osFunctionalCardMode(funcCard);
  if (structuralMode === "advanced") {
    const docNode = osResolveFuncFieldNode(
      funcCard,
      fieldNodes,
      OS_FUNCTIONAL_DOC_KEY
    );
    const docText =
      typeof analysis.document === "string" ? analysis.document.trim() : "";
    const label = OS_FUNCTIONAL_FIELD_LABELS[OS_FUNCTIONAL_DOC_KEY];
    if (docText) {
      if (!docNode) {
        skipped.push(label);
      } else {
        const ok = await osSetTextNodeCharacters(docNode, docText, tokens.textColor);
        if (ok) applied.push(label);
        else skipped.push(label);
      }
    }
  } else {
    for (let i = 0; i < OS_FUNCTIONAL_SECTION_KEYS.length; i++) {
      const key = OS_FUNCTIONAL_SECTION_KEYS[i];
      const list = Array.isArray(analysis[key]) ? analysis[key] : [];
      const text = osJoinAnalysisBullets(list);
      if (!text) continue;
      const node = osResolveFuncFieldNode(funcCard, fieldNodes, key);
      if (!node) {
        skipped.push(OS_FUNCTIONAL_FIELD_LABELS[key] || key);
        continue;
      }
      const ok = await osSetTextNodeCharacters(node, text, tokens.textColor);
      if (ok) applied.push(OS_FUNCTIONAL_FIELD_LABELS[key] || key);
      else skipped.push(OS_FUNCTIONAL_FIELD_LABELS[key] || key);
    }
  }

  // Confidence note (header): a muted single line, written only when present.
  const confidence =
    analysis.meta && typeof analysis.meta === "object"
      ? analysis.meta.confidence
      : "";
  if (confidence === "low" || confidence === "medium" || confidence === "high") {
    const confNode = osResolveFuncFieldNode(
      funcCard,
      fieldNodes,
      OS_FUNCTIONAL_HEADER.confidenceKey
    );
    if (confNode) {
      // Heal boards built before the hug fix: a stale FILL/HEIGHT confidence
      // node has ~0 width and would wrap the text vertically. Re-assert hug.
      osMakeTextHug(confNode);
      await osSetTextNodeCharacters(
        confNode,
        "Confidence: " + confidence,
        tokens.mutedTextColor
      );
    }
  }

  return {
    operation: "document",
    sectionId: sectionId,
    cardId: cardId,
    cardName: osCardDisplayName(card),
    applied: applied,
    skipped: skipped,
    engineVersion: OS_ENGINE_VERSION,
  };
}

// Reset every functional section field back to its registry placeholder, in
// the muted placeholder color, and clear the confidence note. Offline (no
// network). Writing the byte-exact placeholder is required so extraction
// re-classifies the field as empty on a later recompose. Mirrors
// osResetDesignReviewFields.
async function osResetFunctionalFields(sectionId, cardId) {
  if (figma.editorType && figma.editorType !== "figma") {
    throw new Error("Reset documentation is only available in Figma design files.");
  }

  const card = await osResolveScreenCardById(cardId);

  const tokens = osResolveTokens(
    OS_BASE_TOKENS,
    osResolveBoardType("functional-analysis"),
    osResolveOrientation("passthrough")
  );

  const funcCard = osCardFunctionalCard(card);
  const fieldNodes = osIndexFuncFieldNodes(funcCard);

  const applied = [];
  const skipped = [];

  // Reset whatever structure was actually built (authoritative mode signal):
  // the single Advanced doc field, or the 8 Basic section fields.
  const resetKeys =
    osFunctionalCardMode(funcCard) === "advanced"
      ? [OS_FUNCTIONAL_DOC_KEY]
      : OS_FUNCTIONAL_SECTION_KEYS;
  for (let i = 0; i < resetKeys.length; i++) {
    const key = resetKeys[i];
    const node = osResolveFuncFieldNode(funcCard, fieldNodes, key);
    if (!node) continue;
    const placeholder = OS_FUNCTIONAL_PLACEHOLDERS[key];
    if (typeof placeholder !== "string") continue;
    const ok = await osSetTextNodeCharacters(
      node,
      placeholder,
      tokens.reviewPlaceholderColor
    );
    if (ok) applied.push(OS_FUNCTIONAL_FIELD_LABELS[key] || key);
    else skipped.push(OS_FUNCTIONAL_FIELD_LABELS[key] || key);
  }

  // Clear the confidence note too.
  const confNode = osResolveFuncFieldNode(
    funcCard,
    fieldNodes,
    OS_FUNCTIONAL_HEADER.confidenceKey
  );
  if (confNode) {
    await osSetTextNodeCharacters(confNode, "", tokens.mutedTextColor);
  }

  return {
    operation: "resetDocumentation",
    sectionId: sectionId,
    cardId: cardId,
    cardName: osCardDisplayName(card),
    applied: applied,
    skipped: skipped,
    engineVersion: OS_ENGINE_VERSION,
  };
}

// Trim a long description into a short section title (2-5 words).
function osDeriveSectionTitleFromText(text) {
  if (!text || typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  const first = trimmed.split(/[.!?\n]/)[0].trim();
  if (!first) return "";
  const words = first.split(/\s+/);
  if (words.length <= 5) return first;
  return words.slice(0, 5).join(" ");
}

// After section-scope Describe, read live Card Description text from each screen
// card. Canvas text is canonical after apply — more reliable than reusing the
// in-memory validation payload across network awaits.
async function osCollectSectionDescribeSummaries(screens) {
  const out = [];
  if (!Array.isArray(screens)) return out;
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    if (!s || !s.cardId) continue;
    const card = await figma.getNodeByIdAsync(s.cardId);
    if (!card || card.removed) continue;
    const descNode = osFindDescendantTextByName(card, "Card Description");
    const text =
      descNode && typeof descNode.characters === "string"
        ? descNode.characters.trim()
        : "";
    if (!text) continue;
    const name =
      (s.cardName && String(s.cardName)) ||
      osCardDisplayName(card) ||
      "Screen " + (i + 1);
    out.push({ name: name, description: text });
  }
  return out;
}

// Per-screen summaries for the section-meta synthesis on a Functional Analysis
// board. Mirrors osCollectSectionDescribeSummaries, but reads the Functional
// Card instead of the Card Description — Functional boards never fill the Card
// Description, so that node is empty here. Mode-aware: Advanced cards return
// their long-form document; Basic cards return the filled section fields joined
// as "label: value" lines. The text is capped so a multi-screen section stays
// within the section-meta call's token budget; a prefix is plenty to synthesize
// an Overview Header title + description. Placeholders and empty fields are
// skipped. Lets the documentation run fill Section Title / Section Description
// the same way the Describe action does for Design Review boards.
async function osCollectSectionFunctionalSummaries(screens) {
  const out = [];
  if (!Array.isArray(screens)) return out;
  const MAX_DOC_CHARS = 1200;
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    if (!s || !s.cardId) continue;
    const card = await figma.getNodeByIdAsync(s.cardId);
    if (!card || card.removed) continue;
    const funcCard = osCardFunctionalCard(card);
    if (!funcCard) continue;
    const fieldNodes = osIndexFuncFieldNodes(funcCard);

    let text = "";
    if (osFunctionalCardMode(funcCard) === "advanced") {
      const docNode = osResolveFuncFieldNode(
        funcCard,
        fieldNodes,
        OS_FUNCTIONAL_DOC_KEY
      );
      if (docNode && docNode.type === "TEXT") {
        const docText =
          typeof docNode.characters === "string"
            ? docNode.characters.trim()
            : "";
        if (docText && docText !== OS_FUNCTIONAL_PLACEHOLDERS[OS_FUNCTIONAL_DOC_KEY]) {
          text = docText;
        }
      }
    } else {
      // Basic: join the filled section fields as "label: value" lines so the
      // synthesis has structured per-screen context (the 8 functional fields).
      const parts = [];
      for (let k = 0; k < OS_FUNCTIONAL_SECTION_KEYS.length; k++) {
        const key = OS_FUNCTIONAL_SECTION_KEYS[k];
        const node = osResolveFuncFieldNode(funcCard, fieldNodes, key);
        if (!node || node.type !== "TEXT") continue;
        const val =
          typeof node.characters === "string" ? node.characters.trim() : "";
        if (!val || val === OS_FUNCTIONAL_PLACEHOLDERS[key]) continue;
        const label = OS_FUNCTIONAL_FIELD_LABELS[key] || key;
        parts.push(label + ": " + val);
      }
      text = parts.join("\n");
    }

    if (!text) continue;
    if (text.length > MAX_DOC_CHARS) text = text.slice(0, MAX_DOC_CHARS);
    const name =
      (s.cardName && String(s.cardName)) ||
      osCardDisplayName(card) ||
      "Screen " + (i + 1);
    out.push({ name: name, description: text });
  }
  return out;
}

// Offline fallback when the section-meta AI call fails or omits a title.
function osBuildSectionMetaFallback(descriptions) {
  if (!descriptions || !descriptions.length) return null;
  let sectionDescription = "";
  if (descriptions.length === 1) {
    sectionDescription = descriptions[0].description;
  } else {
    const parts = [];
    for (let i = 0; i < descriptions.length; i++) {
      parts.push(descriptions[i].name + ": " + descriptions[i].description);
    }
    sectionDescription = parts.join(" ");
  }
  let sectionTitle = osDeriveSectionTitleFromText(descriptions[0].description);
  if (!sectionTitle) sectionTitle = descriptions[0].name;
  if (descriptions.length > 1) {
    const broader = osDeriveSectionTitleFromText(sectionDescription);
    if (broader) sectionTitle = broader;
  }
  return {
    sectionTitle: sectionTitle,
    sectionDescription: sectionDescription,
  };
}

// Write the section's Overview Header "Section Title" / "Section Description"
// TEXT nodes (used by the section-scope Describe action). Re-resolves the
// section by id, writes live nodes in the same colors the header build uses
// (title -> textColor, description -> mutedTextColor). Recompose reuses these
// live values (engine.js osRecompose section-copy resolution), so no baseline
// write is needed. Only writes fields the caller actually provides.
async function osApplySectionMeta(sectionId, meta) {
  if (figma.editorType && figma.editorType !== "figma") {
    throw new Error("Section summary is only available in Figma design files.");
  }
  if (!meta || typeof meta !== "object") {
    throw new Error("No section summary to apply.");
  }

  const section = await figma.getNodeByIdAsync(sectionId);
  if (!section || section.removed || section.type !== "SECTION") {
    throw new Error("The section is no longer on the canvas.");
  }
  const container = osFindContainerInSection(section);
  const header = container ? osFindHeader(container) : null;
  if (!header) {
    throw new Error("This section has no Overview Header to update.");
  }

  const tokens = osResolveTokens(
    OS_BASE_TOKENS,
    osResolveBoardType("design-review"),
    osResolveOrientation("passthrough")
  );

  const applied = [];
  const skipped = [];

  let title = typeof meta.sectionTitle === "string" ? meta.sectionTitle.trim() : "";
  const desc =
    typeof meta.sectionDescription === "string" ? meta.sectionDescription.trim() : "";

  // Synthesis sometimes returns a description without a title; derive one so
  // the Overview Header never stays at the compose default ("Screen Overview").
  if (!title && desc) {
    title = osDeriveSectionTitleFromText(desc);
  }

  if (title) {
    const titleNode = osFindNamedTextChild(header, "Section Title");
    if (titleNode) {
      const ok = await osSetTextNodeCharacters(titleNode, title, tokens.textColor);
      if (ok) {
        applied.push("Section title");
        try {
          section.name = title;
        } catch (e) {}
      } else skipped.push("Section title");
    } else {
      skipped.push("Section title");
    }
  }

  if (desc) {
    const descNode = osFindNamedTextChild(header, "Section Description");
    if (descNode) {
      const ok = await osSetTextNodeCharacters(descNode, desc, tokens.mutedTextColor);
      if (ok) applied.push("Section description");
      else skipped.push("Section description");
    } else {
      skipped.push("Section description");
    }
  }

  const descNodeLayout = osFindNamedTextChild(header, "Section Description");
  if (descNodeLayout) {
    osApplySectionDescriptionWidth(descNodeLayout, tokens.sectionDescriptionMaxWidth);
  }

  return {
    operation: "sectionMeta",
    sectionId: sectionId,
    sectionName: section.name || "",
    applied: applied,
    skipped: skipped,
    engineVersion: OS_ENGINE_VERSION,
  };
}

// Skip invisible instance children only while probing. Embedded screen designs
// are often component instances; descending into their hidden children makes
// every per-card subtree walk (functional/review card lookup, review-field
// extraction) traverse thousands of nodes and lags the canvas on selection.
// The probe only reads visible plugin-created frames, so this is safe here.
// Scoped (save/restore) so MCP node-inspection and recompose paths are
// unaffected; restored in finally so a throwing probe cannot leak the flag.
function osProbeOrganizeScreensContext() {
  const prevSkipInvisible = figma.skipInvisibleInstanceChildren;
  figma.skipInvisibleInstanceChildren = true;
  try {
    return osProbeOrganizeScreensContextImpl();
  } finally {
    figma.skipInvisibleInstanceChildren = prevSkipInvisible;
  }
}

function osProbeOrganizeScreensContextImpl() {
  const result = osProbeOrganizeScreensContextCore();
  if (result && typeof result === "object") {
    const sel = (figma.currentPage && figma.currentPage.selection) || [];
    result.flowEligible = osComputeFlowEligible(sel);

    // Selective-flow preview (edit mode): surface how an Apply with flow ON
    // would scope, so the panel can tell the user before they commit. Reuses
    // the same tri-state resolver the apply path uses.
    if (result.mode === "edit") {
      const editBoards = osResolveSelectedBoards(sel);
      if (editBoards.length === 1) {
        const scope = osResolveSelectedFlowScope(editBoards[0].container);
        result.flowWouldScope = scope.action === "set";
        result.flowScopeCount = scope.action === "set" ? scope.ids.length : 0;
      } else {
        result.flowWouldScope = false;
        result.flowScopeCount = 0;
      }
    }

    // Capability model: the engine is the single source of truth. We push the
    // full per-board-type map (so the UI can react to the board-type dropdown
    // in compose mode before any board exists) plus the capabilities for the
    // currently resolved/edited board type. The UI never hardcodes these.
    result.capabilitiesByBoardType = osAllBoardTypeCapabilities();
    const editedBoardType =
      result.board && result.board.settings && result.board.settings.boardType
        ? result.board.settings.boardType
        : "custom";
    result.capabilities = osBoardTypeCapabilities(editedBoardType);

    // Single-pass card index (probe-only fast path). The section eligibility
    // resolvers below would otherwise walk each card's subtree ~4× (embedded
    // frame + review/functional card + framework + display name). Build one
    // bounded index for the resolved board here and pass it in, so every card
    // is walked once and the embedded user screens are treated as leaves.
    let probeCardIndex = null;
    if (
      editedBoardType === "design-review" ||
      editedBoardType === "functional-analysis"
    ) {
      const probeBoards = osResolveSelectedBoards(sel);
      if (probeBoards.length === 1) {
        const probeContainer =
          probeBoards[0].container ||
          osFindContainerInSection(probeBoards[0].section);
        if (probeContainer) {
          probeCardIndex = osBuildProbeCardIndex(probeContainer);
        }
      }
    }

    // Analyze Design eligibility (presentation only; the runtime re-resolves
    // the target at run time). Trimmed to what the UI renders. A single card
    // selection is card-scoped; otherwise a Design Review section is
    // section-scoped (all its standard review screens).
    //
    // Board-type gate: the eligible path requires the selection to resolve to a
    // single board, which is exactly when the probe is in `edit` mode, so a
    // Design Review surface can only exist when editedBoardType is
    // "design-review". On any other board type the resolvers would scan the
    // whole board only to return eligible:false — skip that scan. `reason` is
    // diagnostic only (the panel renders eligibility/target/screenCount), so the
    // gated-off copy can be generic.
    if (editedBoardType === "design-review") {
      const ad = osResolveAnalyzeDesignTarget();
      if (ad.eligible === true) {
        result.analyzeDesign = {
          eligible: true,
          target: "card",
          sectionId: ad.sectionId,
          cardId: ad.cardId,
          frameId: ad.frameId,
          cardName: ad.cardName,
          frameworkId: ad.frameworkId,
          boardType: ad.boardType,
          hasExistingContent: ad.hasExistingContent === true,
        };
      } else {
        const sectionTarget = osResolveAnalyzeDesignSectionTarget(probeCardIndex);
        if (sectionTarget.eligible === true) {
          result.analyzeDesign = {
            eligible: true,
            target: "section",
            sectionId: sectionTarget.sectionId,
            sectionName: sectionTarget.sectionName,
            boardType: sectionTarget.boardType,
            screenCount: sectionTarget.screenCount,
          };
        } else {
          result.analyzeDesign = {
            eligible: false,
            reason: ad.reason,
          };
        }
      }
    } else {
      result.analyzeDesign = {
        eligible: false,
        reason: "Select a screen card on a Design Review board.",
      };
    }

    // Create Documentation eligibility (Functional Analysis surface). Mutually
    // exclusive with Analyze Design by surface — a Functional Analysis board has
    // no review surface and vice versa — so no priority arbitration is needed.
    // Card scope when one Functional Card is selected; otherwise section scope.
    //
    // Board-type gate: same reasoning as Analyze Design above — a Functional
    // surface only exists when editedBoardType is "functional-analysis", so on
    // any other board type we skip the full-board scan and return ineligible.
    if (editedBoardType === "functional-analysis") {
      const cd = osResolveCreateDocumentationTarget();
      if (cd.eligible === true) {
        result.createDocumentation = {
          eligible: true,
          target: "card",
          sectionId: cd.sectionId,
          cardId: cd.cardId,
          frameId: cd.frameId,
          cardName: cd.cardName,
          boardType: cd.boardType,
          mode: cd.mode,
          hasExistingContent: cd.hasExistingContent === true,
        };
      } else {
        const cdSection = osResolveCreateDocumentationSectionTarget(probeCardIndex);
        if (cdSection.eligible === true) {
          result.createDocumentation = {
            eligible: true,
            target: "section",
            sectionId: cdSection.sectionId,
            sectionName: cdSection.sectionName,
            boardType: cdSection.boardType,
            mode: cdSection.mode,
            screenCount: cdSection.screenCount,
          };
        } else {
          result.createDocumentation = {
            eligible: false,
            reason: cd.reason,
          };
        }
      }
    } else {
      result.createDocumentation = {
        eligible: false,
        reason: "Select a screen card on a Functional Analysis board.",
      };
    }
  }
  return result;
}

// Resolve the distinct plugin boards touched by a selection. Each selected
// node is walked up to its board root (SECTION + Section Container); only
// genuine plugin boards resolve, so free frames / user sections yield nothing.
function osResolveSelectedBoards(sel) {
  const seen = {};
  const roots = [];
  for (let i = 0; i < sel.length; i++) {
    const root = osFindBoardRoot(sel[i]);
    if (root && root.section && !seen[root.section.id]) {
      seen[root.section.id] = true;
      roots.push(root);
    }
  }
  return roots;
}

// Build an `edit` context for a resolved board root, or null when the root is
// not a recognizable plugin board.
//
// All recognized boards are MODERN. Board Type is the single source of truth:
// it comes from the full metadata envelope when present, else from the tiny
// boardType marker, else defaults to "custom". A board is NEVER classified as
// "legacy" just because its metadata could not be read — absence of metadata
// is treated as a modern board shown with safe defaults, not a legacy board.
// True when the board still has at least one Design Review Review Card on
// canvas (the authoritative signal when metadata/marker are stale or missing).
function osBoardHasDesignReviewSurface(container) {
  if (!container) return false;
  const grid = osFindGrid(container);
  const scope = grid || container;
  const cards = osCollectCardsInGrid(scope);
  // Bounded per-card scan (see osBoardHasFunctionalSurface): a Review Card only
  // lives in the card layout, so osBuildProbeCardEntry's embedded-screen prune
  // keeps marker-less board-type inference cheap without descending into the
  // user's design subtree.
  for (let i = 0; i < cards.length; i++) {
    if (osBuildProbeCardEntry(cards[i]).reviewCard) return true;
  }
  return false;
}

// Resolve the board type shown in edit mode. Order: tiny boardType marker,
// stored envelope, then canvas inference (Review Cards present), then review
// settings with enabled=true. Prevents the panel staying on Custom when the
// selected board is visibly a Design Review board.
function osResolveEditBoardSettings(container, metadataSettings) {
  const base = metadataSettings || {
    boardType: "custom",
    orientation: "passthrough",
    annotations: {
      enabled: false,
      mode: "compact",
      position: "belowDescription",
    },
    flow: false,
    review: null,
  };
  let boardType =
    base.boardType === "design-review"
      ? "design-review"
      : base.boardType === "functional-analysis"
      ? "functional-analysis"
      : "custom";
  const marker = osReadBoardTypeMarker(container);
  if (
    marker === "design-review" ||
    marker === "custom" ||
    marker === "functional-analysis"
  ) {
    boardType = marker;
  } else if (osBoardHasFunctionalSurface(container)) {
    boardType = "functional-analysis";
  } else if (osBoardHasDesignReviewSurface(container)) {
    boardType = "design-review";
  } else {
    const review = osNormalizeReviewSettings(base.review, boardType);
    if (review.enabled === true && boardType === "custom") {
      boardType = "design-review";
    }
  }
  // Functional mode: prefer the stored metadata; fall back to the board's
  // actual structure (so the sub-select reflects an Advanced board even when
  // metadata is stale/missing); default basic.
  let functionalMode =
    base.functional && base.functional.mode === "advanced"
      ? "advanced"
      : base.functional && base.functional.mode === "basic"
      ? "basic"
      : null;
  if (!functionalMode) {
    functionalMode = osBoardFunctionalMode(container) || "basic";
  }
  return {
    boardType: boardType,
    orientation: base.orientation,
    annotations: base.annotations,
    flow: base.flow === true,
    review: osNormalizeReviewSettings(base.review, boardType),
    functional: osNormalizeFunctionalSettings({ mode: functionalMode }, boardType),
  };
}

// Count preserved annotation notes (non-empty text) in a metadata baseline so
// the UI can surface an observable "N notes preserved" reassurance.
function osCountPreservedAnnotations(metadata) {
  if (
    !metadata ||
    !metadata.copyBaseline ||
    !Array.isArray(metadata.copyBaseline.cards)
  ) {
    return 0;
  }
  let count = 0;
  for (const c of metadata.copyBaseline.cards) {
    if (
      c &&
      c.annotation &&
      typeof c.annotation === "object" &&
      typeof c.annotation.text === "string" &&
      c.annotation.text.trim().length > 0
    ) {
      count++;
    }
  }
  return count;
}

function osBuildEditContext(root) {
  const metadata = osReadBoardMetadata(root.container);
  if (metadata) {
    const cards = osCollectCardsInGrid(osFindGrid(root.container) || root.container);
    return {
      mode: "edit",
      board: {
        sectionId: root.section.id,
        sectionName: root.section.name,
        cardCount: cards.length,
        recognition: "metadata",
        engineVersion: metadata.engineVersion,
        schemaVersion: metadata.schemaVersion,
        settings: osResolveEditBoardSettings(
          root.container,
          metadata.settings
        ),
        layout: metadata.layout,
        variantGroupCount: Array.isArray(metadata.variantGroups)
          ? metadata.variantGroups.length
          : 0,
        preservedAnnotationCount: osCountPreservedAnnotations(metadata),
      },
    };
  }
  // No readable envelope. As long as the structure matches, treat it as a
  // modern board with safe defaults. Prefer the boardType marker if present.
  if (osStructuralBoardMatch(root.section, root.container)) {
    const cards = osCollectCardsInGrid(osFindGrid(root.container) || root.container);
    const markerType = osReadBoardTypeMarker(root.container);
    return {
      mode: "edit",
      board: {
        sectionId: root.section.id,
        sectionName: root.section.name,
        cardCount: cards.length,
        recognition: markerType ? "marker" : "structural",
        engineVersion: 0,
        schemaVersion: 0,
        settings: osResolveEditBoardSettings(root.container, {
          boardType: markerType || "custom",
          orientation: "passthrough",
          annotations: {
            enabled: false,
            mode: "compact",
            position: "belowDescription",
          },
          flow: false,
          review: null,
        }),
        layout: {
          strategy: "compactGrid",
          columns: 1,
          screenCount: cards.length,
          maxFrameWidth: 0,
        },
        variantGroupCount: 0,
        preservedAnnotationCount: 0,
      },
    };
  }
  return null;
}

function osProbeOrganizeScreensContextCore() {
  if (figma.editorType && figma.editorType !== "figma") {
    return { mode: "unsupported", reason: "non-figma-editor" };
  }
  const sel = (figma.currentPage && figma.currentPage.selection) || [];
  if (!sel.length) {
    return { mode: "idle", reason: "empty-selection" };
  }

  const sectionsInSelection = [];
  const framesInSelection = [];
  for (const n of sel) {
    if (n && n.type === "SECTION") sectionsInSelection.push(n);
    else if (n && n.type === "FRAME") framesInSelection.push(n);
  }

  const boards = osResolveSelectedBoards(sel);

  // 1. Arrange first: 2+ sections, no frames. Checked before edit so a genuine
  //    multi-section "arrange in grid" selection is never shadowed by board
  //    recognition.
  if (sectionsInSelection.length >= 2 && framesInSelection.length === 0) {
    return {
      mode: "arrange",
      sectionCount: sectionsInSelection.length,
    };
  }

  // 2. Edit: the selection resolves to exactly one plugin board (single
  //    section, an inner node, or that board plus incidental non-section
  //    nodes). Prioritized over compose so a board is never re-composed.
  if (boards.length === 1 && sectionsInSelection.length <= 1) {
    const editCtx = osBuildEditContext(boards[0]);
    if (editCtx) return editCtx;
    // Lone plugin SECTION selected but structure/metadata did not resolve —
    // still prefer edit over idle so the panel can show safe defaults.
    if (
      sectionsInSelection.length === 1 &&
      sectionsInSelection[0].id === boards[0].section.id
    ) {
      const root = boards[0];
      const cards = osCollectCardsInGrid(
        osFindGrid(root.container) || root.container
      );
      const markerType = osReadBoardTypeMarker(root.container);
      return {
        mode: "edit",
        board: {
          sectionId: root.section.id,
          sectionName: root.section.name,
          cardCount: cards.length,
          recognition: "structural",
          engineVersion: 0,
          schemaVersion: 0,
          settings: osResolveEditBoardSettings(root.container, {
            boardType: markerType || "custom",
            orientation: "passthrough",
            annotations: {
              enabled: false,
              mode: "compact",
              position: "belowDescription",
            },
            flow: false,
            review: null,
          }),
          layout: {
            strategy: "compactGrid",
            columns: 1,
            screenCount: cards.length,
            maxFrameWidth: 0,
          },
          variantGroupCount: 0,
          preservedAnnotationCount: 0,
        },
      };
    }
  }

  // 3. Compose: frames selected and none belong to a plugin board, so we never
  //    offer to compose a board's own embedded screens (Run would rip them out).
  if (framesInSelection.length > 0 && boards.length === 0) {
    const detected = osDetectVariantGroups(
      osSortFramesLeftToRight(framesInSelection)
    );
    const proposed = [];
    for (let i = 0; i < detected.variantGroups.length; i++) {
      const g = detected.variantGroups[i];
      proposed.push({
        key: g.key,
        label: g.label,
        frameIds: g.frames.map(function (f) {
          return f.id;
        }),
        variantLabels: g.variantLabels.slice(),
        source: g.source,
        confidence: g.confidence,
      });
    }
    return {
      mode: "compose",
      frameCount: framesInSelection.length,
      proposedVariantGroups: proposed,
    };
  }

  // 4. Selection touches plugin board(s) but is ambiguous (inner nodes of 2+
  //    boards, or board internals mixed with extra sections): stay idle rather
  //    than composing board internals.
  if (boards.length >= 1) {
    return { mode: "idle", reason: "ambiguous-board-selection" };
  }

  return { mode: "idle", reason: "unsupported-selection" };
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

async function organizeScreensFromSelection(params) {
  params = params || {};

  if (figma.editorType && figma.editorType !== "figma") {
    throw new Error(
      "Organize Screens is only available in Figma design files."
    );
  }

  // Resolve the Board Type. `boardType` is the primary param; the legacy
  // `personality` / `layoutMode` params are accepted as aliases. A known id
  // ("custom" / "design-review") resolves to its profile; every legacy id
  // collapses to `custom` (osResolveBoardType is total and never throws).
  const profile = osResolveBoardType(
    params.boardType || params.personality || params.layoutMode
  );
  const orientation = osResolveOrientation(params.orientation);
  const tokens = osResolveTokens(OS_BASE_TOKENS, profile, orientation);
  const annotations = osResolveAnnotations(
    profile,
    params.annotations,
    orientation
  );

  const sectionGridGap =
    typeof params.sectionGridGap === "number" && params.sectionGridGap >= 0
      ? params.sectionGridGap
      : tokens.sectionGridGap;

  // Resolve selection — explicit node IDs win, otherwise current selection.
  let targetFrames = [];
  let targetSections = [];
  const rawSelectionSize = Array.isArray(params.nodeIds)
    ? params.nodeIds.length
    : (figma.currentPage.selection || []).length;

  if (Array.isArray(params.nodeIds) && params.nodeIds.length) {
    for (const id of params.nodeIds) {
      const n = await figma.getNodeByIdAsync(id);
      if (!n) continue;
      if (n.type === "FRAME") targetFrames.push(n);
      else if (n.type === "SECTION") targetSections.push(n);
    }
  } else {
    const sel = figma.currentPage.selection || [];
    targetFrames = sel.filter(function (n) { return n.type === "FRAME"; });
    targetSections = sel.filter(function (n) { return n.type === "SECTION"; });
  }

  // Show as flow (in place): draw arrows between the selected screens (or the
  // child screens of each selected section) without composing a board. This
  // is a distinct verb, so it runs before the arrange / compose branches.
  if (params.flowInPlace) {
    const flowAnchor = targetFrames[0] || targetSections[0];
    if (flowAnchor) {
      const ownerPage = osGetPageForNode(flowAnchor);
      if (ownerPage && figma.currentPage !== ownerPage) {
        await figma.setCurrentPageAsync(ownerPage);
      }
    }
    const flowRes = await osDrawFlowInPlace(targetFrames, targetSections, tokens);
    return {
      operation: "flowArrows",
      pageName: figma.currentPage.name,
      arrowCount: flowRes.arrowCount,
      connectedNodeIds: flowRes.connectedNodeIds,
      scope: flowRes.scope,
      engineVersion: OS_ENGINE_VERSION,
    };
  }

  // Multiple presentation Sections → grid layout (no new board).
  if (targetSections.length >= 2 && targetFrames.length === 0) {
    const presentationSections = targetSections.filter(osIsPresentationSection);
    const sectionsToArrange =
      presentationSections.length >= 2 ? presentationSections : targetSections;

    if (sectionsToArrange.length < 2) {
      throw new Error(
        "Select at least two presentation board Sections (with a Section Container inside) to arrange in a grid."
      );
    }

    const ownerPage = osGetPageForNode(sectionsToArrange[0]);
    if (ownerPage && figma.currentPage !== ownerPage) {
      await figma.setCurrentPageAsync(ownerPage);
    }

    // Equalise heights BEFORE positioning so the existing per-row
    // `rowMaxHeight` step (inside osArrangeSectionsInGrid) yields a
    // uniform band across the whole grid. Sections never shrink;
    // locked / non-resizable nodes are reported as `skippedHeightCount`.
    const heightInfo = osEqualizeSectionHeights(sectionsToArrange);
    const columns = osArrangeSectionsInGrid(
      sectionsToArrange,
      sectionGridGap,
      profile,
      tokens,
      orientation
    );
    const skippedCount = Math.max(
      0,
      rawSelectionSize - sectionsToArrange.length
    );

    figma.currentPage.selection = sectionsToArrange;
    if (
      figma.viewport &&
      typeof figma.viewport.scrollAndZoomIntoView === "function"
    ) {
      figma.viewport.scrollAndZoomIntoView(sectionsToArrange);
    }

    return {
      operation: "arrangeSectionsGrid",
      boardType: profile.id,
      orientation: orientation.id,
      pageName: figma.currentPage.name,
      sectionCount: sectionsToArrange.length,
      sectionIds: sectionsToArrange.map(function (s) { return s.id; }),
      sectionNames: sectionsToArrange.map(function (s) { return s.name; }),
      columns: columns,
      sectionGridGap: sectionGridGap,
      sectionHeight: heightInfo.targetHeight,
      skippedHeightCount: heightInfo.skippedCount,
      // Legacy field for compatibility.
      layoutMode: "grid",
      skippedNonSectionCount: skippedCount,
      usedPresentationSectionHeuristic: presentationSections.length >= 2,
      engineVersion: OS_ENGINE_VERSION,
    };
  }

  if (targetSections.length >= 2 && targetFrames.length > 0) {
    throw new Error(
      "Mixed selection: select either multiple Sections to arrange in a grid, or FRAME screens to compose a new board — not both."
    );
  }

  if (!targetFrames.length) {
    throw new Error(
      "Select FRAME screen(s) to compose a presentation board, or select two or more presentation Sections to arrange in a grid."
    );
  }

  targetFrames = osSortFramesLeftToRight(targetFrames);

  // Multi-proposal detection: partition the selection into accepted variant
  // groups (rendered as comparison strips) and singletons (the normal grid).
  // acceptedVariantGroupKeys omitted -> accept all detected; [] -> accept none.
  const detected = osDetectVariantGroups(targetFrames);
  const accepted = osResolveAcceptedGroups(
    detected,
    params.acceptedVariantGroupKeys
  );

  const ownerPage = osGetPageForNode(targetFrames[0]);
  if (ownerPage && figma.currentPage !== ownerPage) {
    await figma.setCurrentPageAsync(ownerPage);
  }

  const skippedCount = Math.max(0, rawSelectionSize - targetFrames.length);

  await osLoadFonts(tokens);

  const bounds = osGetBounds(targetFrames);
  let origin = {
    x: bounds ? bounds.maxX + 240 : 0,
    y: bounds ? bounds.minY : 0,
  };
  if (!bounds && figma.viewport && figma.viewport.center) {
    origin = {
      x: figma.viewport.center.x - 400,
      y: figma.viewport.center.y - 300,
    };
  }

  const sectionTitle = String(params.sectionTitle || "Screen Overview");
  const sectionDescription = String(
    params.sectionDescription || osDefaultSectionDescription(profile)
  );

  // Build Section pipeline (steps 2-8). Section position/size, metadata, and
  // selection/viewport are handled by the create/metadata/positioning steps.
  const bsc = osMakeBuildSectionCtx({
    mode: "compose",
    profile: profile,
    orientation: orientation,
    tokens: tokens,
    annotations: annotations,
    singletonFrames: accepted.singletonFrames,
    variantGroups: accepted.variantGroups,
    sectionTitle: sectionTitle,
    sectionDescription: sectionDescription,
    cardCopyOverrides: null,
    functionalMode: params.functionalMode === "advanced" ? "advanced" : "basic",
    flow: params.flow === true,
    origin: origin,
  });
  osBuildSection_createSection(bsc);
  await osBuildSection_prepareSectionShell(bsc);
  const build = await osRunBuildSectionPipeline(bsc);
  osBuildSection_writeMetadata(bsc);
  osBuildSection_finalPositioning(bsc);

  const section = bsc.section;
  const container = bsc.container;
  const plan = build.plan;
  const ctx = build.ctx;

  // Legacy gridOrientation field for tools that still read it.
  let gridOrientation;
  if (plan.strategy === "singleRow") {
    gridOrientation = "horizontal";
  } else if (plan.strategy === "singleColumn") {
    gridOrientation = "column";
  } else if (plan.strategy === "horizontalStrip") {
    gridOrientation = plan.rows.length > 1 ? "horizontal-wrap" : "horizontal";
  } else if (plan.strategy === "heroSupporting") {
    gridOrientation = "hero";
  } else if (plan.strategy === "verticalFlow") {
    gridOrientation = plan.groups.length ? "grouped-column" : "column";
  } else if (plan.strategy === "balancedGrid") {
    gridOrientation = "square-grid";
  } else {
    gridOrientation = plan.groups.length ? "grouped-grid" : "grid";
  }

  return {
    operation: "compose",
    boardType: profile.id,
    orientation: orientation.id,
    sectionId: section.id,
    sectionName: section.name,
    pageName: figma.currentPage.name,
    sectionX: section.x,
    sectionY: section.y,
    sectionWidth: section.width,
    sectionHeight: section.height,
    cardCount: ctx.cardIds.length,
    cardIds: ctx.cardIds,
    columns: plan.columns,
    gridOrientation: gridOrientation,
    flow: params.flow === true,
    flowArrowCount: build.flowArrowCount || 0,
    variantGroups: ctx.variantGroupResults.map(function (g) {
      return {
        key: g.key,
        label: g.label,
        variantLabels: g.variantLabels.slice(),
        cardIds: g.cardIds.slice(),
      };
    }),
    // Legacy field for compatibility.
    layoutMode: "grid",
    skippedNonFrameCount: skippedCount,
    engineVersion: OS_ENGINE_VERSION,
    compositionPlanSummary: {
      boardType: plan.boardType,
      orientation: plan.orientation,
      strategy: plan.strategy,
      columns: plan.columns,
      maxPerStrip: plan.maxPerStrip,
      rowCount: plan.rows.length,
      groupCount: plan.groups.length,
      heroIndex:
        plan.emphasis && typeof plan.emphasis.heroIndex === "number"
          ? plan.emphasis.heroIndex
          : null,
      cardWidthPolicy: plan.cardWidthPolicy,
      annotations: annotations.enabled
        ? { mode: annotations.mode, position: annotations.position }
        : null,
      isWide: plan.isWide,
      maxFrameWidth: plan.maxFrameWidth,
      screenCount: plan.screenCount,
    },
  };
}
/* ORGANIZE_SCREENS_ENGINE:END */
