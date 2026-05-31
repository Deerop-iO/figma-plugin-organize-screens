/**
 * Node-graph reads and the helpers other handlers reuse:
 *
 *   - `rgbaToHex`     — colour normaliser used wherever a fill / stroke
 *                       leaves the plugin (export, MCP responses).
 *   - `filterFigmaNode` — recursive document trimmer that strips
 *                       internal references (`boundVariables`,
 *                       `imageRef`), normalises colours, and prunes
 *                       VECTOR nodes so MCP payloads stay small.
 *   - `getNodeInfo`   — single node, JSON_REST_V1.
 *   - `getNodesInfo`  — batched parallel read.
 *
 * Other handler modules import these helpers; do not duplicate them.
 */

export function rgbaToHex(color: { r: number; g: number; b: number; a?: number }) {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a !== undefined ? Math.round(color.a * 255) : 255;

  if (a === 255) {
    return (
      "#" +
      [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")
    );
  }
  return (
    "#" +
    [r, g, b, a].map((x) => x.toString(16).padStart(2, "0")).join("")
  );
}

export function filterFigmaNode(node: any) {
  if (node.type === "VECTOR") {
    return null;
  }

  const filtered: any = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill: any) => {
      const processedFill = Object.assign({}, fill);
      delete processedFill.boundVariables;
      delete processedFill.imageRef;

      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map(
          (stop: any) => {
            const processedStop = Object.assign({}, stop);
            if (processedStop.color) {
              processedStop.color = rgbaToHex(processedStop.color);
            }
            delete processedStop.boundVariables;
            return processedStop;
          }
        );
      }

      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke: any) => {
      const processedStroke = Object.assign({}, stroke);
      delete processedStroke.boundVariables;
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  if (node.cornerRadius !== undefined) {
    filtered.cornerRadius = node.cornerRadius;
  }

  if (node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  if (node.characters) {
    filtered.characters = node.characters;
  }

  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx,
    };
  }

  if (node.children) {
    filtered.children = node.children
      .map((child: any) => filterFigmaNode(child))
      .filter((child: any) => child !== null);
  }

  return filtered;
}

export async function getNodeInfo(nodeId: string) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error("Node not found with ID: " + nodeId);
  }
  if (!("exportAsync" in node)) {
    throw new Error("Node does not support export: " + nodeId);
  }
  const response = await (node as ExportMixin).exportAsync({
    format: "JSON_REST_V1",
  } as any);
  return filterFigmaNode((response as any).document);
}

export async function getNodesInfo(nodeIds: string[]) {
  try {
    const nodes = await Promise.all(
      nodeIds.map((id) => figma.getNodeByIdAsync(id))
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
