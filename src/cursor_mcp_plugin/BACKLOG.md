# Cursor MCP Plugin — Backlog

Platform maintainability items from the plugin audit (`create-plugin-starter-kit/prompts/review-plugin.md`). Not versioned for release — move entries to `CHANGELOG.md` when shipped.

---

## Maintainability

### Fully type extracted MCP handlers

The decomposition in [`CHANGELOG`](CHANGELOG.md) (Unreleased / Changed) split `code.ts` into focused `mcp-handlers/` and `runtime/` modules. The small read-side modules (`document.ts`, `nodes.ts`, `export.ts`, `runtime/progress.ts`) dropped `@ts-nocheck`; the larger write-side handlers still need parameter types derived from the MCP server's Zod schemas in [`src/talk_to_figma_mcp/server.ts`](../talk_to_figma_mcp/server.ts).

**Acceptance (draft):**

- `@ts-nocheck` removed from `geometry.ts`, `text.ts`, `components.ts`, `instance-overrides.ts`, `autolayout.ts`, `variables.ts`, `annotations.ts`, `figjam.ts`, `runtime/skills.ts`, and `mcp-handlers/handle-command.ts`.
- Handler parameter shapes match the Zod schemas; the dispatcher's `MCPHandlers` interface uses those shapes instead of `any`.
- `tsc --noEmit` keeps passing.

### Type the runtime <-> engine boundary

`runtime/analyze-design.ts`, `code.ts`, and the generated `engine-inline.ts` all carry `@ts-nocheck`, so the contract between the engine and its runtime consumers is unchecked. Engine-export drift is invisible to the compiler — e.g. the recently added `staleStructure` field on `osApplyFunctionalAnalysis`'s return is untyped at the call site, and a rename or shape change in any `os*` export would compile cleanly while breaking at runtime.

**Acceptance (draft):**

- A typed declaration (`.d.ts`) describes the `engine-inline` exports that `runtime/analyze-design.ts` imports (`osApplyFunctionalAnalysis`, `osCollectFunctionalDocuments`, `osResolveCreateDocumentationTarget`, `osBuildFunctionalJourneyContext`, the design-review and section-meta helpers, etc.) with their real argument/return shapes.
- `@ts-nocheck` removed from `runtime/analyze-design.ts`; only the errors that surface there are fixed (scope it to this one module first).
- `tsc --noEmit` keeps passing; `code.ts` and `engine-inline.ts` can stay `@ts-nocheck` for a later pass.

---

## Ideas (not yet scoped)

- **Hybrid Functional Analysis: plugin batch + Cursor skill post-processing** —
  keep the heavy, parallelizable work (export + 2-pass vision generation +
  canvas apply, with the C=3 pool and fast model) in the plugin pipeline, and
  add a Cursor skill (over the talk-to-figma MCP) for the things an agent
  uniquely enables: reasoning across the whole report corpus and access to the
  product codebase. The division follows where each runtime has a structural
  advantage — vision/batch stays in the plugin; text reasoning + repo access
  moves to the skill. Critically, the agent never handles images (only the
  generated markdown), so it avoids the relay/context cost that makes a
  pure-MCP rewrite several-fold to an order of magnitude slower than the
  ~75–90s plugin batch.
  - **Handoff (already exists):** the plugin stores the full report per card in
    `sharedPluginData` and exports the `.md` zip. The skill consumes that corpus
    as text — either reading the exported `.md` files from disk or via an MCP
    "read stored report" command. Treat the report schema as the shared
    contract so the two surfaces stay decoupled.
  - **Candidate skill workflows:** (1) validate docs against the codebase (flag
    documented requirements/navigation with no matching component or route,
    surface Code Connect gaps); (2) synthesize a single end-to-end journey doc /
    PRD from the per-screen reports; (3) targeted single-screen refinement
    ("expand error states on screen 4") where serial agent latency is fine;
    (4) export the `.md` set into the product repo as a PR (GitHub-PR-export
    pattern).
  - **Two kickoff patterns:** two-step (user runs plugin, then invokes the skill
    on the output — no plugin changes) or skill-orchestrated (skill triggers the
    plugin batch via one MCP command, then post-processes — keeps concurrency +
    fast model inside the plugin).
  - **Start here:** workflow (1) or (2) in two-step mode needs *no plugin
    changes* — just a skill that reads the existing `.md` corpus. Proves the
    value with zero risk to the fast pipeline; invest in MCP-triggered
    orchestration only if the two-step UX feels clunky.
  - **Trade-offs:** two surfaces to maintain + a shared report-schema contract;
    repo-aware steps only work where the skill can see the codebase (Cursor), so
    designers running the plugin standalone still get the fast docs but not the
    code-aware enrichment.

- **Describe screen and Create Documentation should fill Flow Label Text** — when
  **Describe screen (AI)** or **Create Documentation (AI)** runs on a board with
  flow arrows enabled, the model should also write short step labels into each
  arrow's **Flow Label Text** node (currently `"Describe interaction ..."` by
  default). Labels are indexed in arrow order via `osCollectFlowLabels` /
  `flowLabels` on recompose, so the apply path needs to resolve the correct
  overlay node per card transition, extend the analysis schema with one label per
  arrow (or derive from screen purpose / user actions), and persist through
  recompose like other editable board text.
- Add `engineVersionTooNew` mode to `OrganizeScreensSelectionContext` when metadata references an unsupported engine version (read-only edit UI + "Rebuild recommended" banner).
- Recompose progress + cancel via existing `command_progress` pattern for 100+ screen boards.
- Build-time assertion script (`verify-engine-sync.js`) runnable in CI separate from inject step.
