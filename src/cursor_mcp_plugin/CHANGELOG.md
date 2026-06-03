# Changelog

All notable changes to the **Cursor MCP Figma Plugin** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- **Functional analysis now fills the section Overview Header** — running
  Create Documentation on a Functional Analysis board left the **Section Title**
  and **Section Description** at their placeholders, because the Overview Header
  synthesis only ran for the Design Review *Describe* action and read the (empty)
  Card Description. Documentation runs now synthesize the title + description
  from the documented Functional Cards on canvas (Advanced = the long-form
  document; Basic = the filled section fields), reusing the same section-meta
  path as Describe. Applies to both single-screen and whole-section runs.

### Added

- **Export Advanced functional documentation as a `.md` zip** — Advanced
  Functional Analysis boards now show an **Export documentation (.md zip)**
  button. It bundles each screen's long-form markdown into one `.zip`
  (one `.md` per screen) and downloads it from the plugin UI. Scope follows the
  selection: selected Screen Cards export just those screens, otherwise the
  whole board is exported. The button only appears in **Advanced** mode (Basic
  cards have no single document), placeholder/empty documents are skipped, and
  the archive is built by a zero-dependency STORE-method zip writer in the UI
  lane (no new packages, no network).

- **Advanced functional analysis is now cross-screen aware** — when documenting
  a Functional Analysis board in **Advanced** mode, each screen's analysis now
  receives the other screens in the run (their names, in order) plus the board's
  Flow arrow connections and labels when Flow is enabled. The prompt treats the
  set as one connected user journey and adds a new **Related Screens & Flow
  Context** section (Previous/Next screen(s), Trigger, Data transferred,
  Assumptions), so the model describes navigation between screens instead of
  reporting "downstream screens unavailable" for screens that are actually part
  of the same set. Both section ("document all screens") and single-screen runs
  get this context; cross-screen behavior the model cannot directly see is
  marked as assumptions. Basic functional and Design Review are unchanged.

- **Functional Analysis: Basic / Advanced modes** — Functional Analysis boards
  now offer a "Functional Analysis mode" sub-select (shown only for that board
  type). **Basic** (default, unchanged) keeps the eight structured fields
  (Purpose, User Actions, …, Open Questions). **Advanced** renders a single
  long-form documentation field on each Functional Card, filled by the new
  Functional Analyst prompt (`FUNCTIONAL_ANALYST_PROMPT.md`) and rendered as one
  markdown block. The mode is persisted per board, threaded through compose and
  recompose, and resolved structurally so Create Documentation requests the
  matching prompt and token budget. Switching a board between modes rebuilds the
  Functional Card and does **not** carry the current documentation across (the
  two structures share no field keys); a dedicated confirmation makes this
  explicit instead of the generic "text is always preserved" copy. Advanced docs
  are preserved across same-mode Functional → Custom → Functional round trips.

### Changed

- **Advanced functional documentation now returns raw markdown instead of
  JSON-wrapped markdown** — forcing a long-form report into a single JSON string
  under `response_format: json_object` made models emit invalid JSON (unescaped
  newlines/quotes) or truncate the string unparseably, so every Advanced run
  failed with "Response was not valid JSON" and wrote nothing. The backend now
  accepts an optional `responseFormat` ("json" default, "text" for Advanced) and
  skips `response_format`/JSON normalization in text mode; the Advanced prompt
  asks for plain markdown (with a `SKIP: <reason>` line to decline); and the
  validator treats the content as markdown (fence-stripped, clamped) while still
  accepting the legacy `{ document, meta }` JSON shape. Basic functional, Design
  Review, and the section summary are unchanged (still JSON). A truncated report
  is now usable text rather than a hard failure.

### Fixed

- **Create Documentation timed out before the backend finished (Advanced mode)**
  — the client aborted every request at a fixed 45s, but the Vercel function is
  allowed to run up to 60s (`maxDuration`), so a slow long-form Advanced
  generation surfaced as "Analyze request timed out" even while the backend was
  still working. The client timeout is now 65s (just past the backend budget) and
  is overridable per request; the Advanced functional path requests a much longer
  client timeout so it can wait out the backend's full budget. Note: the true
  ceiling is still the Vercel function `maxDuration` — if Advanced screens still
  time out, raise `maxDuration` in `vercel-backend/vercel.json` (requires a plan
  that allows it) and redeploy. The backend `maxDuration` was raised from 60s to
  300s to give long-form Advanced reports room to finish.

- **Create Documentation (section scope) silently produced no results in
  Advanced mode** — "Document all screens" ran the progress counter to the end
  and wrote nothing, with no error, whenever the model output failed validation
  on every screen. The section loop counted each failure as a bare "skipped"
  with no reason. Two changes: (1) the section path now captures the dominant
  failure reason (invalid format, model declined, or "came back but did not
  match these cards' fields") and surfaces it as a "Why" line in the result plus
  an error toast when nothing was written, so a section run is never silently
  empty; and (2) a screen that validates but writes nothing back is now counted
  as skipped instead of reported as a success.

- **Advanced documentation JSON truncated against the token ceiling** — the
  long-form Advanced report is wrapped in a single JSON string, so a model that
  overshot the target length exceeded the 4000-token budget and the JSON was cut
  mid-string, no longer parsing (the screen was skipped). The Advanced token
  budget was raised on both the runtime request (`FUNCTIONAL_ADVANCED_MAX_TOKENS`
  → 8000) and the backend clamp (`MAX_TOKENS_CEILING` → 8000). Redeploy the
  Vercel backend for the higher ceiling to take effect.

- **Review fields did not start as bullet lists by default** — Design Review
  feedback sections now apply native UNORDERED list formatting to their default
  placeholder text as well as restored reviewer content, so newly composed
  "Review Field Text" nodes are list-first. Notes and prose fields remain plain.

- **Review fields lost their bullets after recompose** — Design Review
  multi-item fields (What's good / Questions / Concerns / Ideas) were only
  turned into native UNORDERED lists by the AI apply path. The build/recompose
  path re-created each "Review Field Text" node from the stored multi-line text
  as plain paragraphs, so the bullets disappeared on the next recompose (Apply
  changes, board edits, board-type switch) and never appeared on rebuilt boards.
  List formatting is now applied in the build path too, via a shared
  `osApplyReviewFieldListFormatting` helper (2+ non-empty lines → UNORDERED,
  otherwise plain text; placeholders stay plain), so existing boards self-heal
  on the next recompose.

- **Functional Header confidence note rendered vertically** — the "Confidence:
  …" note in a Functional Card header was built as a FILL + HEIGHT-autoresize
  text node while empty, so it collapsed to ~0 width and wrapped one character
  per line (and stretched the header to ~575px tall). It now hugs its content on
  a single line. The Create Documentation apply path re-asserts the hug sizing,
  so boards built before this fix self-heal on the next documentation run.

- **Create Documentation analyzed the wrong frame (empty scaffold instead of the
  screen)** — on a Functional Analysis card the embedded screen and the
  `Functional Card` are direct siblings, and `osCardEmbeddedFrame` popped the
  non-wrapper-named `Functional Card` first and returned it as the "embedded
  frame". Create Documentation therefore exported a screenshot of the empty
  functional scaffold, so the model "documented" the template (placeholder
  fields, save/submit actions, authorship questions) rather than the actual
  screen. `osCardEmbeddedFrame` now skips the `Functional Card` without
  descending into it, so the real embedded screen is exported. Design Review was
  unaffected (its `Review Card` is a layout-wrapper name nested under
  `Card Body`).

- **Selection-probe traversal lag on large boards** — selecting a Design Review
  or Functional Analysis board (or a card on one) could still hang the canvas
  for 1.5-2.5s on a 10-card board even after the debounce/namespace fixes. Two
  genuine traversal costs are removed: (1) the probe now scopes
  `figma.skipInvisibleInstanceChildren = true` to its read body (save/restore,
  so MCP node-inspection and recompose are unaffected); (2) the section
  eligibility resolvers reuse a single bounded per-card index instead of walking
  each card's subtree ~4× — the index treats the embedded user screen as a leaf,
  so a card's cost is O(card layout) instead of O(embedded design). The board-
  type surface checks (`osBoardHasDesignReviewSurface` /
  `osBoardHasFunctionalSurface`), which run when a board has no persisted
  boardType marker, are bounded the same way. Net: probe time on a 10-card board
  dropped from ~2.5s to ~80-160ms, and marker-less board-type inference from
  ~200ms/card to ~3ms/card. The apply path is unchanged (it calls the resolvers
  without the index fast-path).

- **Invalid SharedPluginData namespace (major lag + broken persistence)** — the
  `organize-screens` engine used `"organize-screens"` as its SharedPluginData
  namespace, but Figma only allows alphanumeric characters, `_` or `.`. Every
  `get/setSharedPluginData` call therefore threw, and the exception unwinding in
  the Figma sandbox cost hundreds of ms per call (a 5-card board's selection
  probe took 2-4s, making the canvas lag). The namespace is now
  `"organizeScreens"`, which eliminates the throws and lets board metadata,
  `flowFrameIds`, review/functional field text, and the boardType marker
  persist for the first time. A new `scripts/verify-plugin-namespace.js`
  postbuild check fails the build if any SharedPluginData namespace contains an
  invalid character, so this cannot regress silently.

- **Canvas lag while the plugin is open** — the selection-context probe no
  longer runs synchronously on every `selectionchange`. It now runs once per
  settled selection on a trailing-only debounce (~200ms), and a selection
  signature guard skips the recompute entirely when a `selectionchange` fires
  with the same selection. The probe also gates its Analyze Design and Create
  Documentation eligibility resolvers on the resolved board type, so the
  full-board scan for the non-matching surface never runs. Marquee/drag-select
  and rapid clicking on large boards no longer freeze the canvas.

- **Review fields as native unordered lists** — **Review design (AI)** and **Reset review
  results** now write multi-item review fields (`workingWell`, `questions`, etc.) as
  Figma native **UNORDERED** list spans (`setRangeListOptions`) instead of joining
  lines with ad-hoc `•` prefixes. Copy stays verbatim; single-item fields and
  `notes` remain plain text. Functional Analysis still uses the legacy bullet join.

- **Section Description max width** — Overview Header descriptions wrap at **1620px**
  instead of stretching full-bleed with the board. Applied at compose, recompose,
  and when **Describe** writes section meta (migrates legacy FILL nodes).

- **Describe screen (AI)** now updates the section **Section Title** and **Section
  Description** in the Overview Header for card-scoped runs too (not only
  section-scoped batches). Previously the header stayed at the default
  "Screen Overview" when describing a single selected card.
- **Section-scoped Describe** now re-reads live Card Description text from the
  canvas before synthesizing the section header (so the summary step always
  sees what was actually written), derives a title when the model omits one,
  syncs the Figma section layer name with the new title, and falls back to a
  local summary when the text-only AI call fails.

### Added

- **Functional Analyst expert prompt reference** — added a reusable
  stakeholder-focused prompt for the Functional Analysis flow, ready to be wired
  into the plugin's Create Documentation prompt builder.

- **Selective flow on Apply Changes** — when editing a board with **Show as
  flow** on, selecting a **subset of 2+ Screen Cards** and clicking **Apply
  changes** now draws flow arrows **only between those screens, in selection
  order**, instead of across every card. Selecting **all** cards returns to the
  whole-board overlay; any other selection (the section, a single card) leaves
  the current scope untouched, so an incidental orientation/board-type edit
  preserves the subset. The scope is persisted in board metadata
  (`settings.flowFrameIds`) and replayed on later recomposes; removed screens
  drop out, and a scope with fewer than 2 survivors falls back to whole-board.
  The panel previews the scope ("Flow: N selected screens") and the Apply
  confirm states it before committing.

- **Functional Analysis board type** — a third board type alongside Custom and
  Design Review. It reuses Custom's token scales but uses its own 1–2 column
  policy and stacks a full-width **Functional Card** under each screen with eight
  editable documentation sections (Screen Purpose, User Actions, System
  Behavior, Inputs / Outputs, States, Business Rules, Missing Functionality, Open
  Questions). Each section is one tagged TEXT node (`osFuncField`); the card
  frame is tagged `osFuncCard`. Generated/edited text round-trips through
  recompose and survives Functional → Custom → Functional board-type switches
  via the metadata `copyBaseline.doc`.
- **Create Documentation (AI)** — a single adaptive Functional Analysis action
  (card scope when one card is selected, section scope otherwise) that exports
  each screen, sends it through the existing Bonzai vision backend with a new
  `functionalAnalysis` analysis mode, and writes structured functional
  documentation into the Functional Card. Inputs/Outputs and States are flattened
  into labelled lines so each section stays a single editable node. A muted
  confidence note renders in the card header; the model can decline cleanly via
  `meta.skippedReason`. A local **Reset documentation** action returns the card's
  sections to placeholders.
- **Section-scoped Describe / Review / Reset** — when a Design Review section
  (rather than a single card) is selected, the three actions run on every
  standard review screen in the section. The runtime loops screens (yielding
  between each) and shows per-screen progress; a confirm dialog reports the
  screen count before any AI run.
- **Section title + description synthesis** — section-scoped **Describe** makes
  one extra text-only Bonzai call that synthesizes a Section Title and Section
  Description from the per-screen descriptions and writes them to the Overview
  Header (`osApplySectionMeta`). Review and Reset never touch section meta.
- **Reset review results** — a local (no-network) Design Review action that
  returns the review section (What's good / Questions / Concerns / Ideas /
  Notes) to its default placeholder text. Writes the byte-exact placeholders so
  recompose re-reads the fields as empty. Leaves the Card Description untouched.

### Changed

- Analyze Design backend route now honors an optional, clamped `max_tokens`
  (256–2500, default 1200). The functional documentation mode requests a higher
  ceiling so its eight-section JSON does not truncate; Design Review keeps the
  default. The `analyzeOneScreen` runtime was parameterized by an analysis
  binding `(mode, apply, maxTokens)` so Design Review and Functional Analysis
  share one export → call → validate → apply pipeline with the Design Review
  output unchanged.
- Split the single **Analyze design (AI)** button into two scoped AI actions:
  **Describe screen** (fills only the Card Description) and **Review design**
  (fills only the review section). Each makes an independent, scoped Bonzai call
  so the model returns just what that action writes. A shared busy state
  disables the other actions while any one is running.
- Analyze Design backend now accepts **text-only** requests (`imageBase64`
  optional): a vision request when an image is supplied, otherwise a text-only
  request — used by the section summary synthesis.
- Point the Analyze Design client and manifest at the **stable** Vercel alias
  (`figma-plugin-organize-screens.vercel.app`) instead of a deployment-specific
  hash URL, so redeploys no longer require updating the URL/manifest.

### Fixed

- Analyze Design now writes the review fields (What's good / Questions /
  Concerns / Ideas / Notes), not just the Card Description. The apply step fell
  back to a tag-only (`osReviewField`) lookup that missed boards where the tags
  were absent or stale; it now resolves each field structurally via the
  `Review Section / <key>` frame as a fallback.

- Analyze Design: parse Bonzai responses wrapped in markdown `` ```json `` fences
  (common with `claude-sonnet-4-6` despite `json_object` mode). Normalized on
  the Vercel route and in `parseModelJsonContent()` before validation.

- Analyze Design: clearer errors when Vercel **Deployment Protection** blocks
  the API (common symptom: "Failed to fetch" in Figma). README documents the
  Production → disable Vercel Authentication fix.

### Changed

- Analyze Design always overwrites Card Description and review fields when the
  model returns content for them (removed placeholder-skip logic and the
  overwrite confirmation dialog).

- Analyze Design production backend: `manifest.json` `allowedDomains` and
  `analyzeDesignClient.ts` (`API_BASE`, `ALLOWED_HOSTS`) now point at
  `figma-plugin-organize-screens-aok9qwydw-io-technology.vercel.app` (replaces
  the placeholder `cursor-figma-analyze.vercel.app`). Re-import the plugin
  manifest in Figma Desktop after this change.

### Added

- **Analyze Design (AI)** for Organize Screens Design Review boards. Selecting a
  single Design Review Screen Card reveals an **Analyze design (AI)** action that
  exports the screen (PNG, 1024px wide), sends it to a Vercel-hosted Bonzai
  vision backend, validates the structured JSON response, and fills the card's
  **Card Description** and review fields (`workingWell`, `questions`, `concerns`,
  `ideas`, `notes`). The Bonzai key stays server-side: the plugin talks only to
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
