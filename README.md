# Claude Code for Obsidian

Embed [Claude Code](https://claude.ai/code) as a sidebar panel in Obsidian, giving you full agentic AI capabilities — file editing, Bash commands, web search, and multi-step workflows — without leaving your vault.

## Requirements

- **Obsidian** desktop (macOS, Windows, or Linux)
- **Claude Code VSCode extension** installed in VSCode (`anthropic.claude-code`)
- The plugin uses the extension's bundled binary, so the extension must be present

<img width="1069" height="868" alt="Screenshot 2026-04-15 at 7 16 39 PM" src="https://github.com/user-attachments/assets/0bf30838-dbbd-46ef-a85f-77aa8339ba52" />

## Installation

### From Community Plugins (recommended)

1. Open Obsidian Settings → Community plugins
2. Search for **Claude Code**
3. Install and enable

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/torreyleonard/obsidian-claude-code/releases/latest)
2. Copy them to `<vault>/.obsidian/plugins/claude-code/`
3. Enable the plugin in Settings → Community plugins

## Usage

- Click the robot icon in the left ribbon, or run **Open Claude Code** from the command palette
- The Claude Code panel opens as a right sidebar
- Type your prompt and press Enter — Claude can read files, run Bash commands, search the web, and make edits across your vault

## Settings

| Setting | Description |
|---|---|
| Working directory | Directory Claude uses as its root. Defaults to your vault path. |
| Permission mode | Controls how Claude asks before taking actions. |
| Default model | Claude model to use (leave blank for the SDK default). |
| Effort level | How much reasoning effort Claude applies. |
| Claude binary path | Override the auto-detected Claude binary (advanced). |

## How it works

This plugin embeds the Claude Code VSCode extension's webview UI directly in an Obsidian sidebar. It communicates with Claude through the `@anthropic-ai/claude-agent-sdk`, using the extension's bundled native binary so no separate CLI installation is required.

## License

MIT
