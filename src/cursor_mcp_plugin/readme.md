# Cursor MCP Figma Plugin (local dev)

A Figma plugin that lets Cursor drive Figma over an MCP relay. It also
hosts skill panels for one-click design operations such as
**Organize Screens**.

This plugin is **never published to the Figma Community**. The plugin
id is `cursor-mcp-plugin-local-dev`; install it as a Development
plugin in Figma Desktop and point it at a local
`bunx cursor-talk-to-figma-socket` relay.

## Layout (kit-aligned)

```text
src/cursor_mcp_plugin/
├── manifest.json
├── tsconfig.json
├── CHANGELOG.md
├── BACKLOG.md
├── readme.md            (this file)
├── src/
│   ├── code.ts          plugin bootstrap + UI message routing (~330 lines)
│   ├── engine-inline.ts Organize Screens engine (injected from engine.js)
│   ├── ui.html          source stub; dist/ui.html is built (inlined CSS+JS)
│   ├── ui.ts            shell router, WebSocket state, analytics
│   ├── styles.css       --figma-color-* tokens; no inline styles
│   ├── types.ts         typed UiToPluginMessage / PluginToUiMessage
│   ├── lib/
│   │   ├── pluginMessage.ts   kit-canonical origin-guard helper
│   │   ├── inlineConfirm.ts   kit-canonical inline confirm helper
│   │   ├── clientStorage.ts   serialised clientStorage writes
│   │   ├── base64.ts          export image helper
│   │   ├── setCharacters.ts   mixed-font text mutation helper
│   │   ├── uniqBy.ts          array dedupe helper
│   │   └── delay.ts           sleep helper used by chunked loops
│   ├── runtime/
│   │   ├── plugin-state.ts    serverPort + serialised settings writes
│   │   ├── progress.ts        sendProgressUpdate + generateCommandId
│   │   ├── selection-probes.ts per-skill selection-context registry
│   │   └── skills.ts          run-skill / apply-board-changes runtime
│   ├── mcp-handlers/
│   │   ├── command-registry.ts editor-gate map for all 45 commands
│   │   ├── handle-command.ts   dispatcher factory used by code.ts
│   │   ├── document.ts         getDocumentInfo / getSelection / readMyDesign
│   │   ├── nodes.ts            rgbaToHex / filterFigmaNode / getNodeInfo / getNodesInfo
│   │   ├── export.ts           exportNodeAsImage
│   │   ├── geometry.ts         frames, fills, strokes, generic node ops
│   │   ├── text.ts             createText / setTextContent / scan / setMultiple
│   │   ├── components.ts       styles, local components, instances, Variants
│   │   ├── instance-overrides.ts get/set instance overrides
│   │   ├── autolayout.ts       setLayoutMode / setPadding / setAxisAlign / …
│   │   ├── variables.ts        Variables API reads + bindings
│   │   ├── annotations.ts      annotations + scanNodesByTypes + getReactions
│   │   └── figjam.ts           setDefaultConnector / createConnections
│   └── skills/
│       ├── registry.ts            SkillDef + SkillContext contracts
│       ├── settings.ts            Connection + MCP config + Progress
│       └── organize-screens.ts    Compose / edit form + result
└── dist/                 build output (code.js, self-contained ui.html)
```

The single source of truth for the Organize Screens engine is
`src/organize-screens/engine.js` (in the repository root, not in this
folder). `scripts/build-plugin.js` splices its body between the
`ORGANIZE_SCREENS_ENGINE:START / END` markers in `src/engine-inline.ts`;
`code.ts` imports the three runtime entry points from that module.

## Architecture

Two clearly separated runtimes, communicating through a typed message
contract in `src/types.ts`:

- **`code.ts`** is a thin bootstrap. It mounts the UI iframe, routes
  `figma.ui.onmessage` events into either the MCP dispatcher
  (`mcp-handlers/handle-command.ts`) or the skill lane
  (`runtime/skills.ts`), and registers selection probes
  (`runtime/selection-probes.ts`). The actual Plugin API work lives
  in dedicated modules under `mcp-handlers/` (one file per command
  group) and `engine-inline.ts` (Organize Screens). Editor gates run
  inside the dispatcher (`assertCommandEditor` for the MCP lane) and
  the skill lane (`ensureFigmaEditor` for Organize Screens).
- **`ui.ts`** owns presentation, the WebSocket connection to the
  Cursor MCP relay, anonymous GA4 analytics, and the skill router.
  It is the single place that talks to the host iframe parent
  (`parent.postMessage`) and that listens for plugin -> UI messages
  (through the kit-canonical `fromPlugin(event)` origin guard).

Two conversation lanes share the message channel:

| Lane             | Trigger                              | Plugin side                    | UI side                         |
| ---------------- | ------------------------------------ | ------------------------------ | ------------------------------- |
| MCP relay        | `socket.ts` -> WebSocket message     | `handleCommand(name, params)`  | `execute-command` / `command-result` / `command-error` |
| Skill UI         | User clicks "Run" inside a panel     | direct engine call (e.g. `organizeScreensFromSelection`) | `run-skill` / `skill-result` / `skill-error` |

The MCP relay lane is untouched by the kit conformance pass. Adding a
new skill UI panel never has to go through `handleCommand`.

## Run + nav model

Opening the plugin lands on a grouped-list **Landing** screen:

```text
SKILLS
  - Organize Screens     Arrange selected frames into a Section
SYSTEM
  - Talk To Figma MCP    Connection, channel, and MCP config
                         (status badge: Connected / Connecting / Not connected)
```

Selecting any entry navigates to its panel. A "Back" button in the
shell header returns to Landing. The WebSocket and analytics state
live in `ui.ts` module scope, so:

- Auto-connect on plugin open still kicks off regardless of which
  panel the user opens first.
- Navigating Landing -> Organize Screens -> Back never tears down the
  socket.
- `progress_update` messages keep flowing into the shell, ready to be
  rendered by the Settings panel when it is mounted.

### Adding a new skill

1. Add a file under `src/skills/<id>.ts` that exports a
   `SkillDef` matching `src/skills/registry.ts`.
2. Push it into the `SKILLS` array in `src/ui.ts`.
3. Use `ctx.send(...)` to dispatch a typed `run-skill` message and
   subscribe via `ctx.onPluginMessage(...)` for `skill-result` /
   `skill-error`.

No shell or `ui.html` edits are required.

## Build

```bash
bun install
bun run build:plugin       # injects engine + bundles code.ts/ui.ts + verifies
bun run watch:plugin       # esbuild watch mode for both bundles
bun run typecheck:plugin   # tsc --noEmit, scoped to this plugin's tsconfig
```

The default `build:plugin` script is composed of:

1. `bun run build:plugin:engine` — splices `engine.js` into
   `src/engine-inline.ts` between the engine markers
   (`scripts/build-plugin.js`). Fails if markers reappear in `code.ts`.
2. `bun run scripts/build-ui.mjs` — bundles `ui.ts` into a
   self-contained `dist/ui.html`, bundles `code.ts` into `dist/code.js`,
   then **inlines** that HTML into `figma.showUI(...)` inside
   `dist/code.js` (required because esbuild's IIFE hides Figma's
   `__html__` global).
3. `postbuild:plugin` — runs the kit-canonical
   `verify-es2019.js dist/code.js` and `verify-manifest.js manifest.json`
   to catch ES2019-incompatible syntax in the bundled runtime and
   manifest mistakes (e.g. `localhost` in `allowedDomains`) before
   the plugin is loaded into Figma.

## MCP command editor matrix

The MCP dispatcher (`src/mcp-handlers/handle-command.ts`) calls
`assertCommandEditor(command)` from `src/mcp-handlers/command-registry.ts`
before any handler runs. Commands the current editor cannot service fail
fast with a typed `command-error` envelope instead of an obscure Plugin
API throw deep inside a handler.

| Bucket | Commands | Notes |
|--------|----------|-------|
| **any** (Figma + FigJam) | `get_document_info`, `get_selection`, `get_node_info`, `get_nodes_info`, `read_my_design`, `scan_text_nodes`, `scan_nodes_by_types`, `set_focus`, `set_selections`, `set_node_name`, `move_node`, `resize_node`, `delete_node`, `delete_multiple_nodes`, `clone_node`, `reparent_node`, `export_node_as_image` | Reads, generic node lifecycle, selection, export |
| **figma** (design only) | `create_rectangle`, `create_frame`, `create_text`, `set_fill_color`, `set_stroke_color`, `set_corner_radius`, `set_text_content`, `set_multiple_text_contents`, `get_styles`, `get_local_components`, `create_component_instance`, `create_component`, `combine_as_variants`, `get_instance_overrides`, `set_instance_overrides`, `set_layout_mode`, `set_padding`, `set_axis_align`, `set_layout_sizing`, `set_item_spacing`, `get_reactions`, `get_annotations`, `set_annotation`, `set_multiple_annotations`, `get_local_variables`, `set_fill_variable`, `set_stroke_variable`, `set_number_variable`, `set_corner_radius_variable`, `organize_screens` | Frame primitives, styles, components, Variants, Auto-layout, Variables, annotations, prototyping reactions |
| **figjam** (FigJam only) | `set_default_connector`, `create_connections` | Connector primitives |

Adding a command? Add a row in `COMMAND_REGISTRY` *and* the matching
handler in `MCPHandlers` / the dispatcher switch.

## Manifest details

- `editorType` is `["figma", "figjam"]` because the WebSocket relay
  forwards commands that work in both editors (rectangles, frames,
  text, FigJam connectors). Skills and individual MCP commands that
  need a specific editor short-circuit at runtime — see
  `ensureFigmaEditor()` in `src/code.ts` (skill lane) and
  `assertCommandEditor()` in `src/mcp-handlers/command-registry.ts`
  (MCP lane). Per
  [`.cursor/rules/figma-plugin-editor-gates.mdc`](../../../create-plugin-starter-kit/.cursor/rules/figma-plugin-editor-gates.mdc).
- `networkAccess.allowedDomains` lists only the Google Analytics
  endpoint. The local Cursor MCP relay
  (`http://localhost:3055`, `ws://localhost:3055`) lives in
  `devAllowedDomains` because this plugin is never submitted to
  the Figma Community. The kit's `verify-manifest.js` hard-fails
  on `localhost` in `allowedDomains`.
- `documentAccess: "dynamic-page"` opts into async page APIs.

## Theming

`figma.showUI(__html__, { themeColors: true })` injects
`--figma-color-*` CSS variables into the plugin iframe. `styles.css`
consumes them directly — no hard-coded hex values, no intermediate
alias layer. Light and dark Figma themes are automatic.
