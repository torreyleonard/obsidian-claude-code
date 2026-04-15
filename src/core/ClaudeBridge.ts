import type { PermissionModeId } from "../types";
import { ClaudePathFinder } from "./ClaudePathFinder";

// ── SDK types (lazy-imported) ────────────────────────────────────────────────
type SDKQuery = {
  [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>>;
  interrupt(): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  initializationResult(): Promise<Record<string, unknown>>;
  close(): void;
};

type QueryFn = (options: {
  prompt: string | AsyncIterable<unknown>;
  options?: QueryOptions;
}) => SDKQuery;

interface QueryOptions {
  cwd?: string;
  permissionMode?: string;
  model?: string;
  effort?: string;
  resume?: string;
  tools?: { type: "preset"; preset: "claude_code" };
  pathToClaudeCodeExecutable?: string;
  stderr?: (data: string) => void;
}

interface SDKSession {
  sessionId?: string;
  session_id?: string;
  customTitle?: string;
  title?: string;
  summary?: string;
  firstPrompt?: string;
  lastModified?: number;
  createdAt?: number;
  fileSize?: number;
  gitBranch?: string;
}

/** Simple async queue that drives the SDK's message stream. */
class MessageQueue {
  private _queue: unknown[] = [];
  private _resolve: (() => void) | null = null;
  private _closed = false;

  enqueue(msg: unknown): void {
    this._queue.push(msg);
    if (this._resolve) { this._resolve(); this._resolve = null; }
  }

  close(): void {
    this._closed = true;
    if (this._resolve) { this._resolve(); this._resolve = null; }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
    while (true) {
      if (this._queue.length > 0) {
        yield this._queue.shift();
      } else if (this._closed) {
        return;
      } else {
        await new Promise<void>((res) => { this._resolve = res; });
      }
    }
  }
}

interface Channel {
  queue: MessageQueue;
  query: SDKQuery;
  aborted: boolean;
}

type SendFn = (msg: Record<string, unknown>) => void;

/**
 * ClaudeBridge — sits between the embedded VSCode webview and the Claude SDK.
 *
 * Protocol (from extension.js reverse engineering):
 *  webview → extension:  raw message objects via vscode.postMessage()
 *  extension → webview:  { type: "from-extension", message: X } via webview.postMessage()
 *
 * The webview sends:
 *  • launch_claude  → open a persistent channel with a streaming input queue
 *  • io_message     → feed a user SDKUserMessage into the channel queue
 *  • interrupt_claude, close_channel
 *  • request{ type: "..." } → request/response for session/config operations
 *
 * We send back (via `send`):
 *  • io_message events (one per SDK stream message)
 *  • close_channel when done
 *  • response events (replying to request messages)
 */
export class ClaudeBridge {
  private _send: SendFn;
  private _cwd: string;
  private _permissionMode: PermissionModeId;
  private _model: string;
  private _effort: string;
  private _claudePathOverride: string;
  private _extensionNativeBinary: string | undefined;
  private _claudePath: string | null | undefined = undefined;

  private _channels = new Map<string, Channel>();
  private _sdk: Record<string, unknown> | null = null;
  private _configCache: Record<string, unknown> | null = null;

  constructor(opts: {
    send: SendFn;
    cwd: string;
    permissionMode: PermissionModeId;
    model: string;
    effort: string;
    claudePathOverride: string;
    extensionNativeBinary?: string;
  }) {
    this._send = opts.send;
    this._cwd = opts.cwd;
    this._permissionMode = opts.permissionMode;
    this._model = opts.model;
    this._effort = opts.effort;
    this._claudePathOverride = opts.claudePathOverride;
    this._extensionNativeBinary = opts.extensionNativeBinary;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async handleMessage(msg: Record<string, unknown>): Promise<void> {
    try {
      await this._dispatch(msg);
    } catch (err) {
      console.error("[ClaudeBridge]", err);
    }
  }

  async preloadConfig(): Promise<void> {
    if (this._configCache) return;
    await this._ensureSDK();
    const claudePath = await this._getClaudePath();
    if (!claudePath) return;

    try {
      const q = (this._sdk!.query as QueryFn)({
        prompt: "x",
        options: { ...this._baseOpts(this._cwd), pathToClaudeCodeExecutable: claudePath },
      });
      this._configCache = await q.initializationResult();
      q.close();
    } catch (err) {
      console.warn("[ClaudeBridge] Config probe failed:", err);
    }
  }

  close(): void {
    for (const ch of this._channels.values()) {
      ch.aborted = true;
      ch.queue.close();
      try { ch.query.close(); } catch {}
    }
    this._channels.clear();
  }

  updateSettings(opts: { cwd?: string; permissionMode?: PermissionModeId; model?: string; effort?: string }): void {
    if (opts.cwd !== undefined) this._cwd = opts.cwd;
    if (opts.permissionMode !== undefined) this._permissionMode = opts.permissionMode;
    if (opts.model !== undefined) { this._model = opts.model; this._configCache = null; }
    if (opts.effort !== undefined) this._effort = opts.effort;
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────

  private async _dispatch(msg: Record<string, unknown>): Promise<void> {
    const type = msg.type as string;

    switch (type) {
      case "launch_claude":
        await this._launchClaude(
          msg.channelId as string,
          msg.resume as string | undefined,
          (msg.cwd as string) || this._cwd,
          (msg.permissionMode as string) || this._permissionMode
        );
        break;

      case "io_message": {
        const ch = this._channels.get(msg.channelId as string);
        if (ch && !ch.aborted) {
          ch.queue.enqueue(msg.message);
        }
        break;
      }

      case "interrupt_claude": {
        const ch = this._channels.get(msg.channelId as string);
        if (ch) {
          ch.aborted = true;
          try { await ch.query.interrupt(); } catch {}
        }
        break;
      }

      case "close_channel": {
        const ch = this._channels.get(msg.channelId as string);
        if (ch) {
          ch.aborted = true;
          ch.queue.close();
          try { ch.query.close(); } catch {}
          this._channels.delete(msg.channelId as string);
        }
        break;
      }

      case "request":
        await this._handleRequest(msg);
        break;

      case "response":
        break; // webview responding to our requests — no-op

      default:
        break;
    }
  }

  // ── Request / response ─────────────────────────────────────────────────────

  private async _handleRequest(msg: Record<string, unknown>): Promise<void> {
    const requestId = msg.requestId as string;
    const channelId = (msg.channelId as string) ?? "";
    const request = (msg.request as Record<string, unknown>) ?? {};
    const reqType = request.type as string;

    let response: Record<string, unknown>;
    try {
      response = await this._processRequest(reqType, request, channelId);
    } catch (err) {
      response = { type: "error", error: err instanceof Error ? err.message : String(err) };
    }

    if (requestId) {
      this._send({ type: "response", requestId, response });
    }
  }

  private async _processRequest(
    type: string,
    req: Record<string, unknown>,
    _channelId: string
  ): Promise<Record<string, unknown>> {
    switch (type) {

      case "init": {
        if (!this._configCache) await this.preloadConfig();
        // authStatus from SDK config, or fallback "not-specified" (means CLI handles auth)
        const authStatus = (this._configCache as Record<string, unknown> | null)?.authStatus
          ?? { authMethod: "not-specified", email: null, subscriptionType: null };
        return {
          type: "init_response",
          state: {
            defaultCwd: this._cwd,
            openNewInTab: false,
            showTerminalBanner: false,
            showReviewUpsellBanner: false,
            isOnboardingEnabled: false,
            isOnboardingDismissed: true,
            authStatus,
            modelSetting: this._model || null,
            thinkingLevel: this._effort || "auto",
            initialPermissionMode: this._permissionMode,
            allowDangerouslySkipPermissions: false,
            platform: process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
            speechToTextEnabled: false,
            speechToTextMicDenied: false,
            marketplaceType: null,
            useCtrlEnterToSend: false,
            chromeMcpState: { status: "disconnected" },
            browserIntegrationSupported: false,
            debuggerMcpState: { status: "disconnected" },
            jupyterMcpState: { status: "disconnected" },
            remoteControlState: { status: "disconnected" },
            spinnerVerbsConfig: null,
            settings: null,
            claudeSettings: null,
            currentRepo: null,
            experimentGates: {},
          },
        };
      }

      case "get_claude_state": {
        if (!this._configCache) await this.preloadConfig();
        return { type: "get_claude_state_response", config: this._configCache ?? {} };
      }

      case "list_sessions_request": {
        await this._ensureSDK();
        try {
          const sessions = (await (this._sdk!.listSessions as (o?: {limit?:number}) => Promise<SDKSession[]>)({ limit: 100 }))
            .map((s) => ({
              id: s.sessionId ?? s.session_id ?? "",
              lastModified: s.lastModified ?? Date.now(),
              fileSize: s.fileSize ?? 0,
              summary: s.customTitle ?? s.title ?? s.summary ?? s.firstPrompt ?? "Untitled",
              gitBranch: s.gitBranch ?? null,
              worktree: null,
              isCurrentWorkspace: true,
            }))
            .filter((s) => s.id);
          return { type: "list_sessions_response", sessions };
        } catch {
          return { type: "list_sessions_response", sessions: [] };
        }
      }

      case "get_session_request": {
        await this._ensureSDK();
        const sid = req.sessionId as string;
        try {
          const msgs = await (this._sdk!.getSessionMessages as (id: string) => Promise<unknown[]>)(sid);
          return { type: "get_session_response", messages: msgs, sessionId: sid };
        } catch {
          return { type: "get_session_response", messages: [], sessionId: sid };
        }
      }

      case "delete_session": {
        await this._ensureSDK();
        try {
          await (this._sdk!.deleteSession as (id: string, o?: {cwd?:string}) => Promise<void>)(
            req.sessionId as string, { cwd: this._cwd }
          );
        } catch {}
        return { type: "delete_session_response" };
      }

      case "rename_session": {
        await this._ensureSDK();
        try {
          await (this._sdk!.renameSession as (id: string, t: string, o?: {cwd?:string}) => Promise<void>)(
            req.sessionId as string, req.title as string, { cwd: this._cwd }
          );
        } catch {}
        return { type: "rename_session_response", skipped: false };
      }

      case "fork_conversation": {
        await this._ensureSDK();
        try {
          const r = await (this._sdk!.forkSession as (id: string, o?: {cwd?:string}) => Promise<{sessionId:string}>)(
            req.sessionId as string, { cwd: this._cwd }
          );
          return { type: "fork_conversation_response", sessionId: r.sessionId };
        } catch (err) {
          return { type: "fork_conversation_response", error: String(err) };
        }
      }

      case "generate_session_title":
        return { type: "generate_session_title_response", title: "" };

      case "get_context_usage":
        return { type: "get_context_usage_response", contextWindowUsageRatio: 0 };

      case "set_permission_mode": {
        this._permissionMode = req.mode as PermissionModeId;
        for (const ch of this._channels.values()) {
          try { await ch.query.setPermissionMode(this._permissionMode); } catch {}
        }
        return { type: "set_permission_mode_response" };
      }

      case "set_model":
        this._model = (req.model as string) ?? "";
        this._configCache = null;
        return { type: "set_model_response" };

      case "get_current_selection":
        return { type: "get_current_selection_response", selection: null };

      case "open_url":
        try {
          const { shell } = require("electron") as { shell: { openExternal: (u: string) => Promise<void> } };
          await shell.openExternal(req.url as string);
        } catch {}
        return { type: "open_url_response" };

      case "get_asset_uris":
        return { type: "get_asset_uris_response", uris: {} };

      default:
        return { type: `${type}_response` };
    }
  }

  // ── Channel management ────────────────────────────────────────────────────

  private async _launchClaude(
    channelId: string,
    resume: string | undefined,
    cwd: string,
    permissionMode: string
  ): Promise<void> {
    if (this._channels.has(channelId)) return;

    await this._ensureSDK();
    const claudePath = await this._getClaudePath();
    if (!claudePath) {
      this._send({ type: "close_channel", channelId, error: "Claude binary not found. Install: npm install -g @anthropic-ai/claude-code" });
      return;
    }

    const queue = new MessageQueue();
    const stderrBuf: string[] = [];
    const opts: QueryOptions = {
      ...this._baseOpts(cwd),
      permissionMode,
      pathToClaudeCodeExecutable: claudePath,
      stderr: (data) => {
        stderrBuf.push(data);
        console.error("[ClaudeBridge stderr]", data);
      },
    };
    if (resume) opts.resume = resume;

    let query: SDKQuery;
    try {
      query = (this._sdk!.query as QueryFn)({ prompt: queue as AsyncIterable<unknown>, options: opts });
    } catch (err) {
      this._send({ type: "close_channel", channelId, error: String(err) });
      return;
    }

    const channel: Channel = { queue, query, aborted: false };
    this._channels.set(channelId, channel);

    // Cache config from first channel if not already cached
    query.initializationResult().then((init) => {
      if (!this._configCache) this._configCache = init;
    }).catch(() => {});

    // Stream SDK messages to webview
    (async () => {
      try {
        for await (const msg of query) {
          if (channel.aborted) break;
          const m = msg as Record<string, unknown>;
          // Skip internal bridge_state messages
          if (m.type === "system" && m.subtype === "bridge_state") continue;
          this._send({ type: "io_message", channelId, message: m, done: false });
        }
      } catch (err) {
        const e = err instanceof Error ? err.message : String(err);
        if (!e.toLowerCase().includes("interrupt") && !e.toLowerCase().includes("abort")) {
          const detail = stderrBuf.length > 0 ? `${e}\nstderr: ${stderrBuf.join("").trim()}` : e;
          this._send({ type: "close_channel", channelId, error: detail });
          this._channels.delete(channelId);
          return;
        }
      }
      this._channels.delete(channelId);
      this._send({ type: "close_channel", channelId });
    })();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _baseOpts(cwd: string): QueryOptions {
    const opts: QueryOptions = { cwd, tools: { type: "preset", preset: "claude_code" } };
    if (this._model) opts.model = this._model;
    if (this._effort) opts.effort = this._effort;
    return opts;
  }

  private async _ensureSDK(): Promise<void> {
    if (this._sdk) return;
    this._sdk = await import("@anthropic-ai/claude-agent-sdk") as Record<string, unknown>;
  }

  private async _getClaudePath(): Promise<string | null> {
    if (this._claudePath === undefined) {
      // Explicit user override wins.
      if (this._claudePathOverride && this._claudePathOverride.trim()) {
        this._claudePath = await ClaudePathFinder.find(this._claudePathOverride);
      // Native binary from VSCode extension: self-contained, no PATH dependency.
      } else if (this._extensionNativeBinary) {
        this._claudePath = this._extensionNativeBinary;
      } else {
        this._claudePath = await ClaudePathFinder.find();
      }
    }
    return this._claudePath;
  }
}
