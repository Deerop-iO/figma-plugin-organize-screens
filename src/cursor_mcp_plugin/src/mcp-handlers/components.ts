// @ts-nocheck
/**
 * Styles, local components, component instances, component creation
 * and Variant combination. Design-only Plugin API surface.
 */

import {
  sendProgressUpdate,
  generateCommandId,
} from "../runtime/progress";

export async function getStyles() {
  const styles = {
    colors: await figma.getLocalPaintStylesAsync(),
    texts: await figma.getLocalTextStylesAsync(),
    effects: await figma.getLocalEffectStylesAsync(),
    grids: await figma.getLocalGridStylesAsync(),
  };

  return {
    colors: styles.colors.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      paint: style.paints[0],
    })),
    texts: styles.texts.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      fontSize: style.fontSize,
      fontName: style.fontName,
    })),
    effects: styles.effects.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
    grids: styles.grids.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
  };
}

export async function getLocalComponents(params) {
  const commandId = (params && params.commandId) || generateCommandId();
  const pages = figma.root.children;
  const totalPages = pages.length;

  await sendProgressUpdate(
    commandId,
    "get_local_components",
    "started",
    0,
    totalPages,
    0,
    "Starting component scan across " + totalPages + " pages...",
    null
  );

  var allComponents = [];

  for (var i = 0; i < totalPages; i++) {
    var page = pages[i];
    await page.loadAsync();

    var pageComponents = page.findAllWithCriteria({ types: ["COMPONENT"] });

    for (var j = 0; j < pageComponents.length; j++) {
      var component = pageComponents[j];
      allComponents.push({
        id: component.id,
        name: component.name,
        key: "key" in component ? component.key : null,
      });
    }

    var progress = Math.round(((i + 1) / totalPages) * 100);
    await sendProgressUpdate(
      commandId,
      "get_local_components",
      "in_progress",
      progress,
      totalPages,
      i + 1,
      "Scanned " + page.name + ": " + pageComponents.length + " components (total so far: " + allComponents.length + ")",
      null
    );
  }

  await sendProgressUpdate(
    commandId,
    "get_local_components",
    "completed",
    100,
    totalPages,
    totalPages,
    "Found " + allComponents.length + " components across " + totalPages + " pages",
    null
  );

  return {
    count: allComponents.length,
    components: allComponents,
  };
}

// async function getTeamComponents() {
//   try {
//     const teamComponents =
//       await figma.teamLibrary.getAvailableComponentsAsync();

//     return {
//       count: teamComponents.length,
//       components: teamComponents.map((component) => ({
//         key: component.key,
//         name: component.name,
//         description: component.description,
//         libraryName: component.libraryName,
//       })),
//     };
//   } catch (error) {
//     throw new Error(`Error getting team components: ${error.message}`);
//   }
// }

export async function createComponentInstance(params) {
  const { componentKey, componentId, x = 0, y = 0, parentId } = params || {};

  if (!componentKey && !componentId) {
    throw new Error("Missing componentKey or componentId parameter. Use componentId for local components (from get_local_components), or componentKey for published library components.");
  }

  try {
    let component;

    if (componentId) {
      // Local component: get node directly by ID
      const node = await figma.getNodeByIdAsync(componentId);
      if (!node) {
        throw new Error(`Component node not found with id: ${componentId}`);
      }
      if (node.type !== "COMPONENT") {
        throw new Error(`Node ${componentId} is not a COMPONENT (got type: ${node.type}). Use get_local_components to find valid component IDs.`);
      }
      component = node;
    } else {
      // Published library component: import by key
      component = await figma.importComponentByKeyAsync(componentKey);
    }

    const instance = component.createInstance();
    instance.x = x;
    instance.y = y;

    if (parentId) {
      const parent = await figma.getNodeByIdAsync(parentId);
      if (parent && "appendChild" in parent) {
        parent.appendChild(instance);
      } else {
        figma.currentPage.appendChild(instance);
      }
    } else {
      figma.currentPage.appendChild(instance);
    }

    const mainComponent = await instance.getMainComponentAsync();

    return {
      id: instance.id,
      name: instance.name,
      x: instance.x,
      y: instance.y,
      width: instance.width,
      height: instance.height,
      mainComponentId: mainComponent ? mainComponent.id : undefined,
    };
  } catch (error) {
    throw new Error(`Error creating component instance: ${error.message}`);
  }
}

// Convert an existing node into a COMPONENT (in place)
export async function createComponent(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type === "COMPONENT") {
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      message: "Node was already a COMPONENT; no change applied",
    };
  }

  if (typeof figma.createComponentFromNode !== "function") {
    throw new Error("This Figma version does not support figma.createComponentFromNode");
  }

  const component = figma.createComponentFromNode(node);

  return {
    id: component.id,
    name: component.name,
    type: component.type,
    width: "width" in component ? component.width : undefined,
    height: "height" in component ? component.height : undefined,
  };
}

// Combine multiple COMPONENT nodes into a single Component Set with variants
export async function combineAsVariants(params) {
  const { nodeIds, parentId } = params || {};

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 2) {
    throw new Error("combine_as_variants requires nodeIds array with at least 2 IDs");
  }

  const nodes = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) {
      throw new Error(`Node not found with ID: ${id}`);
    }
    if (node.type !== "COMPONENT") {
      throw new Error(`Node ${id} is type ${node.type}; combine_as_variants requires COMPONENT nodes`);
    }
    nodes.push(node);
  }

  let parent;
  if (parentId) {
    parent = await figma.getNodeByIdAsync(parentId);
    if (!parent) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
  } else {
    parent = nodes[0].parent || figma.currentPage;
  }

  if (typeof figma.combineAsVariants !== "function") {
    throw new Error("This Figma version does not support figma.combineAsVariants");
  }

  const componentSet = figma.combineAsVariants(nodes, parent);

  return {
    id: componentSet.id,
    name: componentSet.name,
    type: componentSet.type,
    childCount: componentSet.children ? componentSet.children.length : nodes.length,
  };
}
