# organize-screens engine

Composition engine for `/organize-screens` v3:

1. **Compose** — FRAME selection → new presentation board (Section → Overview Header → Screen Cards at native size).
2. **Arrange sections** — 2+ presentation Sections → grid layout (reposition only).

Behavior is driven by a **Board Type**: `custom` (the calibrated baseline), `design-review` (the same layout plus an editable Review Card under each singleton screen), or `functional-analysis` (a 1–2 column layout with a full-width Functional Card stacked under each screen for structured functional documentation, fillable with AI via **Create Documentation**). Legacy personality ids (review, presentation, portfolio, workshop, documentation) all map to `custom`. See [`.cursor/skills/organize-screens/reference.md`](../../.cursor/skills/organize-screens/reference.md) for tokens, planner rules, board-type profiles, and the Review / Functional Card structure. Planned work: [`.cursor/skills/organize-screens/BACKLOG.md`](../../.cursor/skills/organize-screens/BACKLOG.md).

## Files

| File | Role |
|------|------|
| `engine.js` | Source of truth. Plain JS, runs inside the Figma plugin context (depends on the global `figma`). |
| `types.d.ts` | TypeScript types for the MCP tool and IDE help. |

## How it ships

1. The engine is wrapped between the markers `/* ORGANIZE_SCREENS_ENGINE:START */` and `/* ORGANIZE_SCREENS_ENGINE:END */`.
2. `scripts/build-plugin.js` reads `engine.js` and injects its body between the same markers in `src/cursor_mcp_plugin/code.js`.
3. `code.js` exposes the engine via:
   - `case "organize_screens"` in `handleCommand` (MCP / WebSocket path).
   - `figma.on("run", ...)` for the **Organize Screens** menu command.
4. Run `bun run build:plugin` after editing `engine.js` to keep `code.js` in sync.

## use_figma (Cursor skill) path

The Cursor skill in `cursor-talk-to-figma-mcp/.cursor/skills/organize-screens/` references this engine. When TalkToFigma is not connected, the agent inlines the engine body verbatim into a `use_figma` call so the same composition is produced via the official Figma MCP.

## Public entry point

```ts
organizeScreensFromSelection(params?: OrganizeScreensParams): Promise<OrganizeScreensResult>
```

See `types.d.ts` for the shape of params, results, and plans. The `boardType` param accepts `custom` (default), `design-review`, or `functional-analysis`; the deprecated `personality` / `layoutMode` params are still accepted and map to `custom`.
