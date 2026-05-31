import type {
  ConnectionState,
  SkillContext,
  SkillDef,
  SkillInstance,
} from "./registry";
import type { ProgressData } from "../types";

const MCP_CONFIG = {
  mcpServers: {
    TalkToFigma: {
      command: "bunx",
      args: ["cursor-talk-to-figma-mcp@latest"],
    },
  },
};

const MCP_CONFIG_JSON = JSON.stringify(MCP_CONFIG, null, 2);

export const settingsSkill: SkillDef = {
  id: "settings",
  title: "Talk To Figma MCP",
  description: "Connection, channel, and MCP config",
  group: "system",
  render(host, ctx) {
    return renderSettings(host, ctx);
  },
};

function renderSettings(host: HTMLElement, ctx: SkillContext): SkillInstance {
  host.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "panel";

  // Connection section
  const connectionSection = document.createElement("section");
  connectionSection.className = "panel-section";

  const connectionTitle = document.createElement("h2");
  connectionTitle.className = "panel-section-title";
  connectionTitle.textContent = "Connection";
  connectionSection.appendChild(connectionTitle);

  const connectionLead = document.createElement("p");
  connectionLead.className = "panel-section-body";
  connectionLead.textContent =
    "Connect this plugin to the local Cursor MCP relay so Cursor can drive Figma.";
  connectionSection.appendChild(connectionLead);

  const portField = document.createElement("div");
  portField.className = "field";

  const portLabel = document.createElement("label");
  portLabel.className = "field-label";
  portLabel.htmlFor = "settings-port";
  portLabel.textContent = "WebSocket server port";
  portField.appendChild(portLabel);

  const portInput = document.createElement("input");
  portInput.type = "number";
  portInput.id = "settings-port";
  portInput.className = "input";
  portInput.min = "1024";
  portInput.max = "65535";
  portInput.value = String(ctx.getConnection().serverPort || 3055);
  portField.appendChild(portInput);

  connectionSection.appendChild(portField);

  const connectBtn = document.createElement("button");
  connectBtn.type = "button";
  connectBtn.className = "button button-block";
  connectBtn.textContent = "Connect";
  connectionSection.appendChild(connectBtn);

  const statusEl = document.createElement("div");
  statusEl.className = "status status--disconnected";
  connectionSection.appendChild(statusEl);

  panel.appendChild(connectionSection);

  // MCP config section
  const mcpSection = document.createElement("section");
  mcpSection.className = "panel-section hidden";

  const mcpTitle = document.createElement("h2");
  mcpTitle.className = "panel-section-title";
  mcpTitle.textContent = "MCP Configuration";
  mcpSection.appendChild(mcpTitle);

  const mcpLead = document.createElement("p");
  mcpLead.className = "panel-section-body";
  mcpLead.innerHTML =
    "Copy this configuration into your <code>mcp.json</code> in Cursor:";
  mcpSection.appendChild(mcpLead);

  const mcpTextarea = document.createElement("textarea");
  mcpTextarea.className = "textarea";
  mcpTextarea.rows = 5;
  mcpTextarea.readOnly = true;
  mcpTextarea.value = MCP_CONFIG_JSON;
  mcpSection.appendChild(mcpTextarea);

  const mcpCopyBtn = document.createElement("button");
  mcpCopyBtn.type = "button";
  mcpCopyBtn.className = "button button-secondary";
  mcpCopyBtn.textContent = "Copy to clipboard";
  mcpSection.appendChild(mcpCopyBtn);

  panel.appendChild(mcpSection);

  // Progress section (only visible during operations)
  const progressSection = document.createElement("section");
  progressSection.className = "panel-section hidden";

  const progressTitle = document.createElement("h2");
  progressTitle.className = "panel-section-title";
  progressTitle.textContent = "Operation Progress";
  progressSection.appendChild(progressTitle);

  const progressBlock = document.createElement("div");
  progressBlock.className = "progress";

  const progressMessage = document.createElement("div");
  progressMessage.className = "panel-section-body";
  progressMessage.textContent = "No operation in progress";
  progressBlock.appendChild(progressMessage);

  const progressTrack = document.createElement("div");
  progressTrack.className = "progress-track";
  const progressFill = document.createElement("div");
  progressFill.className = "progress-fill";
  progressTrack.appendChild(progressFill);
  progressBlock.appendChild(progressTrack);

  const progressMeta = document.createElement("div");
  progressMeta.className = "progress-meta";
  const progressStatus = document.createElement("div");
  progressStatus.textContent = "Not started";
  const progressPercentage = document.createElement("div");
  progressPercentage.textContent = "0%";
  progressMeta.appendChild(progressStatus);
  progressMeta.appendChild(progressPercentage);
  progressBlock.appendChild(progressMeta);

  progressSection.appendChild(progressBlock);
  panel.appendChild(progressSection);

  // About section
  const aboutSection = document.createElement("section");
  aboutSection.className = "panel-section";

  const aboutTitle = document.createElement("h2");
  aboutTitle.className = "panel-section-title";
  aboutTitle.textContent = "About";
  aboutSection.appendChild(aboutTitle);

  const aboutLead = document.createElement("p");
  aboutLead.className = "panel-section-body";
  aboutLead.appendChild(
    document.createTextNode(
      "Talk To Figma lets Cursor drive Figma over an MCP relay. "
    )
  );
  const repoLink = document.createElement("a");
  repoLink.className = "link";
  repoLink.textContent = "GitHub";
  repoLink.addEventListener("click", () => {
    window.open(
      "https://github.com/grab/cursor-talk-to-figma-mcp",
      "_blank"
    );
  });
  aboutLead.appendChild(repoLink);
  aboutSection.appendChild(aboutLead);

  const aboutSteps = document.createElement("ol");
  aboutSteps.className = "panel-section-body";
  for (const step of [
    "Make sure the MCP server is running in Cursor.",
    "Connect to the relay using the port number (default 3055).",
    "Use the skills in this plugin, or drive it from Cursor over MCP.",
  ]) {
    const li = document.createElement("li");
    li.textContent = step;
    aboutSteps.appendChild(li);
  }
  aboutSection.appendChild(aboutSteps);

  const analyticsNote = document.createElement("p");
  analyticsNote.className = "footnote";
  analyticsNote.textContent =
    "Anonymous usage analytics (plugin opens, command names, success/error) are sent to Google Analytics to help improve the plugin. No file content or personal data is collected.";
  aboutSection.appendChild(analyticsNote);

  panel.appendChild(aboutSection);

  host.appendChild(panel);

  // Sync helpers
  function renderConnection(state: ConnectionState) {
    portInput.value = String(state.serverPort || 3055);
    portInput.disabled = state.connected || state.connecting;

    if (state.connected) {
      connectBtn.textContent = "Disconnect";
      connectBtn.className = "button button-secondary button-block";
      mcpSection.classList.remove("hidden");
    } else {
      connectBtn.textContent = state.connecting ? "Connecting..." : "Connect";
      connectBtn.className = "button button-block";
      mcpSection.classList.add("hidden");
    }

    let message = state.statusMessage;
    if (!message) {
      message = state.connected
        ? state.channel
          ? "Connected to server in channel: <strong>" +
            state.channel +
            "</strong>"
          : "Connected to Cursor MCP server"
        : "Not connected to Cursor MCP server";
    }
    if (!state.connected && !state.connecting) {
      message +=
        "<br><br>Run this in your terminal, then connect<br><code>bunx cursor-talk-to-figma-socket</code>";
    }
    statusEl.innerHTML = message;
    statusEl.className =
      "status " +
      (state.connected
        ? "status--connected"
        : state.connecting
        ? "status--info"
        : "status--disconnected");
  }

  function renderProgress(data: ProgressData | null) {
    if (!data) {
      progressSection.classList.add("hidden");
      return;
    }
    progressSection.classList.remove("hidden");
    const progress = typeof data.progress === "number" ? data.progress : 0;
    progressFill.style.setProperty("--p", String(progress));
    progressFill.setAttribute("data-progress", String(progress));
    progressPercentage.textContent = progress + "%";
    progressMessage.textContent = data.message || "Operation in progress";

    progressStatus.className = "";
    if (data.status === "started") {
      progressStatus.textContent = "Started";
    } else if (data.status === "in_progress") {
      progressStatus.textContent = "In Progress";
    } else if (data.status === "completed") {
      progressStatus.textContent = "Completed";
      progressStatus.className = "progress-meta--complete";
    } else if (data.status === "error") {
      progressStatus.textContent = "Error";
      progressStatus.className = "progress-meta--error";
    } else {
      progressStatus.textContent = "Not started";
    }
  }

  // Wire up interactions
  portInput.addEventListener("input", () => {
    const value = parseInt(portInput.value, 10);
    if (!Number.isNaN(value)) {
      ctx.send({ type: "update-settings", serverPort: value });
    }
  });

  connectBtn.addEventListener("click", () => {
    const state = ctx.getConnection();
    if (state.connected || state.connecting) {
      ctx.disconnect();
    } else {
      const port = parseInt(portInput.value, 10) || 3055;
      ctx.connect(port);
    }
  });

  mcpCopyBtn.addEventListener("click", () => {
    mcpTextarea.select();
    try {
      document.execCommand("copy");
    } catch {
      // Best-effort copy; modern browsers may require user gesture context.
    }
    const original = mcpCopyBtn.textContent;
    mcpCopyBtn.textContent = "Copied!";
    setTimeout(() => {
      mcpCopyBtn.textContent = original || "Copy to clipboard";
    }, 2000);
  });

  // Subscribe to live state from the shell
  const unsubscribeConnection = ctx.onConnectionChange(renderConnection);
  const unsubscribePlugin = ctx.onPluginMessage((msg) => {
    if (msg.type === "command_progress") {
      const { type: _type, ...rest } = msg;
      renderProgress(rest as ProgressData);
    }
  });

  renderConnection(ctx.getConnection());
  renderProgress(null);

  return {
    dispose() {
      unsubscribeConnection();
      unsubscribePlugin();
    },
  };
}
