import { ItemView, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_CLAUDE_CODE, PLUGIN_DISPLAY_NAME } from "../constants";
import { ExtensionFinder } from "../core/ExtensionFinder";
import { generateBridgeHtml, type ObsidianTheme } from "../core/BridgeHtmlGenerator";
import { ClaudeBridge } from "../core/ClaudeBridge";
import type ClaudeCodePlugin from "../main";

export class ClaudeCodeView extends ItemView {
  private _plugin: ClaudeCodePlugin;
  private _iframe: HTMLIFrameElement | null = null;
  private _bridge: ClaudeBridge | null = null;
  private _messageHandler: ((e: MessageEvent) => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodePlugin) {
    super(leaf);
    this._plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE_CLAUDE_CODE; }
  getDisplayText(): string { return PLUGIN_DISPLAY_NAME; }
  getIcon(): string { return "cc-bot"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.style.cssText = "padding:0;overflow:hidden;height:100%;display:flex;flex-direction:column;";

    // ── Find the VSCode extension ─────────────────────────────────────────
    const ext = ExtensionFinder.find();
    if (!ext) {
      this._renderError(root, "notfound");
      return;
    }

    // ── Determine working directory ───────────────────────────────────────
    const cwd = this._plugin.settings.workingDirectory
      || (this.app.vault.adapter as { basePath?: string }).basePath
      || process.env.HOME
      || "/";

    // ── Generate bridge HTML with current Obsidian theme ─────────────────
    let html: string;
    try {
      html = generateBridgeHtml(ext, cwd, this._readTheme());
    } catch (err) {
      this._renderError(root, "write", `Failed to generate HTML: ${err}`);
      return;
    }

    // ── Set up bridge ────────────────────────────────────────────────────
    this._bridge = new ClaudeBridge({
      send: (msg) => this._sendToWebview(msg),
      cwd,
      permissionMode: this._plugin.settings.permissionMode,
      model: this._plugin.settings.model,
      effort: this._plugin.settings.effort ?? "",
      claudePathOverride: this._plugin.settings.claudeBinaryPath,
      extensionNativeBinary: ext.nativeBinary ?? undefined,
    });

    // Warm up config in background
    this._bridge.preloadConfig().catch(() => {});

    // ── Create iframe using srcdoc ────────────────────────────────────────
    // srcdoc inlines HTML content and inherits the parent's security context,
    // avoiding cross-origin restrictions from Obsidian's custom protocol.
    this._iframe = document.createElement("iframe");
    this._iframe.style.cssText = "width:100%;height:100%;border:none;flex:1;display:block;";
    this._iframe.srcdoc = html;
    root.appendChild(this._iframe);

    // ── Wire message passing ──────────────────────────────────────────────
    // Messages from iframe arrive here (iframe calls window.parent.postMessage)
    this._messageHandler = (e: MessageEvent) => {
      if (e.source !== this._iframe?.contentWindow) return;
      const msg = e.data as Record<string, unknown>;
      if (msg && typeof msg.type === "string") {
        this._bridge?.handleMessage(msg);
      }
    };
    window.addEventListener("message", this._messageHandler);
  }

  async onClose(): Promise<void> {
    if (this._messageHandler) {
      window.removeEventListener("message", this._messageHandler);
      this._messageHandler = null;
    }
    this._bridge?.close();
    this._bridge = null;
    this._iframe = null;
  }

  // ── Send a message to the webview ─────────────────────────────────────────
  private _sendToWebview(msg: Record<string, unknown>): void {
    if (!this._iframe?.contentWindow) return;
    // VSCode webview protocol: host messages arrive as { type: "from-extension", message: X }
    this._iframe.contentWindow.postMessage(
      { type: "from-extension", message: msg },
      "*"
    );
  }

  // ── Read current Obsidian theme into VSCode-compatible values ────────────
  private _readTheme(): ObsidianTheme {
    const s = getComputedStyle(document.body);
    const get = (v: string, fallback = "") =>
      s.getPropertyValue(v).trim() || fallback;

    return {
      bgPrimary:    get("--background-primary",    "#1e1e2e"),
      bgSecondary:  get("--background-secondary",  "#181825"),
      bgBorder:     get("--background-modifier-border", "#45475a"),
      bgHover:      get("--background-modifier-hover",  "#313244"),
      bgFormField:  get("--background-modifier-form-field", get("--background-primary", "#1e1e2e")),
      textNormal:   get("--text-normal",   "#cdd6f4"),
      textMuted:    get("--text-muted",    "#a6adc8"),
      textFaint:    get("--text-faint",    "#585b70"),
      textOnAccent: get("--text-on-accent","#1e1e2e"),
      accent:       get("--interactive-accent",       "#cba6f7"),
      accentHover:  get("--interactive-accent-hover", get("--interactive-accent", "#cba6f7")),
      fontInterface: get("--font-interface", "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"),
      fontMonospace: get("--font-monospace",  "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"),
      fontSize:      get("--font-text-size",  "14px"),
    };
  }

  // ── Error states ──────────────────────────────────────────────────────────
  private _renderError(root: HTMLElement, reason: "notfound" | "write", detail?: string): void {
    root.style.cssText = "padding:24px;font-family:var(--font-interface);color:var(--text-normal);";

    if (reason === "notfound") {
      root.innerHTML = `
        <h3 style="color:var(--color-orange);margin-bottom:12px">Claude Code VSCode Extension Not Found</h3>
        <p>This plugin embeds the Claude Code VSCode extension's UI directly.</p>
        <p>Install it first:</p>
        <ol style="margin:8px 0 16px 20px;line-height:1.8">
          <li>Open VSCode</li>
          <li>Install the <strong>Claude Code</strong> extension (by Anthropic)</li>
          <li>Reopen this panel</li>
        </ol>
        <p style="color:var(--text-faint);font-size:12px">
          Looked in <code>~/.vscode/extensions/</code> for <code>anthropic.claude-code-*</code>
        </p>`;
    } else {
      root.innerHTML = `
        <h3 style="color:var(--color-red)">Failed to initialize Claude Code</h3>
        <pre style="font-size:12px;color:var(--text-muted);white-space:pre-wrap">${detail ?? ""}</pre>`;
    }
  }
}
