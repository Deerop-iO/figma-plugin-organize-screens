/**
 * Image export handler. Always returns base64 (never a data URL) so
 * callers can choose the framing. Format is locked to PNG today; the
 * switch is kept ready for future opt-in formats.
 */

import { customBase64Encode } from "../lib/base64";

export async function exportNodeAsImage(params: {
  nodeId: string;
  scale?: number;
}) {
  const { nodeId, scale = 1 } = params || ({} as any);
  // Format is locked to PNG today; widen this string to the
  // `format: "PNG" | "JPG" | "SVG" | "PDF"` union when we expose it as
  // a Zod-validated parameter.
  const format: string = "PNG";

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error("Node not found with ID: " + nodeId);
  }
  if (!("exportAsync" in node)) {
    throw new Error("Node does not support exporting: " + nodeId);
  }

  try {
    const settings: any = {
      format,
      constraint: { type: "SCALE", value: scale },
    };
    const bytes = await (node as ExportMixin).exportAsync(settings);

    let mimeType: string;
    switch (format) {
      case "PNG":
        mimeType = "image/png";
        break;
      case "JPG":
        mimeType = "image/jpeg";
        break;
      case "SVG":
        mimeType = "image/svg+xml";
        break;
      case "PDF":
        mimeType = "application/pdf";
        break;
      default:
        mimeType = "application/octet-stream";
    }

    const base64 = customBase64Encode(bytes as Uint8Array);
    return {
      nodeId,
      format,
      scale,
      mimeType,
      imageData: base64,
    };
  } catch (error: any) {
    throw new Error(
      "Error exporting node as image: " + (error && error.message)
    );
  }
}
