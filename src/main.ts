// Patch import.meta before any SDK imports — required in Electron/CommonJS context.
// esbuild replaces import.meta.url with "file://obsidian-plugin" but we need the
// full patch here for any SDK code that checks import.meta at runtime.
if (typeof (globalThis as Record<string, unknown>)["importMeta"] === "undefined") {
  (globalThis as Record<string, unknown>)["importMeta"] = { url: "file:///obsidian-plugin" };
}

// Augment PATH so subprocess spawning (e.g. the claude binary) can find node.
// Electron's renderer strips PATH to minimal system dirs, omitting /usr/local/bin etc.
{
  const home = process.env.HOME ?? "";
  const extra = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    `${home}/.volta/bin`,
    `${home}/.nvm/versions/node/current/bin`,
    `${home}/.asdf/shims`,
    `${home}/.local/bin`,
  ];
  const existing = (process.env.PATH ?? "").split(":");
  const additions = extra.filter((p) => p && !existing.includes(p));
  if (additions.length > 0) {
    process.env.PATH = [...additions, ...existing].filter(Boolean).join(":");
  }
}

// Patch events.setMaxListeners to tolerate browser-realm AbortSignal.
// In Electron, the SDK calls events.setMaxListeners(n, abortSignal) but Node.js's
// internal instanceof EventTarget check fails for browser-realm AbortSignals,
// throwing ERR_INVALID_ARG_TYPE with "eventTargets" argument name.
try {
  const events = require("events") as { setMaxListeners: (...args: unknown[]) => void };
  const _orig = events.setMaxListeners.bind(events);
  events.setMaxListeners = function (n: unknown, ...targets: unknown[]) {
    const safe = targets.filter((t) => !(t instanceof AbortSignal));
    _orig(n, ...safe);
  };
} catch { /* ignore if events module unavailable */ }

import { Plugin, addIcon } from "obsidian";
import { VIEW_TYPE_CLAUDE_CODE, PLUGIN_DISPLAY_NAME } from "./constants";
import { ClaudeCodeView } from "./view/ClaudeCodeView";
import { ClaudeCodeSettingsTab } from "./settings/SettingsTab";
import type { ClaudeCodeSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

// ── Custom icon (Claude logo, matching VS Code extension) ────────────────────
addIcon(
  "cc-bot",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
    <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fill-rule="nonzero"/>
  </svg>`
);

export default class ClaudeCodePlugin extends Plugin {
  settings!: ClaudeCodeSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register the sidebar view
    this.registerView(VIEW_TYPE_CLAUDE_CODE, (leaf) => new ClaudeCodeView(leaf, this));

    // Ribbon icon to open the view
    this.addRibbonIcon("cc-bot", PLUGIN_DISPLAY_NAME, () => this.activateView());

    // Settings tab
    this.addSettingTab(new ClaudeCodeSettingsTab(this.app, this));

    // Commands
    this.addCommand({
      id: "open-claude-code",
      name: "Open Claude Code",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "focus-claude-code",
      name: "Focus Claude Code input",
      callback: () => this.focusInput(),
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CLAUDE_CODE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    // If already open, reveal it
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CODE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    // Open in right sidebar
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({
      type: VIEW_TYPE_CLAUDE_CODE,
      active: true,
    });

    workspace.revealLeaf(leaf);
  }

  private focusInput(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CODE);
    if (leaves.length === 0) {
      this.activateView();
    }
    // Focus is handled by the embedded webview itself
  }
}
