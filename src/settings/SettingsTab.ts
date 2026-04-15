import { App, PluginSettingTab, Setting, TextComponent } from "obsidian";
import type ClaudeCodePlugin from "../main";
import { PERMISSION_MODES } from "../constants";

export class ClaudeCodeSettingsTab extends PluginSettingTab {
  plugin: ClaudeCodePlugin;

  constructor(app: App, plugin: ClaudeCodePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Claude Code" });

    // ── Binary path ──────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Claude binary path")
      .setDesc(
        "Override the auto-detected path to the claude CLI. Leave empty to auto-detect from PATH and common install locations."
      )
      .addText((text: TextComponent) =>
        text
          .setPlaceholder("/usr/local/bin/claude")
          .setValue(this.plugin.settings.claudeBinaryPath)
          .onChange(async (value) => {
            this.plugin.settings.claudeBinaryPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ── Working directory ────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Working directory")
      .setDesc(
        "Directory Claude Code will use as its working directory. Leave empty to use the vault path."
      )
      .addText((text: TextComponent) =>
        text
          .setPlaceholder("(vault path)")
          .setValue(this.plugin.settings.workingDirectory)
          .onChange(async (value) => {
            this.plugin.settings.workingDirectory = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ── Default permission mode ──────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Default permission mode")
      .setDesc("What Claude does when it wants to run tools or edit files.")
      .addDropdown((dd) => {
        for (const mode of PERMISSION_MODES) {
          dd.addOption(mode.id, `${mode.label} — ${mode.description}`);
        }
        dd.setValue(this.plugin.settings.permissionMode);
        dd.onChange(async (value) => {
          this.plugin.settings.permissionMode = value as ClaudeCodePlugin["settings"]["permissionMode"];
          await this.plugin.saveSettings();
        });
      });

    // ── Default model ────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Default model")
      .setDesc("Claude model to use. Leave empty to use the SDK default (recommended).")
      .addText((text: TextComponent) =>
        text
          .setPlaceholder("claude-sonnet-4-5 (default)")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ── Effort ───────────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Effort level")
      .setDesc("Controls how much reasoning effort Claude applies. Leave empty for default.")
      .addDropdown((dd) => {
        dd.addOption("", "Default");
        for (const level of ["low", "medium", "high", "max"] as const) {
          dd.addOption(level, level.charAt(0).toUpperCase() + level.slice(1));
        }
        dd.setValue(this.plugin.settings.effort ?? "");
        dd.onChange(async (value) => {
          this.plugin.settings.effort = value as ClaudeCodePlugin["settings"]["effort"];
          await this.plugin.saveSettings();
        });
      });

    // ── Show thinking ────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Show thinking blocks")
      .setDesc("Display Claude's extended thinking / reasoning when available.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showThinking)
          .onChange(async (value) => {
            this.plugin.settings.showThinking = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Status ───────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Status" });
    const statusEl = containerEl.createEl("p", { cls: "setting-item-description" });

    import("../core/ClaudePathFinder").then(({ ClaudePathFinder }) => {
      ClaudePathFinder.find(this.plugin.settings.claudeBinaryPath).then((p) => {
        if (p) {
          statusEl.textContent = `✓ Claude binary found: ${p}`;
          statusEl.style.color = "var(--color-green)";
        } else {
          statusEl.textContent =
            "✗ Claude binary not found. Install with: npm install -g @anthropic-ai/claude-code";
          statusEl.style.color = "var(--color-red)";
        }
      });
    });
  }
}
