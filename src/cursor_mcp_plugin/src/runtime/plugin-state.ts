/**
 * Long-lived plugin-runtime state. Today the only durable setting is
 * the WebSocket port the UI uses to reach the local Cursor MCP relay;
 * persistence goes through the serialised `clientStorage` queue
 * (`lib/clientStorage.ts`) to avoid lost-update races.
 *
 * Keep this module small. State that belongs to a single message
 * lifecycle (pending requests, the active command id, etc.) lives in
 * the UI shell or the MCP dispatcher, not here.
 */

import { setClientStorage } from "../lib/clientStorage";

export interface PluginRuntimeState {
  serverPort: number;
}

export const state: PluginRuntimeState = {
  serverPort: 3055,
};

export function updateSettings(settings: { serverPort?: number }): void {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }
  void setClientStorage("settings", { serverPort: state.serverPort });
}
