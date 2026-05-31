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

---

## Ideas (not yet scoped)

- Add `engineVersionTooNew` mode to `OrganizeScreensSelectionContext` when metadata references an unsupported engine version (read-only edit UI + "Rebuild recommended" banner).
- Recompose progress + cancel via existing `command_progress` pattern for 100+ screen boards.
- Build-time assertion script (`verify-engine-sync.js`) runnable in CI separate from inject step.
