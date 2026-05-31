// Organize Screens — types for IDE assistance and MCP tool wiring.
// The runtime lives in engine.js and is inlined into the Figma plugin.

// Board Types are the primary system: a deterministic layout profile plus an
// optional per-card review surface.
//   - `custom`        — the calibrated baseline (default).
//   - `design-review` — baseline layout + an editable Review Card per screen.
// Legacy "personality" ids map to `custom`.
export type BoardType = "custom" | "design-review";

/** @deprecated Use {@link BoardType}. Retained as an alias for back-compat. */
export type PersonalityId = BoardType;

export type CompositionStrategy =
  | "horizontalStrip"
  | "compactGrid"
  | "heroSupporting"
  | "verticalFlow"
  | "balancedGrid"
  | "singleRow"
  | "singleColumn";

/**
 * Screen Layout Orientation — opt-in primary composition axis.
 *
 * - `passthrough` (default when no orientation is passed): the planner uses
 *   the baseline preferredStrategy / emphasis / grouping. Baseline output is
 *   preserved byte-for-byte.
 * - `row` / `column` / `grid` (explicit): override the baseline strategy
 *   preset. The baseline still contributes token scales, column caps, and
 *   width thresholds.
 */
export type Orientation = "passthrough" | "row" | "column" | "grid";

export type VariantGroupSource = "marked-parent" | "naming" | "component";

/**
 * A detected/accepted multi-proposal group: variants (A/B/C) of one screen
 * laid out side-by-side in a Variant Strip with Pros/Cons slots.
 */
export interface VariantGroup {
  /** Stable group key ("parent:<id>" or "name:<normalised base>"). */
  key: string;
  /** Human label (the shared base name). */
  label: string;
  /** Per-variant labels in strip order (e.g. ["A","B"] or ["1","2"]). */
  variantLabels: string[];
  /** Generated Screen Card ids in strip order (result/metadata only). */
  cardIds: string[];
  source: VariantGroupSource;
}

/**
 * A variant group proposed by the selection probe before the user accepts it.
 * Carries source frame ids (not nodes) so it stays serialisable across the
 * plugin/UI message boundary.
 */
export interface VariantGroupProposal {
  key: string;
  label: string;
  frameIds: string[];
  variantLabels: string[];
  source: VariantGroupSource;
  confidence: "high" | "medium";
}

export type CardWidthPolicy = "hug" | "rowMax" | "sectionMax";

export type AnnotationPolicy = "none" | "compactOptional" | "expandedOptional";

export type AnnotationMode = "compact" | "expanded";

export type AnnotationPosition = "aboveScreen" | "belowDescription";

export interface AnnotationOptions {
  enabled?: boolean;
  mode?: AnnotationMode;
  position?: AnnotationPosition;
}

export type AnnotationParam = boolean | AnnotationOptions;

/**
 * Preserved annotation note for one Screen Card: the hint text plus where it
 * sat (`position`) and how it was sized (`mode`). Captured into the metadata
 * baseline before any teardown so a board-type switch never loses content, and
 * replayed (text + placement) when returning to an annotation-capable type.
 */
export interface AnnotationBaseline {
  text: string;
  position: AnnotationPosition;
  mode: AnnotationMode;
}

/**
 * Capability set for a board type. Capabilities declare which feature TOOLING is
 * available; they gate UI + generation and NEVER imply data deletion. A flag set
 * to `false` only force-disables generation and hides UI — preserved content
 * (annotations, reviews) survives a board-type switch and reappears when
 * switching back to a capable type. Capabilities are a pure function of board
 * type id, so legacy boards need no migration to gain them.
 */
export interface BoardTypeCapabilities {
  /** Annotation tooling (UI shown, generation allowed when the user opts in). */
  annotations: boolean;
  /** Flow overlay tooling. */
  flow: boolean;
  /** Review cards (derived from the board type's `reviewCard` profile). */
  reviewCards: boolean;
}

/** Identifies a structured feedback field inside a Review Card. */
export type ReviewFieldKey =
  | "headerDescription"
  | "status"
  | "workingWell"
  | "questions"
  | "concerns"
  | "ideas"
  | "notes";

/**
 * Per-card review surface configuration. Present only on board types that
 * render Review Cards (e.g. `design-review`); `null` on layout-only types.
 */
export interface ReviewCardConfig {
  enabled: boolean;
  /** Render the editable Status pill in the Review header. */
  status: boolean;
  /** Ordered structured feedback sections (label + editable field). */
  sections: Array<"workingWell" | "questions" | "concerns" | "ideas">;
  /** Render the freeform Notes area below the structured sections. */
  notes: boolean;
}

export interface BoardTypeProfile {
  id: BoardType;
  label: string;
  intent: string;
  tokenScale: {
    outerSpacing: number;
    innerSpacing: number;
    typography: number;
  };
  behavior: {
    wideScreenWidth: number;
    mediumScreenWidth: number;
    maxColumns: number;
    maxPerStrip: number;
    preferredStrategy: "auto" | "strip" | "grid" | "heroSupporting";
    grouping: "none" | "chunks" | "spatialRows" | "narrative";
    emphasis: "none" | "firstHero" | "largestHero";
    cardWidthPolicy: CardWidthPolicy;
    annotationPolicy: AnnotationPolicy;
  };
  sectionGrid: {
    gap: number;
    maxColumns: number;
  };
  /** Optional per-card review surface; `null` on layout-only board types. */
  reviewCard: ReviewCardConfig | null;
}

/** @deprecated Use {@link BoardTypeProfile}. */
export type LayoutPersonality = BoardTypeProfile;

export interface CompositionPlan {
  boardType: BoardType;
  orientation: Orientation;
  operation: "compose" | "arrangeSectionsGrid";
  strategy: CompositionStrategy;
  columns: number;
  maxPerStrip: number;
  rows: number[][];
  groups: Array<{
    label?: string;
    rows: number[][];
    frameIndices: number[];
  }>;
  emphasis: { heroIndex?: number };
  cardWidthPolicy: CardWidthPolicy;
  annotationPolicy: AnnotationPolicy;
  isWide: boolean;
  maxFrameWidth: number;
  screenCount: number;
}

export interface CompositionPlanSummary {
  boardType: BoardType;
  orientation: Orientation;
  strategy: CompositionStrategy;
  columns: number;
  maxPerStrip: number;
  rowCount: number;
  groupCount: number;
  heroIndex: number | null;
  cardWidthPolicy: CardWidthPolicy;
  annotations: { mode: AnnotationMode; position: AnnotationPosition } | null;
  isWide: boolean;
  maxFrameWidth: number;
  screenCount: number;
}

export interface OrganizeScreensParams {
  /** Optional FRAME or SECTION node IDs. Falls back to current selection. */
  nodeIds?: string[];
  /** H1 shown in the header and used as the Section name (compose only). */
  sectionTitle?: string;
  /** Subtitle / overview paragraph (compose only). */
  sectionDescription?: string;
  /** Gap between boards when arranging Sections (defaults to the baseline). */
  sectionGridGap?: number;
  /**
   * Board Type. `custom` (default) is the calibrated baseline; `design-review`
   * adds an editable Review Card to each screen. Unknown / legacy values map
   * to `custom`.
   */
  boardType?: BoardType;
  /** @deprecated Use {@link OrganizeScreensParams.boardType}. Accepted as an alias. */
  personality?: string;
  /** Opt-in annotation slots on each Screen Card. */
  annotations?: AnnotationParam;
  /**
   * Opt-in screen layout orientation. Omitting it preserves the baseline
   * (passthrough). Explicit "row" / "column" / "grid" overrides the baseline
   * strategy preset.
   */
  orientation?: Orientation;
  /**
   * Multi-proposal acceptance. Keys come from the selection probe's
   * `proposedVariantGroups`.
   * - omitted/undefined: accept all detected groups
   * - `[]`: accept none (every screen is a separate card)
   * - `[..]`: accept exactly the listed group keys
   */
  acceptedVariantGroupKeys?: string[];
  /**
   * Show as flow. On a compose run, overlays one-directional arrows between
   * the generated Screen Cards in reading order.
   */
  flow?: boolean;
  /**
   * In-place flow. Draws arrows between the selected screens (or the child
   * screens of each selected section) without composing a board. Takes
   * precedence over compose / arrange.
   */
  flowInPlace?: boolean;
  /** Deprecated. Any value maps to the `custom` baseline. */
  layoutMode?: string;
}

export interface OrganizeScreensComposeResult {
  operation: "compose";
  boardType: BoardType;
  orientation: Orientation;
  sectionId: string;
  sectionName: string;
  pageName: string;
  sectionX: number;
  sectionY: number;
  sectionWidth: number;
  sectionHeight: number;
  cardCount: number;
  cardIds: string[];
  columns: number;
  gridOrientation?: string;
  /**
   * Accepted multi-proposal groups rendered as comparison strips on this
   * board. Empty when the selection had no variants (or all were dismissed).
   */
  variantGroups: Array<{
    key: string;
    label: string;
    variantLabels: string[];
    cardIds: string[];
  }>;
  /** Whether flow arrows were overlaid between the generated cards. */
  flow?: boolean;
  /** Number of flow arrows drawn on the board (0 when flow is off). */
  flowArrowCount?: number;
  /** Legacy compatibility field; always "grid". */
  layoutMode: "grid";
  skippedNonFrameCount: number;
  engineVersion: number;
  compositionPlanSummary: CompositionPlanSummary;
}

export interface OrganizeScreensArrangeSectionsResult {
  operation: "arrangeSectionsGrid";
  boardType: BoardType;
  orientation: Orientation;
  pageName: string;
  sectionCount: number;
  sectionIds: string[];
  sectionNames: string[];
  columns: number;
  sectionGridGap: number;
  /**
   * Unified height every section was resized to before positioning
   * (the tallest selected section's height). Sections never shrink;
   * if a section was already at this height it is left untouched.
   */
  sectionHeight: number;
  /**
   * Count of selected sections that could not be resized (locked
   * nodes, nodes without a `resize` API, or nodes that threw during
   * the resize call).
   */
  skippedHeightCount: number;
  /** Legacy compatibility field; always "grid". */
  layoutMode: "grid";
  skippedNonSectionCount: number;
  usedPresentationSectionHeuristic: boolean;
  engineVersion: number;
}

export interface OrganizeScreensFlowResult {
  operation: "flowArrows";
  pageName: string;
  /** Total arrows drawn across the resolved scope. */
  arrowCount: number;
  /** IDs of the screens connected, in flow order. */
  connectedNodeIds: string[];
  /** Whether the flow connected loose frames or the child frames of sections. */
  scope: "frames" | "sections";
  engineVersion: number;
}

export type OrganizeScreensResult =
  | OrganizeScreensComposeResult
  | OrganizeScreensArrangeSectionsResult
  | OrganizeScreensFlowResult;
