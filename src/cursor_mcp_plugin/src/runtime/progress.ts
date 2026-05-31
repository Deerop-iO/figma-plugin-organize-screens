/**
 * Plugin-runtime progress helper. Long-running MCP commands call
 * `sendProgressUpdate` to drive the `command_progress` envelope the UI
 * relays back to Cursor over the WebSocket. The helper yields the
 * sandbox event loop after every emission so postMessage flushes to
 * `ui.html` before the next chunk of work begins.
 */

export async function sendProgressUpdate(
  commandId: string,
  commandType: string,
  status: "started" | "in_progress" | "completed" | "error",
  progress: number,
  totalItems: number,
  processedItems: number,
  message: string,
  payload: any = null
) {
  const update: any = {
    type: "command_progress",
    commandId,
    commandType,
    status,
    progress,
    totalItems,
    processedItems,
    message,
    timestamp: Date.now(),
  };

  if (payload) {
    if (
      payload.currentChunk !== undefined &&
      payload.totalChunks !== undefined
    ) {
      update.currentChunk = payload.currentChunk;
      update.totalChunks = payload.totalChunks;
      update.chunkSize = payload.chunkSize;
    }
    update.payload = payload;
  }

  figma.ui.postMessage(update);

  // Yield so the Figma plugin sandbox flushes postMessage to ui.html
  // before the next iteration begins.
  await new Promise((resolve) => setTimeout(resolve, 0));

  return update;
}

/**
 * Generate a unique command id for progress envelopes that originate
 * inside a handler (i.e. not in response to an MCP relay request that
 * already carries an id). 36-base for compactness.
 */
export function generateCommandId(): string {
  return (
    "cmd_" +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}
