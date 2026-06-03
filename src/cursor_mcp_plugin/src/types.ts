/**
 * Typed message contract between the plugin runtime (`code.ts`) and the
 * UI iframe (`ui.ts` + skill panels). Every message must include a
 * `type` discriminant; payloads are kept small and serializable.
 *
 * Two distinct conversation lanes share the same channel:
 *
 * 1. The MCP **relay** lane (`execute-command` -> `command-result` /
 *    `command-error`) carries opaque commands forwarded from the
 *    WebSocket relay (`socket.ts`) over to `handleCommand` in `code.ts`.
 *    The UI just shuttles bytes both ways.
 *
 * 2. The **skill UI** lane (`run-skill` -> `skill-result` /
 *    `skill-error`) is triggered by a user clicking "Run" inside a
 *    skill panel. It calls the engine directly (e.g.
 *    `organizeScreensFromSelection`) without going through the MCP
 *    command dispatcher.
 */

// Board Types are the primary system: a layout profile plus an optional
// per-card review surface.
//   - `custom`             — the calibrated baseline (default).
//   - `design-review`      — baseline layout + an editable Review Card per screen.
//   - `functional-analysis`— baseline token scales + a stacked Functional Card
//                            per screen for structured functional documentation.
// Legacy "personality" ids map to `custom`.
export type BoardType = "custom" | "design-review" | "functional-analysis";

/** @deprecated Use {@link BoardType}. Retained as an alias for back-compat. */
export type PersonalityId = BoardType;

export type AnnotationMode = "compact" | "expanded";
export type AnnotationPosition = "aboveScreen" | "belowDescription";

export interface AnnotationOptions {
  mode?: AnnotationMode;
  position?: AnnotationPosition;
}

export type AnnotationParam = boolean | AnnotationOptions;

export type Orientation = "passthrough" | "row" | "column" | "grid";

export interface OrganizeScreensParams {
  /** Board Type: `custom` (default) or `design-review`. */
  boardType?: BoardType;
  /** @deprecated Use {@link OrganizeScreensParams.boardType}. Accepted as an alias. */
  personality?: string;
  annotations?: AnnotationParam;
  orientation?: Orientation;
  sectionTitle?: string;
  sectionDescription?: string;
  /**
   * Multi-proposal acceptance keys (from a compose context's
   * `proposedVariantGroups`). Omit to accept all detected groups; `[]`
   * accepts none; otherwise accept exactly the listed keys.
   */
  acceptedVariantGroupKeys?: string[];
  /** Show as flow: overlay arrows between generated cards on a compose run. */
  flow?: boolean;
  /**
   * Selective flow scope (recompose/apply path only): ordered embedded
   * source-frame ids the flow overlay should connect, or null/omitted for a
   * whole-board overlay. The engine derives this from the live selection on
   * Apply, so the UI does not set it; documented here for the engine contract.
   */
  flowFrameIds?: string[] | null;
  /** In-place flow: draw arrows between selected screens / section children. */
  flowInPlace?: boolean;
  /**
   * Functional Analysis card structure. `basic` (default) renders the 8
   * structured fields; `advanced` renders a single long-form documentation
   * field. Only meaningful on `functional-analysis` boards. Switching modes
   * does not preserve content (the structures share no field keys).
   */
  functionalMode?: "basic" | "advanced";
}

/** A variant group proposed by the runtime for a compose selection. */
export interface VariantGroupProposal {
  key: string;
  label: string;
  frameIds: string[];
  variantLabels: string[];
  source: "marked-parent" | "naming" | "component";
  confidence: "high" | "medium";
}

/**
 * Snapshot of what the plugin runtime sees on the canvas right now.
 * The UI uses this to switch between Generate, Edit, Arrange, and Idle
 * modes. The runtime owns recognition (`figma.editorType`, metadata,
 * structural smoke test); the UI only renders.
 */
/**
 * Capability set for a board type. Capabilities declare which feature TOOLING
 * is available; they gate UI + generation and NEVER imply data deletion. A
 * capability set to `false` only force-disables generation and hides UI —
 * preserved content (annotations, reviews) survives a board-type switch and
 * reappears when switching back to a capable type. The engine owns these; the
 * UI reads them from the selection context and never hardcodes a mirror.
 */
export interface BoardTypeCapabilities {
  /** Annotation tooling (UI shown, generation allowed when the user opts in). */
  annotations: boolean;
  /** Flow overlay tooling. */
  flow: boolean;
  /** Review cards (derived from the board type's review profile). */
  reviewCards: boolean;
  /** Functional documentation cards (derived from the functional profile). */
  documentation: boolean;
}

/**
 * Eligibility + target descriptor for the AI "Analyze Design" action. The
 * engine resolves this from the current selection (single Screen Card on a
 * Design Review board with a standard Review Card). The UI only renders the
 * action when `eligible === true`; the plugin runtime re-resolves the target
 * at run time, so this payload is for presentation only.
 */
export interface AnalyzeDesignEligibility {
  eligible: boolean;
  /** Human-readable explanation when `eligible` is false. */
  reason?: string;
  /**
   * Scope of the eligible action: a single Screen Card, or every standard
   * review screen in the selected section. Drives the panel's button copy and
   * the `target` sent back on the action message.
   */
  target?: "card" | "section";
  /** Owning board section id (for re-resolution at apply time). */
  sectionId?: string;
  /** Selected Screen Card id (card target only). */
  cardId?: string;
  /** Embedded screen frame id (card target only). */
  frameId?: string;
  /** Display name of the card (card target only). */
  cardName?: string;
  /** Section name (section target only). */
  sectionName?: string;
  /** Number of standard review screens in the section (section target only). */
  screenCount?: number;
  /** Review framework — v1 supports the standard single-screen review only. */
  frameworkId?: "standard";
  boardType?: BoardType;
  /**
   * Functional Analysis mode of the eligible board (functional surface only).
   * Lets the UI gate Advanced-only actions such as documentation export.
   */
  mode?: "basic" | "advanced";
  /** True when the card already has review text or a Card Description (UI hint). */
  hasExistingContent?: boolean;
}

export type OrganizeScreensSelectionContext = (
  | { mode: "idle"; reason: string }
  | { mode: "unsupported"; reason: string }
  | {
      mode: "compose";
      frameCount: number;
      proposedVariantGroups: VariantGroupProposal[];
    }
  | { mode: "arrange"; sectionCount: number }
  | {
      mode: "edit";
      board: {
        sectionId: string;
        sectionName: string;
        cardCount: number;
        /**
         * How the board was recognized:
         * - "metadata": full envelope read from sharedPluginData
         * - "marker": envelope missing, but the tiny boardType marker was found
         * - "structural": only the node structure matched (safe defaults)
         * All three are MODERN boards; none are "legacy".
         */
        recognition: "metadata" | "marker" | "structural";
        engineVersion: number;
        schemaVersion: number;
        /** Number of comparison (variant) groups stored on this board. */
        variantGroupCount: number;
        /**
         * Number of preserved annotation notes (text + placement) carried in
         * this board's metadata baseline. Lets the UI surface an observable
         * "N notes preserved" reassurance when annotations are hidden on an
         * incapable board type. 0 when none are stored.
         */
        preservedAnnotationCount: number;
        settings: {
          boardType: BoardType;
          orientation: Orientation;
          annotations: {
            enabled: boolean;
            mode: AnnotationMode;
            position: AnnotationPosition;
          };
          /** Whether the board was composed with flow arrows. */
          flow?: boolean;
          /**
           * Scoped-flow subset: ordered embedded source-frame ids the overlay
           * connects, or null for a whole-board overlay. Absent on older boards.
           */
          flowFrameIds?: string[] | null;
          /** Review-surface settings (present on design-review boards). */
          review?: {
            enabled: boolean;
            status: boolean;
            sections: Array<"workingWell" | "questions" | "concerns" | "ideas">;
            notes: boolean;
          };
          /**
           * Functional-card settings (present on functional-analysis boards).
           * `mode` selects the Basic 8-field structure or the Advanced
           * single-document structure.
           */
          functional?: {
            mode: "basic" | "advanced";
          };
        };
        layout: {
          strategy: string;
          columns: number;
          screenCount: number;
          maxFrameWidth: number;
        };
      };
    }
) & {
  /**
   * True when the current selection can drive an in-place flow (2+ frames, or
   * a section with 2+ child frames). Present on every mode so the panel can
   * offer the in-place flow action independently of compose/edit/arrange.
   */
  flowEligible?: boolean;
  /**
   * Selective-flow preview for edit mode: the number of Screen Cards the
   * current selection would scope flow to on Apply (0 when the selection is
   * not a 2+ subset). Lets the panel show "Flow: N selected screens".
   */
  flowScopeCount?: number;
  /**
   * True when an Apply with flow ON would scope the overlay to the selected
   * subset (i.e. a proper subset of 2+ Screen Cards is selected). False means
   * the whole board flows. Present only in edit mode.
   */
  flowWouldScope?: boolean;
  /**
   * Capabilities for the currently resolved/edited board type. The UI gates the
   * annotations section (and future feature surfaces) on this. Optional so an
   * older engine pairing degrades gracefully (UI falls back to all-available).
   */
  capabilities?: BoardTypeCapabilities;
  /**
   * Static map of every board type id -> capability set, so the UI can react to
   * the board-type dropdown in compose mode before any board exists. Optional
   * for the same back-compat reason as `capabilities`.
   */
  capabilitiesByBoardType?: Record<string, BoardTypeCapabilities>;
  /**
   * AI "Analyze Design" eligibility for the current selection. Present on every
   * mode so the panel can offer the action whenever a single Design Review
   * Screen Card is selected. Optional so an older engine pairing degrades
   * gracefully (the action stays hidden).
   */
  analyzeDesign?: AnalyzeDesignEligibility;
  /**
   * AI "Create Documentation" eligibility for the current selection. Present
   * whenever a Functional Analysis Screen Card (card scope) or section
   * (section scope) is selected. Reuses {@link AnalyzeDesignEligibility} (the
   * shape already carries `target`, `cardId`, `screenCount`, `sectionName`);
   * functional sets `boardType: "functional-analysis"`. Mutually exclusive
   * with `analyzeDesign` by surface. Optional for back-compat.
   */
  createDocumentation?: AnalyzeDesignEligibility;
};

/**
 * Progress envelope produced by the engine's `sendProgressUpdate(...)`
 * helper. Kept loose because the engine emits a handful of optional
 * fields that the UI just forwards over the relay.
 */
export interface ProgressData {
  type?: "command_progress";
  commandId?: string;
  commandType?: string;
  status?: "started" | "in_progress" | "completed" | "error";
  progress?: number;
  totalItems?: number;
  processedItems?: number;
  currentChunk?: number;
  totalChunks?: number;
  chunkSize?: number;
  message?: string;
  payload?: unknown;
  timestamp?: number;
}

export type UiToPluginMessage =
  | { type: "ui-ready" }
  | { type: "update-settings"; serverPort: number }
  | { type: "notify"; message: string }
  | { type: "close-plugin" }
  | { type: "probe-selection" }
  | {
      type: "execute-command";
      id: string;
      command: string;
      params: unknown;
    }
  | {
      type: "run-skill";
      skill: "organize-screens";
      params: OrganizeScreensParams;
    }
  | {
      type: "apply-board-changes";
      sectionId: string;
      params: OrganizeScreensParams;
      confirmOverwrite?: boolean;
    }
  | {
      type: "reset-board";
      sectionId: string;
    }
  | {
      // AI Analyze Design: export the target screen(s), send to the Bonzai
      // vision backend, and overwrite matching text fields. `scope` narrows the
      // write: "describe" fills the Card Description (+ Section Title/Description
      // for section target), "review" fills the review section. `target`
      // selects a single card or every standard review screen in a section.
      type: "analyze-design";
      scope: "describe" | "review";
      target: "card" | "section";
    }
  | {
      // Offline reset: set the review section fields back to their default
      // placeholder text. No network call. `target` is one card or the section.
      type: "reset-review";
      target: "card" | "section";
    }
  | {
      // AI Create Documentation: export the target screen(s), send to the
      // Bonzai vision backend with the functional-analysis prompt, and
      // overwrite the Functional Card section fields. `target` selects a single
      // card or every Functional Analysis screen in a section.
      type: "create-documentation";
      target: "card" | "section";
    }
  | {
      // Offline reset: set the Functional Card section fields back to their
      // default placeholder text. No network call. One card or the section.
      type: "reset-documentation";
      target: "card" | "section";
    }
  | {
      // Export Advanced functional documentation. The runtime gathers the
      // markdown from the selected cards (or the whole board) and posts it back
      // for the UI to zip + download. No network call.
      type: "export-documentation";
    };

export type PluginToUiMessage =
  | { type: "auto-connect" }
  | { type: "auto-disconnect" }
  | { type: "command-result"; id: string; result: unknown }
  | { type: "command-error"; id: string; error: string }
  | ({ type: "command_progress" } & ProgressData)
  | { type: "analytics-client-id"; clientId: string }
  | { type: "skill-result"; skill: string; result: unknown }
  | { type: "skill-error"; skill: string; error: string }
  | {
      // Map of `{ [skillId]: SelectionContext }`. The runtime broadcasts
      // one envelope per (debounced) selection change containing every
      // registered probe's result. The UI fan-outs per-skill. The
      // payload is `unknown` because the registry is editor-wide and
      // each skill owns its own context shape (Organize Screens uses
      // `OrganizeScreensSelectionContext`).
      type: "selection-contexts";
      contexts: Record<string, unknown>;
    }
  | {
      type: "connection-status";
      connected: boolean;
      message?: string;
    }
  | {
      // Analyze Design lifecycle. Kept separate from the skill-result lane so
      // it never conflates with compose/recompose results.
      type: "analyze-design-progress";
      phase: "exporting" | "analyzing" | "applying";
      message?: string;
    }
  | {
      type: "analyze-design-result";
      /** Which action produced this result, so the panel can label it. */
      operation:
        | "describe"
        | "review"
        | "resetReview"
        | "document"
        | "resetDocumentation";
      /** Whether the action ran on one card or a whole section. */
      target?: "card" | "section";
      /** Human-readable labels of fields/screens written. */
      applied: string[];
      /** Human-readable labels of fields/screens that could not be updated. */
      skipped: string[];
      /** Card name (card target) or section name (section target). */
      cardName?: string;
      /** Total screens processed (section target). */
      screenCount?: number;
      /**
       * Optional human-readable reason shown when screens were skipped, so a
       * section run never reports an empty result without explaining why.
       */
      note?: string;
    }
  | {
      // Always redacted before it reaches the UI (no raw upstream bodies).
      type: "analyze-design-error";
      message: string;
    }
  | {
      // Advanced functional documentation export. `files` carries one markdown
      // document per screen; the UI builds the zip and triggers the download.
      // An empty `files` array means there was nothing to export.
      type: "export-documentation-result";
      files: Array<{ name: string; content: string }>;
      zipName: string;
    };
