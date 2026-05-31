/**
 * Page-level reads for the MCP relay.
 *
 * `readMyDesign` is intentionally separate from `getNodesInfo`: it
 * always reads the current selection, never a caller-provided id list,
 * which the Cursor agent leans on for "tell me about this".
 */

import { filterFigmaNode } from "./nodes";

export async function getDocumentInfo() {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  return {
    name: page.name,
    id: page.id,
    type: page.type,
    children: page.children.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
    })),
    currentPage: {
      id: page.id,
      name: page.name,
      childCount: page.children.length,
    },
    pages: [
      {
        id: page.id,
        name: page.name,
        childCount: page.children.length,
      },
    ],
  };
}

export async function getSelection() {
  return {
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
    })),
  };
}

export async function readMyDesign() {
  try {
    const nodes = await Promise.all(
      figma.currentPage.selection.map((node) =>
        figma.getNodeByIdAsync(node.id)
      )
    );
    const validNodes = nodes.filter(
      (node): node is BaseNode & ExportMixin =>
        node !== null && "exportAsync" in node
    );
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        } as any);
        return {
          nodeId: node.id,
          document: filterFigmaNode((response as any).document),
        };
      })
    );
    return responses;
  } catch (error: any) {
    throw new Error("Error getting nodes info: " + (error && error.message));
  }
}
