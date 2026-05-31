import type {
  PluginToUiMessage,
  UiToPluginMessage,
} from "../types";

/**
 * A registered "panel" in the plugin shell. The shell renders the
 * landing list from this registry; each entry can render its own UI
 * into a host element and subscribes to plugin-runtime messages
 * through the provided context.
 *
 * The shell owns transient state (WebSocket connection, analytics,
 * progress); skills are *views* into that state and should not hold
 * the connection themselves.
 */
export interface SkillDef {
  id: string;
  title: string;
  description: string;
  /** Skill group shown above this entry in the landing list. */
  group?: "skills" | "system";
  /**
   * If set, the skill requires this Figma editor type at runtime.
   * The shell renders a notice on the landing row when the current
   * editor does not match. The plugin runtime is the source of truth
   * for actually short-circuiting work.
   */
  requires?: "figma" | "figjam";
  render(host: HTMLElement, ctx: SkillContext): SkillInstance;
}

export interface SkillContext {
  /** Post a typed message to the plugin runtime. */
  send: (msg: UiToPluginMessage) => void;
  /**
   * Subscribe to incoming plugin -> UI messages. Returns an unsubscribe
   * function that must be called from the skill's `dispose()`.
   */
  onPluginMessage: (
    handler: (msg: PluginToUiMessage) => void
  ) => () => void;
  /** Currently observed connection state (mirrored from the shell). */
  getConnection(): ConnectionState;
  /** Subscribe to connection state changes. */
  onConnectionChange: (
    handler: (state: ConnectionState) => void
  ) => () => void;
  /** Trigger a connection lifecycle action from the panel. */
  connect: (port: number) => void;
  disconnect: () => void;
  /**
   * Latest selection context observed by the plugin runtime for this
   * skill. Mirrors the most recent `selection-contexts` map entry so a
   * panel mounted mid-session immediately knows whether to render
   * Generate, Edit, Arrange, or Idle mode. Returns `null` before the
   * first probe completes or when no probe is registered for this
   * skill id.
   *
   * The shape is `unknown` at the registry level because each skill
   * owns its own context type (Organize Screens uses
   * `OrganizeScreensSelectionContext`). Skill panels cast to their own
   * type after the lookup.
   */
  getSelectionContext(skillId: string): unknown | null;
  /**
   * Subscribe to future selection-context updates for a specific skill
   * id. Handler fires every time the registered probe for that id
   * produces a new value (debounced upstream by the runtime).
   * Subscribers are not notified about other skills' updates, so an
   * unrelated probe firing does not re-render every panel.
   */
  onSelectionContextChange: (
    skillId: string,
    handler: (context: unknown) => void
  ) => () => void;
  /** Track an anonymous analytics event through the shell. */
  trackEvent: (
    name: string,
    params?: Record<string, unknown>
  ) => void;
  /** Navigate back to the landing screen. */
  back: () => void;
}

export interface SkillInstance {
  dispose?(): void;
}

export interface ConnectionState {
  connected: boolean;
  connecting: boolean;
  channel: string | null;
  serverPort: number;
  statusMessage: string;
}
