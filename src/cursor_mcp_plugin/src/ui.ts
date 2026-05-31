/**
 * Shell for the Talk To Figma MCP plugin UI.
 *
 * Owns long-lived state that survives navigation across skill panels:
 *
 *  - WebSocket connection to the local Cursor MCP relay.
 *  - Anonymous analytics queue (GA4 Measurement Protocol).
 *  - The message pump that forwards relay commands to `code.ts` and
 *    pipes results / progress back over the socket.
 *
 * Each skill panel mounts into the shell's `<main>` element with a
 * `SkillContext` that exposes a typed `send`, plugin -> UI message
 * subscription, the live connection snapshot, and connect / disconnect
 * triggers. Panels are *views* on the shell state, not owners.
 */

import { fromPlugin } from "./lib/pluginMessage";
import type {
  PluginToUiMessage,
  ProgressData,
  UiToPluginMessage,
} from "./types";
import {
  type ConnectionState,
  type SkillContext,
  type SkillDef,
  type SkillInstance,
} from "./skills/registry";
import { settingsSkill } from "./skills/settings";
import { organizeScreensSkill } from "./skills/organize-screens";

// ---------- Skill registry ----------

const SKILLS: ReadonlyArray<SkillDef> = [organizeScreensSkill, settingsSkill];

const SKILL_GROUPS: ReadonlyArray<{
  id: "skills" | "system";
  label: string;
}> = [
  { id: "skills", label: "Skills" },
  { id: "system", label: "System" },
];

// ---------- Shell state ----------

interface ShellState {
  route: "landing" | { skillId: string };
  connection: ConnectionState;
  lastProgress: ProgressData | null;
  /**
   * Latest selection-context map keyed by skill id. The runtime
   * publishes one envelope per (debounced) selection change containing
   * every registered probe's result. Skills read their own slot only.
   */
  selectionContexts: Record<string, unknown>;
}

const state: ShellState = {
  route: "landing",
  connection: {
    connected: false,
    connecting: false,
    channel: null,
    serverPort: 3055,
    statusMessage: "",
  },
  lastProgress: null,
  selectionContexts: {},
};

const pluginMessageHandlers = new Set<(msg: PluginToUiMessage) => void>();
const connectionHandlers = new Set<(state: ConnectionState) => void>();
// Skill-scoped subscribers. Each skill subscribes by its id; an unrelated
// probe firing does not re-render every panel.
const selectionContextHandlers = new Map<
  string,
  Set<(context: unknown) => void>
>();

function publishConnection() {
  for (const handler of connectionHandlers) handler(state.connection);
}

function publishPluginMessage(msg: PluginToUiMessage) {
  for (const handler of pluginMessageHandlers) handler(msg);
}

// ---------- WebSocket relay ----------

interface PendingRequest {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

const ws = {
  socket: null as WebSocket | null,
  channel: null as string | null,
  pendingRequests: new Map<string, PendingRequest>(),
  commandTracking: new Map<
    string,
    { command: string; startedAt: number }
  >(),
  activeRequestId: null as string | null,
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function generateChannelName(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function connect(port: number) {
  if (state.connection.connected || state.connection.connecting) return;

  state.connection = {
    ...state.connection,
    connecting: true,
    serverPort: port,
    statusMessage: "Connecting...",
  };
  publishConnection();

  const socket = new WebSocket("ws://localhost:" + port);
  ws.socket = socket;

  socket.onopen = () => {
    const channel = generateChannelName();
    ws.channel = channel;
    socket.send(JSON.stringify({ type: "join", channel }));
  };

  socket.onmessage = (event) => {
    let data: any;
    try {
      data = JSON.parse(event.data);
    } catch (err) {
      console.error("ws parse error:", err);
      return;
    }

    if (data && data.type === "system" && data.message && data.message.result) {
      state.connection = {
        connected: true,
        connecting: false,
        channel: data.channel || ws.channel,
        serverPort: state.connection.serverPort,
        statusMessage: "",
      };
      publishConnection();

      analytics.track("channel_join", {
        port: state.connection.serverPort,
        channel: state.connection.channel,
      });

      send({
        type: "notify",
        message:
          "Connected to Cursor MCP server on port " +
          state.connection.serverPort +
          " in channel: " +
          state.connection.channel,
      });
      return;
    }

    if (data && data.type === "error") {
      console.error("ws error:", data.message);
      state.connection = {
        connected: false,
        connecting: false,
        channel: null,
        serverPort: state.connection.serverPort,
        statusMessage: "Error: " + String(data.message || "Unknown error"),
      };
      publishConnection();
      try {
        socket.close();
      } catch {
        // ignore
      }
      return;
    }

    handleRelayMessage(data);
  };

  socket.onclose = () => {
    if (ws.socket === socket) ws.socket = null;
    state.connection = {
      connected: false,
      connecting: false,
      channel: null,
      serverPort: state.connection.serverPort,
      statusMessage: "Disconnected from server",
    };
    publishConnection();
  };

  socket.onerror = (event) => {
    console.error("ws connection error:", event);
    state.connection = {
      connected: false,
      connecting: false,
      channel: null,
      serverPort: state.connection.serverPort,
      statusMessage: "Connection error",
    };
    publishConnection();
  };
}

function disconnect() {
  if (ws.socket) {
    try {
      ws.socket.close();
    } catch {
      // ignore
    }
    ws.socket = null;
  }
  state.connection = {
    connected: false,
    connecting: false,
    channel: null,
    serverPort: state.connection.serverPort,
    statusMessage: "Disconnected from server",
  };
  publishConnection();
}

function handleRelayMessage(payload: any) {
  if (!payload) return;
  const data = payload.message || payload;
  if (!data) return;

  if (data.id && ws.pendingRequests.has(data.id)) {
    const pending = ws.pendingRequests.get(data.id);
    ws.pendingRequests.delete(data.id);
    if (!pending) return;
    if (data.error) pending.reject(new Error(data.error));
    else pending.resolve(data.result);
    return;
  }

  if (data.command) {
    ws.activeRequestId = data.id;
    ws.commandTracking.set(data.id, {
      command: String(data.command),
      startedAt: Date.now(),
    });
    send({
      type: "execute-command",
      id: data.id,
      command: data.command,
      params: data.params,
    });
  }
}

function sendSocketResponse(id: string, payload: Record<string, unknown>) {
  if (!ws.socket || ws.socket.readyState !== WebSocket.OPEN) return;
  ws.socket.send(
    JSON.stringify({
      id,
      type: "message",
      channel: ws.channel,
      message: { id, ...payload },
    })
  );
}

function sendSocketProgress(progress: ProgressData) {
  if (!ws.socket || ws.socket.readyState !== WebSocket.OPEN) return;
  const requestId =
    ws.activeRequestId || progress.commandId || generateId();
  ws.socket.send(
    JSON.stringify({
      id: requestId,
      type: "progress_update",
      channel: ws.channel,
      message: {
        id: requestId,
        type: "progress_update",
        data: progress,
      },
    })
  );
}

function trackCommandResult(id: string, success: boolean, errorMessage?: string) {
  const meta = ws.commandTracking.get(id);
  if (!meta) return;
  ws.commandTracking.delete(id);
  const params: Record<string, unknown> = {
    command_name: meta.command,
    success: success ? 1 : 0,
    duration_ms: Date.now() - meta.startedAt,
  };
  if (!success && errorMessage) {
    params.error_message = String(errorMessage).slice(0, 100);
  }
  analytics.track("command_executed", params);
}

// ---------- Analytics (GA4 Measurement Protocol) ----------

const analytics = (() => {
  const MEASUREMENT_ID = "G-9YH0ER9BXC";
  const API_SECRET = "Xqiy0AtbQt-Xbx4bdoc8Kw";
  const DEBUG =
    typeof (window as any).__ANALYTICS_DEBUG__ === "boolean" &&
    (window as any).__ANALYTICS_DEBUG__ === true;
  const HOST = "https://www.google-analytics.com";
  const PATH = DEBUG ? "/debug/mp/collect" : "/mp/collect";
  const ENDPOINT =
    HOST +
    PATH +
    "?measurement_id=" +
    MEASUREMENT_ID +
    "&api_secret=" +
    API_SECRET;
  const sessionId = Date.now().toString();
  const sessionStart = Date.now();
  let clientId: string | null = null;
  const queue: Array<[string, Record<string, unknown> | undefined]> = [];

  function emit(name: string, params: Record<string, unknown> | undefined) {
    const eventParams: Record<string, unknown> = Object.assign(
      {
        session_id: sessionId,
        engagement_time_msec: Math.max(100, Date.now() - sessionStart),
      },
      params || {}
    );
    if (DEBUG) eventParams.debug_mode = 1;
    const body = {
      client_id: clientId,
      events: [{ name, params: eventParams }],
    };
    try {
      const req = fetch(ENDPOINT, {
        method: "POST",
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (DEBUG) {
        req
          .then((r) => r.json())
          .then((j) => console.log("[analytics debug]", name, j))
          .catch((e) => console.warn("[analytics debug] error", e));
      } else {
        req.catch(() => {});
      }
    } catch {
      // analytics must never break the plugin
    }
  }

  return {
    track(event: string, params?: Record<string, unknown>) {
      if (!clientId) {
        queue.push([event, params]);
        return;
      }
      emit(event, params);
    },
    setClientId(id: string) {
      clientId = id;
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) emit(next[0], next[1]);
      }
    },
  };
})();

// ---------- Plugin <-> UI message bus ----------

function send(message: UiToPluginMessage) {
  parent.postMessage({ pluginMessage: message }, "*");
}

window.addEventListener("message", (event: MessageEvent) => {
  const message = fromPlugin<PluginToUiMessage>(event);
  if (!message) return;

  // Internal handling for shell-owned concerns.
  switch (message.type) {
    case "auto-connect":
      if (!state.connection.connected && !state.connection.connecting) {
        connect(state.connection.serverPort);
      }
      break;
    case "auto-disconnect":
      disconnect();
      break;
    case "command-result":
      sendSocketResponse(message.id, { result: message.result });
      trackCommandResult(message.id, true);
      break;
    case "command-error":
      sendSocketResponse(message.id, { error: message.error, result: {} });
      trackCommandResult(message.id, false, message.error);
      break;
    case "command_progress": {
      const { type: _t, ...rest } = message;
      state.lastProgress = rest as ProgressData;
      sendSocketProgress(state.lastProgress);
      break;
    }
    case "analytics-client-id":
      analytics.setClientId(message.clientId);
      break;
    case "connection-status":
      // Plugin runtime may push a synthetic status (e.g. on settings load).
      state.connection = {
        ...state.connection,
        connected: message.connected,
        statusMessage: message.message || state.connection.statusMessage,
      };
      publishConnection();
      break;
    case "selection-contexts":
      handleSelectionContexts(message.contexts);
      break;
  }

  publishPluginMessage(message);
});

function handleSelectionContexts(contexts: Record<string, unknown>) {
  state.selectionContexts = contexts;
  for (const [skillId, handlers] of selectionContextHandlers) {
    const context = contexts[skillId];
    if (context === undefined) continue;
    for (const handler of handlers) {
      try {
        handler(context);
      } catch (err) {
        console.error("selection-context handler error:", err);
      }
    }
  }
}

// ---------- Router ----------

const root = document.getElementById("root");
if (!root) {
  throw new Error("Plugin UI root element not found");
}

let activeSkill: SkillInstance | null = null;

function clearHost(host: HTMLElement) {
  host.innerHTML = "";
}

function render() {
  if (activeSkill && activeSkill.dispose) {
    try {
      activeSkill.dispose();
    } catch (err) {
      console.error("skill dispose error:", err);
    }
  }
  activeSkill = null;

  clearHost(root as HTMLElement);

  const header = document.createElement("header");
  header.className = "shell-header";

  const headerText = document.createElement("div");

  if (state.route === "landing") {
    const title = document.createElement("h1");
    title.className = "shell-title";
    title.textContent = "Talk To Figma MCP Plugin";
    headerText.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "shell-subtitle";
    subtitle.textContent = "Connect Figma to Cursor AI using MCP";
    headerText.appendChild(subtitle);

    header.appendChild(headerText);
    (root as HTMLElement).appendChild(header);

    const main = document.createElement("main");
    main.className = "shell-main";
    renderLanding(main);
    (root as HTMLElement).appendChild(main);
    return;
  }

  // Skill route
  const skillId = state.route.skillId;
  const skill = SKILLS.find((s) => s.id === skillId);

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "shell-back";
  backBtn.textContent = "< Back";
  backBtn.addEventListener("click", () => navigate("landing"));
  header.appendChild(backBtn);

  const title = document.createElement("h1");
  title.className = "shell-title";
  title.textContent = skill ? skill.title : "Unknown skill";
  header.appendChild(title);

  (root as HTMLElement).appendChild(header);

  const main = document.createElement("main");
  main.className = "shell-main";

  if (!skill) {
    const fallback = document.createElement("div");
    fallback.className = "result-error";
    fallback.textContent = "Skill not found: " + skillId;
    main.appendChild(fallback);
  } else {
    activeSkill = skill.render(main, createContext(skillId));
  }

  (root as HTMLElement).appendChild(main);
}

function renderLanding(host: HTMLElement) {
  const list = document.createElement("div");
  list.className = "skill-list";

  for (const group of SKILL_GROUPS) {
    const entries = SKILLS.filter((s) => (s.group || "skills") === group.id);
    if (entries.length === 0) continue;

    const groupEl = document.createElement("section");
    groupEl.className = "skill-group";

    const label = document.createElement("div");
    label.className = "skill-group-label";
    label.textContent = group.label;
    groupEl.appendChild(label);

    const items = document.createElement("div");
    items.className = "skill-list-items";

    for (const skill of entries) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "skill-row";
      row.addEventListener("click", () => navigate({ skillId: skill.id }));

      const title = document.createElement("div");
      title.className = "skill-row-title";
      title.textContent = skill.title;
      row.appendChild(title);

      const desc = document.createElement("div");
      desc.className = "skill-row-desc";
      desc.textContent = skill.description;
      row.appendChild(desc);

      if (skill.id === "settings") {
        const status = document.createElement("div");
        status.className =
          "skill-row-status" +
          (state.connection.connected ? " skill-row-status--connected" : "");
        status.textContent = state.connection.connected
          ? "Connected" +
            (state.connection.channel
              ? " · " + state.connection.channel
              : "")
          : state.connection.connecting
          ? "Connecting..."
          : "Not connected";
        row.appendChild(status);
      }

      items.appendChild(row);
    }

    groupEl.appendChild(items);
    list.appendChild(groupEl);
  }

  host.appendChild(list);
}

function navigate(route: ShellState["route"]) {
  state.route = route;
  render();
}

function createContext(_skillId: string): SkillContext {
  return {
    send,
    onPluginMessage(handler) {
      pluginMessageHandlers.add(handler);
      return () => {
        pluginMessageHandlers.delete(handler);
      };
    },
    getConnection() {
      return state.connection;
    },
    onConnectionChange(handler) {
      connectionHandlers.add(handler);
      return () => {
        connectionHandlers.delete(handler);
      };
    },
    connect,
    disconnect,
    getSelectionContext(skillId: string) {
      const value = state.selectionContexts[skillId];
      return value === undefined ? null : value;
    },
    onSelectionContextChange(skillId: string, handler) {
      let bucket = selectionContextHandlers.get(skillId);
      if (!bucket) {
        bucket = new Set();
        selectionContextHandlers.set(skillId, bucket);
      }
      bucket.add(handler);
      return () => {
        const set = selectionContextHandlers.get(skillId);
        if (!set) return;
        set.delete(handler);
        if (set.size === 0) selectionContextHandlers.delete(skillId);
      };
    },
    trackEvent(name, params) {
      analytics.track(name, params);
    },
    back() {
      navigate("landing");
    },
  };
}

// Re-render landing whenever connection state changes (status label).
connectionHandlers.add(() => {
  if (state.route === "landing") render();
});

// Initial paint + ready ping.
render();
analytics.track("plugin_open");
send({ type: "ui-ready" });
// Ask the runtime for the current selection so panels that mount
// immediately see the right mode (Generate vs Edit).
send({ type: "probe-selection" });
