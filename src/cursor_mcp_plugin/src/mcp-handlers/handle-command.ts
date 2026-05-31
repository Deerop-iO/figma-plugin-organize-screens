// @ts-nocheck
/**
 * MCP command dispatcher.
 *
 * Two design choices keep the file small and migration-friendly:
 *
 *  1. **Editor gate first.** Every command is checked against
 *     `COMMAND_REGISTRY` before any Plugin API call. Design-only
 *     commands run in FigJam fail with a typed `command-error`
 *     envelope from the caller, never an obscure API throw.
 *
 *  2. **Handlers are injected.** Phase 3 of the backlog will move
 *     handler bodies out of `code.ts` into focused modules. Until
 *     then `code.ts` builds the `handlers` object from its own
 *     function declarations and passes it to `createCommandDispatcher`.
 *     When handlers move, the dispatcher's imports update; this file's
 *     switch body does not change.
 */

import { assertCommandEditor } from "./command-registry";

export interface MCPHandlers {
  // Reads.
  getDocumentInfo: () => Promise<unknown>;
  getSelection: () => Promise<unknown>;
  getNodeInfo: (nodeId: string) => Promise<unknown>;
  getNodesInfo: (nodeIds: string[]) => Promise<unknown>;
  readMyDesign: () => Promise<unknown>;
  scanTextNodes: (params: any) => Promise<unknown>;
  scanNodesByTypes: (params: any) => Promise<unknown>;
  getReactions: (nodeIds: string[]) => Promise<unknown>;
  getStyles: () => Promise<unknown>;
  getLocalComponents: (params: any) => Promise<unknown>;
  getAnnotations: (params: any) => Promise<unknown>;
  getLocalVariables: (params: any) => Promise<unknown>;
  exportNodeAsImage: (params: any) => Promise<unknown>;

  // Generic node ops.
  moveNode: (params: any) => Promise<unknown>;
  resizeNode: (params: any) => Promise<unknown>;
  deleteNode: (params: any) => Promise<unknown>;
  deleteMultipleNodes: (params: any) => Promise<unknown>;
  cloneNode: (params: any) => Promise<unknown>;
  reparentNode: (params: any) => Promise<unknown>;
  setNodeName: (params: any) => Promise<unknown>;
  setFocus: (params: any) => Promise<unknown>;
  setSelections: (params: any) => Promise<unknown>;

  // Design writes.
  createRectangle: (params: any) => Promise<unknown>;
  createFrame: (params: any) => Promise<unknown>;
  createText: (params: any) => Promise<unknown>;
  setFillColor: (params: any) => Promise<unknown>;
  setStrokeColor: (params: any) => Promise<unknown>;
  setCornerRadius: (params: any) => Promise<unknown>;
  setTextContent: (params: any) => Promise<unknown>;
  setMultipleTextContents: (params: any) => Promise<unknown>;
  setAnnotation: (params: any) => Promise<unknown>;
  setMultipleAnnotations: (params: any) => Promise<unknown>;

  // Components / instances / variants.
  createComponentInstance: (params: any) => Promise<unknown>;
  createComponent: (params: any) => Promise<unknown>;
  combineAsVariants: (params: any) => Promise<unknown>;
  getInstanceOverrides: (instanceNode?: BaseNode | null) => Promise<unknown>;
  getValidTargetInstances: (
    targetNodeIds: string[]
  ) => Promise<{ success: boolean; message?: string; targetInstances?: unknown }>;
  getSourceInstanceData: (
    sourceInstanceId: string
  ) => Promise<{ success: boolean; message?: string }>;
  setInstanceOverrides: (
    targetInstances: unknown,
    sourceResult: unknown
  ) => Promise<unknown>;

  // Auto-layout.
  setLayoutMode: (params: any) => Promise<unknown>;
  setPadding: (params: any) => Promise<unknown>;
  setAxisAlign: (params: any) => Promise<unknown>;
  setLayoutSizing: (params: any) => Promise<unknown>;
  setItemSpacing: (params: any) => Promise<unknown>;

  // Variables.
  setFillVariable: (params: any) => Promise<unknown>;
  setStrokeVariable: (params: any) => Promise<unknown>;
  setNumberVariable: (params: any) => Promise<unknown>;
  setCornerRadiusVariable: (params: any) => Promise<unknown>;

  // FigJam.
  setDefaultConnector: (params: any) => Promise<unknown>;
  createConnections: (params: any) => Promise<unknown>;

  // Skill entry points.
  organizeScreensFromSelection: (params: any) => Promise<unknown>;
}

export function createCommandDispatcher(h: MCPHandlers) {
  return async function handleCommand(
    command: string,
    params: any
  ): Promise<unknown> {
    assertCommandEditor(command);

    switch (command) {
      case "get_document_info":
        return await h.getDocumentInfo();
      case "get_selection":
        return await h.getSelection();
      case "get_node_info":
        if (!params || !params.nodeId) {
          throw new Error("Missing nodeId parameter");
        }
        return await h.getNodeInfo(params.nodeId);
      case "get_nodes_info":
        if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
          throw new Error("Missing or invalid nodeIds parameter");
        }
        return await h.getNodesInfo(params.nodeIds);
      case "read_my_design":
        return await h.readMyDesign();
      case "create_rectangle":
        return await h.createRectangle(params);
      case "create_frame":
        return await h.createFrame(params);
      case "create_text":
        return await h.createText(params);
      case "set_fill_color":
        return await h.setFillColor(params);
      case "set_stroke_color":
        return await h.setStrokeColor(params);
      case "move_node":
        return await h.moveNode(params);
      case "resize_node":
        return await h.resizeNode(params);
      case "delete_node":
        return await h.deleteNode(params);
      case "delete_multiple_nodes":
        return await h.deleteMultipleNodes(params);
      case "get_styles":
        return await h.getStyles();
      case "get_local_components":
        return await h.getLocalComponents(params);
      case "create_component_instance":
        return await h.createComponentInstance(params);
      case "export_node_as_image":
        return await h.exportNodeAsImage(params);
      case "set_corner_radius":
        return await h.setCornerRadius(params);
      case "set_text_content":
        return await h.setTextContent(params);
      case "clone_node":
        return await h.cloneNode(params);
      case "scan_text_nodes":
        return await h.scanTextNodes(params);
      case "set_multiple_text_contents":
        return await h.setMultipleTextContents(params);
      case "get_annotations":
        return await h.getAnnotations(params);
      case "set_annotation":
        return await h.setAnnotation(params);
      case "scan_nodes_by_types":
        return await h.scanNodesByTypes(params);
      case "set_multiple_annotations":
        return await h.setMultipleAnnotations(params);
      case "get_instance_overrides":
        if (params && params.instanceNodeId) {
          const instanceNode = await figma.getNodeByIdAsync(
            params.instanceNodeId
          );
          if (!instanceNode) {
            throw new Error(
              "Instance node not found with ID: " + params.instanceNodeId
            );
          }
          return await h.getInstanceOverrides(instanceNode);
        }
        return await h.getInstanceOverrides();
      case "set_instance_overrides": {
        if (!params || !params.targetNodeIds) {
          throw new Error("Missing targetNodeIds parameter");
        }
        if (!Array.isArray(params.targetNodeIds)) {
          throw new Error("targetNodeIds must be an array");
        }
        const targetNodes = await h.getValidTargetInstances(
          params.targetNodeIds
        );
        if (!targetNodes.success) {
          figma.notify(targetNodes.message);
          return { success: false, message: targetNodes.message };
        }
        if (!params.sourceInstanceId) {
          throw new Error("Missing sourceInstanceId parameter");
        }
        const sourceInstanceData = await h.getSourceInstanceData(
          params.sourceInstanceId
        );
        if (!sourceInstanceData.success) {
          figma.notify(sourceInstanceData.message);
          return { success: false, message: sourceInstanceData.message };
        }
        return await h.setInstanceOverrides(
          targetNodes.targetInstances,
          sourceInstanceData
        );
      }
      case "set_layout_mode":
        return await h.setLayoutMode(params);
      case "set_padding":
        return await h.setPadding(params);
      case "set_axis_align":
        return await h.setAxisAlign(params);
      case "set_layout_sizing":
        return await h.setLayoutSizing(params);
      case "set_item_spacing":
        return await h.setItemSpacing(params);
      case "get_reactions":
        if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
          throw new Error("Missing or invalid nodeIds parameter");
        }
        return await h.getReactions(params.nodeIds);
      case "set_default_connector":
        return await h.setDefaultConnector(params);
      case "create_connections":
        return await h.createConnections(params);
      case "set_focus":
        return await h.setFocus(params);
      case "set_selections":
        return await h.setSelections(params);
      case "create_component":
        return await h.createComponent(params);
      case "combine_as_variants":
        return await h.combineAsVariants(params);
      case "reparent_node":
        return await h.reparentNode(params);
      case "set_node_name":
        return await h.setNodeName(params);
      case "get_local_variables":
        return await h.getLocalVariables(params);
      case "set_fill_variable":
        return await h.setFillVariable(params);
      case "set_stroke_variable":
        return await h.setStrokeVariable(params);
      case "set_number_variable":
        return await h.setNumberVariable(params);
      case "set_corner_radius_variable":
        return await h.setCornerRadiusVariable(params);
      case "organize_screens":
        return await h.organizeScreensFromSelection(params || {});
      default:
        throw new Error("Unknown command: " + command);
    }
  };
}
