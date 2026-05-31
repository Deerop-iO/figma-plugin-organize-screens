// @ts-nocheck
/**
 * Variables API read and binding handlers. The MCP server's Zod
 * schemas constrain the parameter shape; see
 * `.cursor/rules/figma-plugin-variables.mdc` for the workflow.
 */

import { rgbaToHex } from "./nodes";

// List all local variables and their collections in the file
export async function getLocalVariables(params) {
  const { resolvedType } = params || {};

  if (!figma.variables || typeof figma.variables.getLocalVariablesAsync !== "function") {
    throw new Error("This Figma version does not support the variables API");
  }

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync(resolvedType);

  const collectionsOut = collections.map((c) => ({
    id: c.id,
    name: c.name,
    key: c.key,
    modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
    defaultModeId: c.defaultModeId,
    variableIds: c.variableIds,
    remote: c.remote,
  }));

  const variablesOut = variables.map((v) => {
    const valuesByMode = {};
    for (const modeId of Object.keys(v.valuesByMode || {})) {
      const value = v.valuesByMode[modeId];
      if (
        value &&
        typeof value === "object" &&
        value.type === "VARIABLE_ALIAS"
      ) {
        valuesByMode[modeId] = { aliasOf: value.id };
      } else if (
        value &&
        typeof value === "object" &&
        "r" in value &&
        "g" in value &&
        "b" in value
      ) {
        valuesByMode[modeId] = {
          r: value.r,
          g: value.g,
          b: value.b,
          a: value.a !== undefined ? value.a : 1,
          hex: rgbaToHex(value),
        };
      } else {
        valuesByMode[modeId] = value;
      }
    }
    return {
      id: v.id,
      name: v.name,
      key: v.key,
      resolvedType: v.resolvedType,
      collectionId: v.variableCollectionId,
      scopes: v.scopes,
      valuesByMode,
    };
  });

  return {
    collectionCount: collectionsOut.length,
    variableCount: variablesOut.length,
    collections: collectionsOut,
    variables: variablesOut,
  };
}

// Bind a COLOR variable to one of a node's fills.
// Works for any node with a `fills` property (frames, components, text, etc.).
export async function setFillVariable(params) {
  const { nodeId, variableId, paintIndex } = params || {};
  const idx = typeof paintIndex === "number" ? paintIndex : 0;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!variableId) {
    throw new Error("Missing variableId parameter");
  }
  if (!figma.variables || typeof figma.variables.getVariableByIdAsync !== "function") {
    throw new Error("This Figma version does not support the variables API");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (!("fills" in node)) {
    throw new Error(`Node type ${node.type} does not support fills`);
  }

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    throw new Error(`Variable not found with ID: ${variableId}`);
  }
  if (variable.resolvedType !== "COLOR") {
    throw new Error(`Variable ${variable.name} is ${variable.resolvedType}; set_fill_variable requires a COLOR variable`);
  }

  // Text nodes return symbol when fills are mixed; force-clear by reading current first
  let currentFills = node.fills;
  if (currentFills === figma.mixed) {
    throw new Error("Node has mixed fills; cannot bind a single variable. Set fills explicitly first.");
  }
  // Clone to a mutable array
  let fills = Array.isArray(currentFills) ? currentFills.slice() : [];
  if (fills.length === 0) {
    // Create a default solid paint to bind onto
    fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
  }
  if (idx < 0 || idx >= fills.length) {
    throw new Error(`paintIndex ${idx} is out of range; node has ${fills.length} fill(s)`);
  }
  if (fills[idx].type !== "SOLID") {
    throw new Error(`Fill at index ${idx} is ${fills[idx].type}; set_fill_variable currently supports SOLID paints only`);
  }

  fills[idx] = figma.variables.setBoundVariableForPaint(fills[idx], "color", variable);
  node.fills = fills;

  return {
    id: node.id,
    name: node.name,
    paintIndex: idx,
    variableId: variable.id,
    variableName: variable.name,
  };
}

// Bind a COLOR variable to one of a node's strokes.
export async function setStrokeVariable(params) {
  const { nodeId, variableId, paintIndex } = params || {};
  const idx = typeof paintIndex === "number" ? paintIndex : 0;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!variableId) {
    throw new Error("Missing variableId parameter");
  }
  if (!figma.variables || typeof figma.variables.getVariableByIdAsync !== "function") {
    throw new Error("This Figma version does not support the variables API");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (!("strokes" in node)) {
    throw new Error(`Node type ${node.type} does not support strokes`);
  }

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    throw new Error(`Variable not found with ID: ${variableId}`);
  }
  if (variable.resolvedType !== "COLOR") {
    throw new Error(`Variable ${variable.name} is ${variable.resolvedType}; set_stroke_variable requires a COLOR variable`);
  }

  let currentStrokes = node.strokes;
  if (currentStrokes === figma.mixed) {
    throw new Error("Node has mixed strokes; cannot bind a single variable. Set strokes explicitly first.");
  }
  let strokes = Array.isArray(currentStrokes) ? currentStrokes.slice() : [];
  if (strokes.length === 0) {
    strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
    if ("strokeWeight" in node && (node.strokeWeight === 0 || node.strokeWeight === undefined)) {
      node.strokeWeight = 1;
    }
  }
  if (idx < 0 || idx >= strokes.length) {
    throw new Error(`paintIndex ${idx} is out of range; node has ${strokes.length} stroke(s)`);
  }
  if (strokes[idx].type !== "SOLID") {
    throw new Error(`Stroke at index ${idx} is ${strokes[idx].type}; set_stroke_variable currently supports SOLID paints only`);
  }

  strokes[idx] = figma.variables.setBoundVariableForPaint(strokes[idx], "color", variable);
  node.strokes = strokes;

  return {
    id: node.id,
    name: node.name,
    paintIndex: idx,
    variableId: variable.id,
    variableName: variable.name,
  };
}

// Bind a FLOAT variable to a numeric field on a node (padding, itemSpacing,
// individual corner radius, strokeWeight, fontSize, opacity, width, etc.).
export async function setNumberVariable(params) {
  const { nodeId, field, variableId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!field) {
    throw new Error("Missing field parameter");
  }
  if (!variableId) {
    throw new Error("Missing variableId parameter");
  }
  if (!figma.variables || typeof figma.variables.getVariableByIdAsync !== "function") {
    throw new Error("This Figma version does not support the variables API");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (typeof node.setBoundVariable !== "function") {
    throw new Error(`Node type ${node.type} does not support setBoundVariable`);
  }

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    throw new Error(`Variable not found with ID: ${variableId}`);
  }
  if (variable.resolvedType !== "FLOAT") {
    throw new Error(`Variable ${variable.name} is ${variable.resolvedType}; set_number_variable requires a FLOAT variable`);
  }

  try {
    node.setBoundVariable(field, variable);
  } catch (err) {
    throw new Error(`Failed to bind ${variable.name} to ${field} on ${node.name}: ${err.message}`);
  }

  return {
    id: node.id,
    name: node.name,
    field: field,
    variableId: variable.id,
    variableName: variable.name,
  };
}

// Convenience: bind the same FLOAT variable to all four corner radii.
export async function setCornerRadiusVariable(params) {
  const { nodeId, variableId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (!variableId) {
    throw new Error("Missing variableId parameter");
  }
  if (!figma.variables || typeof figma.variables.getVariableByIdAsync !== "function") {
    throw new Error("This Figma version does not support the variables API");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (typeof node.setBoundVariable !== "function") {
    throw new Error(`Node type ${node.type} does not support setBoundVariable`);
  }

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) {
    throw new Error(`Variable not found with ID: ${variableId}`);
  }
  if (variable.resolvedType !== "FLOAT") {
    throw new Error(`Variable ${variable.name} is ${variable.resolvedType}; set_corner_radius_variable requires a FLOAT variable`);
  }

  const corners = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"];
  const bound = [];
  for (const field of corners) {
    try {
      node.setBoundVariable(field, variable);
      bound.push(field);
    } catch (err) {
      throw new Error(`Failed to bind ${variable.name} to ${field} on ${node.name}: ${err.message}`);
    }
  }

  return {
    id: node.id,
    name: node.name,
    fields: bound,
    variableId: variable.id,
    variableName: variable.name,
  };
}
