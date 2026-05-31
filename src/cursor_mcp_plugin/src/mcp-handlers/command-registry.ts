/**
 * Central registry of every MCP command the plugin runtime can dispatch,
 * paired with the Figma editor it requires.
 *
 * The plugin manifest declares `editorType: ["figma", "figjam"]`, which
 * means the WebSocket relay can hand us commands while the user is in
 * either editor. The Plugin API surface in FigJam is a strict subset of
 * the design editor's: there are no FrameNode auto-layout writes, no
 * Variables API, no Component / Variant primitives, no PaintStyle reads.
 *
 * Without a gate at the dispatcher, a design-only command run in FigJam
 * surfaces as an obscure API throw far inside a handler. With the gate,
 * we fail fast and return a clear `command-error` envelope to the
 * caller before any Plugin API is touched.
 *
 * Editor requirements:
 *   - "any"    : works in both Figma design and FigJam
 *   - "figma"  : Figma design editor only
 *   - "figjam" : FigJam only (connector / cursor / board primitives)
 *
 * See `.cursor/rules/figma-plugin-editor-gates.mdc`.
 */

export type EditorRequirement = "any" | "figma" | "figjam";

export interface CommandMeta {
  editor: EditorRequirement;
}

export const COMMAND_REGISTRY: Record<string, CommandMeta> = {
  // Document / selection / node reads -- safe in both editors.
  get_document_info: { editor: "any" },
  get_selection: { editor: "any" },
  get_node_info: { editor: "any" },
  get_nodes_info: { editor: "any" },
  read_my_design: { editor: "any" },
  scan_text_nodes: { editor: "any" },
  scan_nodes_by_types: { editor: "any" },
  set_focus: { editor: "any" },
  set_selections: { editor: "any" },
  set_node_name: { editor: "any" },

  // Generic node ops (geometry / lifecycle / cloning) -- work in both.
  move_node: { editor: "any" },
  resize_node: { editor: "any" },
  delete_node: { editor: "any" },
  delete_multiple_nodes: { editor: "any" },
  clone_node: { editor: "any" },
  reparent_node: { editor: "any" },
  export_node_as_image: { editor: "any" },

  // Design-only primitives: frames, rectangles, paint/stroke, text styling.
  create_rectangle: { editor: "figma" },
  create_frame: { editor: "figma" },
  create_text: { editor: "figma" },
  set_fill_color: { editor: "figma" },
  set_stroke_color: { editor: "figma" },
  set_corner_radius: { editor: "figma" },
  set_text_content: { editor: "figma" },
  set_multiple_text_contents: { editor: "figma" },

  // Design-only: Styles, Components, Instances, Variants.
  get_styles: { editor: "figma" },
  get_local_components: { editor: "figma" },
  create_component_instance: { editor: "figma" },
  create_component: { editor: "figma" },
  combine_as_variants: { editor: "figma" },
  get_instance_overrides: { editor: "figma" },
  set_instance_overrides: { editor: "figma" },

  // Design-only: Auto-layout writes.
  set_layout_mode: { editor: "figma" },
  set_padding: { editor: "figma" },
  set_axis_align: { editor: "figma" },
  set_layout_sizing: { editor: "figma" },
  set_item_spacing: { editor: "figma" },

  // Design-only: prototyping / annotations / variables.
  get_reactions: { editor: "figma" },
  get_annotations: { editor: "figma" },
  set_annotation: { editor: "figma" },
  set_multiple_annotations: { editor: "figma" },
  get_local_variables: { editor: "figma" },
  set_fill_variable: { editor: "figma" },
  set_stroke_variable: { editor: "figma" },
  set_number_variable: { editor: "figma" },
  set_corner_radius_variable: { editor: "figma" },

  // FigJam-only primitives.
  set_default_connector: { editor: "figjam" },
  create_connections: { editor: "figjam" },

  // Skill entry points -- design-only.
  organize_screens: { editor: "figma" },
};

/**
 * Throws an Error with a clear message when the running editor cannot
 * service the requested command. Commands not in the registry pass
 * through to the dispatcher's "Unknown command" fallback.
 */
export function assertCommandEditor(command: string): void {
  const meta = COMMAND_REGISTRY[command];
  if (!meta) return;

  const current = (figma as any).editorType as string | undefined;
  if (meta.editor === "any") return;
  if (meta.editor === current) return;

  const wanted = meta.editor === "figma" ? "Figma design" : "FigJam";
  const got = current || "unknown";
  throw new Error(
    "Command `" +
      command +
      "` runs in the " +
      wanted +
      " editor only (current: " +
      got +
      ")."
  );
}
