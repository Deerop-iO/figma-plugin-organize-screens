# Changelog

All notable changes to the **Cursor MCP Figma Plugin** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Analyze Design (AI)** for Organize Screens Design Review boards. Selecting a
  single Design Review Screen Card reveals an **Analyze design (AI)** action that
  exports the screen (PNG, 1024px wide), sends it to a Vercel-hosted Bonzai
  vision backend, validates the structured JSON response, and fills the card's
  **Card Description** and review fields (`workingWell`, `questions`, `concerns`,
  `ideas`, `notes`). Existing non-placeholder text is preserved unless the user
  confirms overwrite. The Bonzai key stays server-side: the plugin talks only to
  its own backend (`vercel-backend/api/bonzai/analyze-design.ts`). New shared
  analysis module (`src/analysis/designReview.ts`) owns the v1 schema, validator,
  and prompt builders behind an extensible `ANALYSIS_MODES` registry; engine adds
  `osResolveAnalyzeDesignTarget` / `osApplyDesignReviewAnalysis`. Sandbox-safe
  networking (no `new URL`/`signal`, `Promise.race` timeout, hardcoded
  `ALLOWED_HOSTS`, redacted errors). Manifest gains the Vercel origin in
  `allowedDomains` and `http://localhost:3000` in `devAllowedDomains`.

- **Board Type Capability Model** for Organize Screens. Board types now declare,
  via the engine-owned `OS_BOARD_TYPE_CAPABILITIES` registry and
  `osBoardTypeCapabilities(id)`, which feature tooling is available
  (`annotations`, `flow`, derived `reviewCards`). Capabilities gate UI +
  generation but never delete data. The engine pushes `capabilities` and a
  `capabilitiesByBoardType` map through the selection context; the panel reads
  them (no hardcoded mirror) to show/hide + disable the Annotations section,
  omit annotations from incapable runs, and surface an *"N notes preserved —
  they reappear in Custom"* reassurance.

### Fixed

- Organize Screens edit mode now resolves **Design Review** correctly when
  metadata or the boardType marker are stale: the engine infers board type from
  Review Cards on canvas (and from `review.enabled` in stored settings), and the
  panel always aligns the Board Type dropdown when the probe disagrees with the
  form.

- Organize Screens panel now stays in sync when selecting a generated section:
  selection probes push immediately plus a debounced follow-up (Figma often fires
  multiple `selectionchange` events per click), board recognition no longer
  requires at least one Screen Card for structural edit mode, and the form
  reloads when stored settings change (not only when the section id changes) while
  still preserving in-progress edits when clicking inside the same board.

- Design Review **Card Body** and **Screen Column** frames now set `clipsContent: false`
  so child content (embedded screens, annotation slots, review columns) is not clipped
  at the wrapper boundary.

### Changed

- **Annotations are now a preserved data layer** (engine v9). Switching board
  types — including to Design Review, which does not render annotations — no
  longer destroys annotation notes. The `Annotation Hint` is tagged with
  `osAnnotationField` shared plugin data; `osCaptureAnnotation` records each
  note's **text and placement** (position + mode) before any teardown (full
  recompose and annotations-only disable), persists it in the per-card metadata
  baseline (`copyBaseline.cards[].annotation`, schema v3), and replays it
  verbatim when returning to an annotation-capable board type. The annotation
  enabled **intent** is stored (not the capability-gated render value), so a
  Custom → Design Review → Custom round trip restores notes the user had turned
  on. `osCardAnnotationSlot` now walks nested wrappers and `osAppendAnnotationSlot`
  dedupes, so Design Review-origin boards never get a duplicate slot. Engine bump
  to v9; metadata schema to v3 (back-compat read of older envelopes).

- Refactor the Organize Screens interior builder into an explicit eight-step
  **Build Section** pipeline (`osBuildSection_*` over a shared `osBuildSectionCtx`,
  run by `osRunBuildSectionPipeline`): read selection, create section, prepare
  shell, create screen cards, create review cards, apply auto layout, write
  metadata, final positioning. Compose and recompose now share the same steps;
  `osBuildBoardInterior` is removed. Design Review Review Cards build as a second
  pass (`ctx.pendingReviews`) after screen shells, and strip width equalization
  plus review-column sizing move into the auto-layout step. Internal, no
  behaviour change: layer tree, metadata schema, and result shapes are
  unchanged, so no engine version bump.

- **Design Review Screen Card layout** (engine v8): cards on `design-review`
  boards now use a horizontal **Card Body** row — **Screen Column** (embedded
  screen + description, fixed to screen width) beside a fixed **923px Review
  Column** with gap **120px** — matching the WORKING AREA reference card
  (`744:27318`). The Review Card uses a pill **Review Header** (stroke, no outer
  panel fill) and a **Review Content** wrapper for the description and sections.
  **Custom** boards keep the previous vertical stack (title → screen →
  description). Extraction helpers walk nested wrappers (`Card Body`, columns,
  `Review Content`). Engine bump to v8.

- **Review Status** adopts the file's **`.Design Review`** component set when
  present (User-Centric Hub design system); otherwise creates **Review Status**
  on the assets page with per-variant colors matching that master (**Draft**,
  **Approved**, **Blocked**, **Needs work**, **Ready for dev**). Preserved
  **In Review** values map to **Needs work** on recompose. Plugin-created sets
  only are color-synced — adopted masters are never overwritten.

- Design Review standard review section label **Working Well** → **What's good**
  (on-canvas header only; field key `workingWell` unchanged for metadata).

### Added

- **Variant Group panels** for Organize Screens. Each accepted
  comparison group is now wrapped in a tinted, titled container
  ("{name} · {n} variants") that holds the variant cards and — on
  Design Review boards — the Decision card, so a comparison reads as
  one grouped unit distinct from the singleton screens. New tokens
  (`variantGroupBgColor`, `variantGroupStroke`, `variantGroupPadding`,
  `variantGroupTitleGap`, `variantGroupCornerRadius`,
  `variantGroupTitleColor`); `osBuildVariantStrip` now emits a
  `Variant Group / {name}` frame wrapping the existing
  `Variant Strip / {name}`.

- **Design Review + Pros/Cons integration** for Organize Screens. The
  Design Review board type now drives variant (A/B/C) groups through a
  **comparative review framework** instead of the old Pros/Cons box:
  each variant card gets a full Review Card (Pros / Cons / Open
  Questions / Improvement Ideas / Decision Notes), and each variant
  group gets a single cross-option **Decision card** (Preferred option
  / Rationale / Risks / Follow-ups) appended as the final equal-width
  column of the strip. Single screens keep the standard review
  framework (Working Well / Questions / Concerns / Ideas / Notes).
  Review frameworks live in a new `REVIEW_FRAMEWORKS` registry so
  future evaluation frameworks drop in without touching the builders.
  Comparative fields and Decision-card fields are tagged and
  **preserved across recompose**; boards composed with the older
  variant Assessment block migrate their Pros/Cons text into the
  comparative card on the next recompose. Custom board variant cards
  are unchanged (still use the Assessment Pros/Cons box). Engine bump
  to v7.

- **Reset to screens only** for Organize Screens. A new edit-mode
  button (shown whenever a plugin-generated board is selected)
  deconstructs the board back to its raw screens: every original
  screen frame is lifted onto the page **exactly where it sat inside
  the section**, and all plugin-generated structure (Screen Cards,
  overview header/description, Review Cards and their status
  instances, annotation layers, the flow overlay, the
  `Section Container`, and the `SECTION`) is deleted along with its
  `sharedPluginData` metadata. Original frames are never deleted or
  resized, and the shared `Review Status` component set on the assets
  page is left intact for other boards. The action asks for inline
  confirmation first ("This will remove all review, annotations, and
  layout structure. Original screens will remain unchanged."), only
  affects the one selected section, and is safe to repeat. Engine
  entry point `osResetBoardToScreens`; UI `reset-board` message;
  result `operation: "resetToScreens"`.

- **Board Types + new "Design Review" board type** for Organize Screens.
  The "Personality" concept is now **Board Types**, the primary system
  for choosing how a board is generated. Two board types ship:
  - **Custom** (default) — the existing calibrated baseline composition;
    unchanged output.
  - **Design Review** — the same baseline layout plus an editable
    **Review Card** appended under each (singleton) screen. The Review
    Card is a native-Figma feedback surface anyone can edit without the
    plugin: a header with an editable **Status** pill (default `Draft`)
    and short description, four structured sections — **👍 Working Well,
    ❓ Questions, ⚠ Concerns, 💡 Ideas** — each with a labelled, boxed
    editable field, and a freeform **Notes** area. Empty fields show
    muted placeholder copy ("Click to add feedback…", etc.).
  - Every field is a native text node tagged via `sharedPluginData`
    (`osReviewField`) so the plugin — and future extraction tooling —
    can locate feedback deterministically even after layers are renamed.
    The Review Card frame is tagged with its source frame id
    (`osReviewCard`).
  - Review Cards live **inside** each Screen Card, so they work with all
    orientations (row / column / grid), the annotation system, and the
    flow system with no extra configuration. v1 scopes Review Cards to
    singleton cards; variant (Pros/Cons) strips keep their Assessment
    block.
  - Typed review feedback is **preserved across recompose** (orientation,
    annotation, or flow edits) the same way card titles/descriptions are.
    Switching a board away from Design Review removes the Review Cards and
    their feedback, which the edit panel now warns about with a dedicated
    confirmation.
  - New `boardType` parameter on the `organize_screens` MCP tool
    (`custom` | `design-review`); the legacy `personality` parameter is
    kept as a deprecated alias that maps to `custom`. The Board Type
    picker in the panel is now a real, enabled dropdown.
  - Board metadata stores `settings.boardType` and `settings.review`
    (engine version bumped to **5**). Existing boards and stored
    `settings.personality` values migrate transparently to
    `boardType: "custom"`.
- **Show as flow (arrows between screens)** for Organize Screens.
  Draws one-directional arrows that connect screens in order. Two
  placements:
  - **In place** — an "Add flow arrows (in place)" action (lit up
    whenever the selection has 2+ frames, or a section with 2+ child
    frames) draws arrows between the selected frames in selection
    order, or inside each selected section between its child frames.
    No board is composed. Re-running replaces the previous flow
    instead of stacking.
  - **Compose toggle** — a "Show as flow" checkbox on the compose /
    edit form overlays arrows between the generated Screen Cards in
    reading order. The overlay lives inside the board (an absolute,
    transparent **Flow Overlay** frame), moves with it, and is rebuilt
    on recompose; toggling it off in edit mode removes it.
  - Arrows are real **vector** nodes with an arrowhead stroke cap on
    the destination end (Figma connectors are FigJam-only). New `flow`
    and `flowInPlace` parameters on the `organize_screens` MCP tool;
    new `flowArrows` operation in the result/notify. Board metadata
    stores `settings.flow` (default `false`); a flow change is treated
    as a layout edit.
  - Each arrow carries an editable **Flow Label** pill (neutral
    placeholder `Describe interaction ...`, centered text) sitting just below
    the arrow line for describing the step. Arrows are drawn at a fixed
    target length (center-to-center, clamped to the actual distance) so
    they stay boldly visible instead of collapsing into the gap between
    adjacent cards. On a board, edited labels are replayed by index
    across recompose so they survive personality / orientation /
    annotation changes.
  - When the **Show as flow** toggle is on, the composed board widens its
    inter-card gaps (`gridGapX` / `stripGapY` raised to at least
    `flowArrowLength + 2 * flowAnchorGap`) so the fixed-length arrows sit
    between screens with clearance instead of overlapping them. Columns
    and rows are unchanged — only the spacing grows.
- **Multi-proposal comparison (A / B / C)** for Organize Screens.
  The engine now detects variant groups in a frame selection from
  designer-marked parents (`Variants: X` / `Compare: X`) and naming
  conventions (`Home A`/`Home B`, `Home v1`/`Home v2`,
  `Checkout - 1`/`Checkout - 2`, `Home (alt)`/`Home (alt 2)`).
  Accepted groups render as a side-by-side **Variant Strip** with a
  green **Pro's** and red **Con's** Assessment slot under each
  variant; remaining screens stay as normal cards in the grid.
  Detection is personality-agnostic and runs on the current Figma
  selection.
  - Opt-in in the Organize Screens panel: each detected group shows a
    checkbox (high-confidence groups default on) plus a "Treat all as
    separate" link. The choice is sent as `acceptedVariantGroupKeys`
    (omitted = accept all detected, `[]` = accept none).
  - New `acceptedVariantGroupKeys` parameter on the `organize_screens`
    MCP tool.
  - Compose result and selection-context probe gain `variantGroups` /
    `proposedVariantGroups`; the edit context reports
    `variantGroupCount`. The compose notify toast and result block
    report the comparison-group count.
  - Metadata bumped to **schema v2** with a `variantGroups[]` envelope.
    Recompose **replays** the stored grouping by source frame id (never
    re-detects), so a dismissed group does not silently regroup and an
    accepted group survives personality/orientation/annotation edits;
    a group with fewer than two surviving frames degrades to
    singletons. v1 boards migrate transparently on their next write.
  - Variant-card Pros/Cons copy is preserved across recompose like
    other card text.
- Organize Screens arrange-sections result envelope gains
  `sectionHeight` (the unified height every selected section was
  resized to) and `skippedHeightCount` (number of selected sections
  that could not be resized, e.g. locked nodes). Surfaced in the
  Figma notify toast as `…px height` and in the plugin UI result
  block.
- **Editable Board Composition** for Organize Screens. Selecting any
  part of a board the plugin generated (the SECTION, its `Section
  Container`, a `Screen Card`, or an inner element) now switches the
  Organize Screens panel into "Edit this board" mode automatically.
  Personality, orientation, and annotations come pre-filled from the
  board's stored settings; **Apply changes** routes to a hybrid
  update:
  - annotations-only deltas run as an in-place surgical patch
    (`osPatchBoardAnnotations`) that adds, removes, or re-positions
    `Annotation Slot` frames without touching the rest of the card.
  - personality or orientation deltas trigger a full interior
    recompose (`osRecomposeBoard`). Edited card titles, edited card
    descriptions, the section title, the section description, and any
    rename the user did on an embedded screen frame are **always**
    preserved verbatim (an intentionally empty string counts as an
    edit and is kept). Embedded screen frames are reused in their
    current document order, never duplicated. Layout deltas show an
    inline confirm before applying because manual spacing tweaks on
    the container or cards may reset to personality tokens.
  Recognition uses a new versioned metadata envelope
  (`schemaVersion: 1`) on the `Section Container`; older flat-shape
  boards migrate transparently through `osCoerceMetadata`. Boards
  with the right structure but no metadata still light up the panel
  in a "legacy" edit mode with explicit messaging. The plugin
  runtime debounces `selectionchange` (~150ms) and pushes a typed
  `selection-context` message to the UI; the shell exposes
  `getSelectionContext()` / `onSelectionContextChange()` on
  `SkillContext` for any future panel that wants to react to live
  selection.

### Removed

- **Layout Personalities collapsed to a single `custom` baseline.**
  The `presentation`, `portfolio`, `workshop`, and `documentation`
  personalities were removed; `custom` is the calibrated baseline
  (identical to the former default `review`). `osResolvePersonality`
  is now total — any legacy or unknown personality id, and the
  deprecated `layoutMode` value, map to `custom` (it never throws).
  Stored board metadata coerces any personality value to `custom`,
  so existing boards keep working; editing a board composed with an
  old non-baseline personality recomposes it on the Custom baseline
  (edited text and renamed frames are always preserved). No schema
  bump — `settings.personality` stays a string field. The
  `personality` field is kept in the API, metadata, and UI (a single
  disabled "Custom" option) as a forward-compatible placeholder for
  future board types / modes.

### Changed

- **Design Review status is now a Figma component instance.** The
  status badge is rendered as an instance of a document-scoped
  `COMPONENT_SET` named **Review Status** (variant property `Status` =
  `Draft` | `In Review` | `Approved` | `Blocked`). The plugin creates
  the set on a hidden **Organize Screens / Assets** page the first time
  a Design Review board is composed in the file, then reuses it.
  Reviewers change a screen's status on canvas through Figma's variant
  picker, and the selected variant is preserved across recompose.
  Boards composed before this change keep their plain text status pill
  and still recompose correctly. Engine version bumped to **6**.
- **"Personality" renamed to "Board Type"** across the Organize Screens
  codebase, data model, UI, and MCP surface. `PERSONALITIES` →
  `BOARD_TYPES`, `osResolvePersonality` → `osResolveBoardType`,
  `PersonalityId` → `BoardType`, metadata `settings.personality` →
  `settings.boardType`, and result/plan `personality` →
  `boardType`. The panel label is now "Board Type"; result summaries
  read "Board Type". Legacy `personality` keys (params, stored metadata)
  are still read as a fallback and map to `custom`, so existing boards
  keep working.
- Organize Screens arrange-sections path now equalises every
  selected section to the height of the tallest section before
  positioning, so the grid reads as one aligned band. Sections
  never shrink; locked / non-resizable sections are skipped silently
  and reported in the new `skippedHeightCount` result field. Always
  on — no new MCP / UI parameter. Engine bumped to v4.
- Organize Screens engine now lives in `engine-inline.ts` (injected from
  `src/organize-screens/engine.js` via `build:plugin:engine`). `code.ts`
  imports the three runtime entry points instead of hosting a 2 200-line
  inline block. `build-plugin.js` fails if markers reappear in `code.ts`.
- `customBase64Encode`, `setCharacters`, and `uniqBy` moved to
  `src/lib/`; `setcharacters.js` orphan removed.
- Settings progress bar uses `--p` CSS variable only (no inline `width`).
- `clientStorage` writes for settings and analytics init now go through a
  serialised `queueWrite` chain (`lib/clientStorage.ts`).

### Changed

- **MCP handler decomposition.** The 4.8k-line `src/code.ts` is now a
  ~330-line bootstrap. The 45 MCP command handlers were extracted
  into focused modules under `src/mcp-handlers/`
  (`document.ts`, `nodes.ts`, `export.ts`, `geometry.ts`, `text.ts`,
  `components.ts`, `instance-overrides.ts`, `autolayout.ts`,
  `variables.ts`, `annotations.ts`, `figjam.ts`) plus the
  dispatcher (`handle-command.ts`) and registry
  (`command-registry.ts`). Cross-runtime helpers moved to
  `runtime/` (`progress.ts`, `plugin-state.ts`, `skills.ts`,
  `selection-probes.ts`) and `lib/delay.ts`. `code.ts` now only owns
  bootstrap, `figma.ui.onmessage` routing, and the dispatcher
  wiring. Behaviour is unchanged; this is a pure structural move.
  Small, already-typed modules (`document.ts`, `nodes.ts`,
  `export.ts`, `runtime/progress.ts`) drop their `@ts-nocheck`
  pragma; the larger handler files keep theirs until parameter types
  are derived from the MCP server's Zod schemas.

### Fixed

- The Organize Screens "Flow Overlay" frame is now inserted at the
  bottom of the `Section Container` z-order instead of the top, so it
  renders behind the screen cards and no longer intercepts clicks.
  Screens stay directly selectable and editable while flow arrows are
  shown.
- Organize Screens no longer mislabels modern boards as
  **"(legacy structure)"**. The "legacy" label was inferred whenever a
  board's metadata could not be read, which happened when the metadata
  envelope silently exceeded Figma's 100 kB per-entry
  `sharedPluginData` limit (large boards / long descriptions). Legacy
  is no longer inferred from missing metadata: every recognized board
  is treated as modern, and the banner is now driven by Board Type
  ("Edit Design Review board" or "Edit this board"). The `edit-legacy`
  mode has been removed. Supporting changes: a tiny always-writable
  `boardType` marker is persisted alongside the envelope so the board
  type survives even if the envelope cannot; `osPersistBoardEnvelope`
  degrades gracefully (trims card copy, then variant groups) instead
  of silently dropping all metadata, and logs a warning rather than
  swallowing the error; and `osCoerceMetadata` now accepts any
  envelope with a `settings` object regardless of `schemaVersion`, so
  a future schema bump can never demote a board to "legacy".
- Organize Screens panel now stays in sync with the selected board.
  Selecting a plugin-generated board as part of a **multi-node
  selection** (the section shift-clicked with another node, or an
  inner node alongside others) now correctly enters **Edit this
  board** mode instead of falling back to compose/idle — the probe
  resolves the single plugin board in the selection rather than only
  acting on single-node selections. Compose is no longer offered for a
  board's own embedded screens, and switching Figma pages now
  re-probes so the panel never shows a stale board from a previous
  page. Selecting 2+ sections still enters arrange mode.
- Orientation (`row` / `column` / `grid`) is now honoured when
  arranging a selection of presentation Sections. Previously the
  arrange-sections path always derived column count from the
  personality and ignored the chosen orientation. A new
  `osPickSectionColumns` helper maps `row` to a single row, `column`
  to a single column, and `grid` to a square-ish grid
  (`osPickSquareGridColumns`); `passthrough` keeps the personality
  heuristic. For an explicit `grid`, columns and rows are now aligned:
  cells snap to a shared per-column X (widest section per column) so
  they line up across rows even when sections differ in width.
- Generated text nodes (section title, section description, card
  title, card description, cluster label, annotation hint) now wrap
  and fill their auto-layout parent's width instead of hugging
  content and overflowing the embedded screen frame. Long copy now
  wraps inside the card. Implemented by a new `osMakeTextFill`
  helper in [`engine.js`](../organize-screens/engine.js) that sets
  `textAutoResize = "HEIGHT"` and `layoutSizingHorizontal = "FILL"`;
  the section header is also pinned to `FILL` so its text children
  resolve against the Screens Grid width. The non-auto-layout
  annotation slot keeps its fixed-size design but the hint text now
  wraps within `slot.width - 48`.
- `set_instance_overrides` MCP command no longer falls through to
  `set_layout_mode` when `targetNodeIds` is missing.
- Removed dead `init-settings` postMessage (no UI handler existed).
- Stripped debug `console.log` instrumentation from the plugin runtime.
- Selection-context probes now run through a per-skill registry
  (`runtime/selection-probes.ts`) instead of a hard-coded
  Organize-Screens-only push. The runtime keeps **one** debounced
  `selectionchange` listener; each skill registers its probe at
  bootstrap; a failing probe yields `idle` for that skill alone. The
  UI message contract switches from `selection-context` (single
  payload) to `selection-contexts` (map of `{ [skillId]: context }`),
  and `SkillContext.getSelectionContext(skillId)` /
  `onSelectionContextChange(skillId, …)` are now skill-scoped so an
  unrelated probe firing does not re-render every panel.
- MCP commands that the running editor cannot service now fail fast
  with a clear `command-error` envelope. The dispatcher
  (`mcp-handlers/handle-command.ts`) calls `assertCommandEditor`
  from a single registry (`mcp-handlers/command-registry.ts`) before
  any Plugin API call, so a design-only command run in FigJam (e.g.
  `create_frame`, any Variables write) returns "Command `…` runs in
  the Figma design editor only (current: figjam)." instead of an
  obscure API throw. FigJam-only commands (`set_default_connector`,
  `create_connections`) are gated the other way.

### Changed

- Row orientation now places every selected screen in a single horizontal
  row (`singleRow`) with no `maxPerStrip` wrap. Column orientation stacks
  every screen in one vertical column (`singleColumn`) with no segment
  grouping at large counts. Grid orientation uses `osPickSquareGridColumns`
  to minimize the difference between column and row count (square grid).

### Fixed

- Plugin did not open at all: esbuild wraps `code.js` in an IIFE, so
  Figma's runtime `__html__` global was never visible to
  `figma.showUI(__html__, …)`. The build now inlines the full
  self-contained `dist/ui.html` string into `figma.showUI` at build
  time (`injectUiHtmlIntoCode` in `scripts/build-ui.mjs`).
- Blank plugin window: UI CSS and JS are inlined into one HTML
  document (no external `<script src>` / `<link href>` — those do not
  load in Figma's iframe).

### Added

- **Screen Layout Orientation** axis on Organize Screens. New opt-in
  `orientation` param (`row` / `column` / `grid`) in the plugin panel
  and the `organize_screens` MCP tool. Omitting it preserves the
  calibrated baseline exactly. `row` forces the auto strip/grid path,
  `column` produces a vertical narrative (1 card per row, auto-segmented
  into `Segment N` clusters at 6+ screens), and `grid` produces a
  near-square balanced grid. Orientation overrides the personality's
  strategy preset when explicit; personalities still drive token scales,
  column caps, and width thresholds. Orientation also adds annotation
  default nudges that only fire when the user did not supply
  mode/position. Orientation is recorded in `compositionPlanSummary`,
  the result envelope, and the `sharedPluginData` metadata.
- Extensible skill router on the plugin landing screen. Skills are
  registered through a typed `SkillDef` in
  `src/skills/registry.ts`; adding a new skill = one new file under
  `src/skills/` plus one push into the `SKILLS` array in `src/ui.ts`.
- Organize Screens skill panel with personality picker
  (Review / Presentation / Portfolio / Workshop / Documentation),
  annotation override (off / compact / expanded), and an inline
  result block (cards / columns / strategy / personality).
- `run-skill` message lane on the plugin runtime
  (`code.ts -> organizeScreensFromSelection`) returning typed
  `skill-result` / `skill-error` envelopes. The legacy MCP relay
  `execute-command` -> `command-result` / `command-error` lane is
  untouched.
- Runtime editor gate: `Organize Screens` short-circuits with a
  `figma.notify(...)` toast when run in FigJam, satisfying the
  kit's `figma-plugin-editor-gates.mdc` rule while keeping FigJam
  available for the rest of the MCP relay commands.
- Postbuild verifiers (`scripts/verify-es2019.js`,
  `scripts/verify-manifest.js`) copied verbatim from the kit,
  wired through `bun run build:plugin`.
- `@figma/plugin-typings` and `esbuild` dev dependencies for the
  new TS + esbuild build pipeline.
- Plugin-side `CHANGELOG.md` (this file) and refreshed
  `readme.md` documenting the new run + nav model.

### Changed

- Kit-aligned plugin layout. Plugin source now lives under
  `src/cursor_mcp_plugin/src/`:
  - `code.ts` (renamed from `code.js`; engine-injection markers
    retained verbatim so `bun run build:plugin` still injects the
    Organize Screens engine in one step)
  - `ui.html` (shell only — loads `./styles.css` and `./ui.js`)
  - `ui.ts` (router + WebSocket relay + analytics + message pump)
  - `styles.css` (`--figma-color-*` tokens; no hard-coded hex
    values, no inline `style=""` with real CSS declarations)
  - `types.ts` (typed `UiToPluginMessage` /
    `PluginToUiMessage` unions)
  - `lib/pluginMessage.ts` + `lib/inlineConfirm.ts` (kit-canonical
    helpers, copied verbatim from
    `create-plugin-starter-kit/shared/ui/`)
  - `skills/registry.ts`, `skills/settings.ts`,
    `skills/organize-screens.ts`
- `manifest.json` rewritten:
  - `main` -> `dist/code.js`, `ui` -> `dist/ui.html`
  - `networkAccess.allowedDomains` now lists only
    `https://www.google-analytics.com` (the kit verifier
    hard-fails on `localhost` in `allowedDomains`); the WebSocket
    relay endpoint `ws://localhost:3055` and its HTTP companion
    moved into `devAllowedDomains` alongside the GA endpoint
  - explicit `reasoning` field documents the analytics endpoint
    and the local-dev intent of the plugin id
- The current MCP connection / channel / MCP config / progress UI
  is now the **Settings** entry under a "System" group on the
  landing screen, accessed via a single click + Back button.
  WebSocket and analytics state lives in the shell (`ui.ts`
  module scope) so auto-connect on plugin open keeps working
  regardless of which panel is active.
- Figma UI theme: `figma.showUI(__html__, { themeColors: true })`
  with `--figma-color-*` tokens in `styles.css`. The plugin
  follows the user's Figma light / dark theme automatically.
- UI bundle is now produced by esbuild
  (`scripts/build-ui.mjs`, target `es2019`, format `iife`) so
  modern TS / JS is downlevelled before reaching Figma's QuickJS
  runtime. Two-step build composes the engine inject
  (`scripts/build-plugin.js`) and the bundle.
- `scripts/build-plugin.js` `codePath` now targets
  `src/cursor_mcp_plugin/src/code.ts`; the engine markers stay
  in `code.ts` to minimise the delta from the previous design.

### Removed

- Old `src/cursor_mcp_plugin/code.js` and
  `src/cursor_mcp_plugin/ui.html` (replaced by the new
  TS + bundled-asset pipeline under `src/cursor_mcp_plugin/src/`).
