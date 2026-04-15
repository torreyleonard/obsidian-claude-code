import { readFileSync } from "fs";
import type { ExtensionInfo } from "./ExtensionFinder";

export interface ObsidianTheme {
  // Backgrounds
  bgPrimary: string;
  bgSecondary: string;
  bgBorder: string;
  bgHover: string;
  bgFormField: string;
  // Text
  textNormal: string;
  textMuted: string;
  textFaint: string;
  textOnAccent: string;
  // Accent
  accent: string;
  accentHover: string;
  // Fonts
  fontInterface: string;
  fontMonospace: string;
  fontSize: string;
}

/**
 * Generates a standalone HTML file that:
 *  1. Shims acquireVsCodeApi() so the VSCode webview bundle works outside VSCode
 *  2. Inlines the extension's webview/index.css and webview/index.js directly
 *  3. Maps Obsidian theme → VSCode CSS variables so the UI inherits the active theme
 *  4. Bridges postMessage ↔ window.parent for the Obsidian host
 */
export function generateBridgeHtml(ext: ExtensionInfo, cwd: string, theme: ObsidianTheme): string {
  const resourcesUrl = pathToFileUrl(ext.resourcesDir);

  // Inline CSS and JS to avoid Electron cross-origin file:// restrictions.
  // Must escape </script> and </style> inside inline blocks or the HTML parser
  // terminates the tag early, causing a syntax error.
  let css = "";
  let js = "";
  try {
    css = readFileSync(ext.webviewCss, "utf8")
      .replace(/<\/style>/gi, "<\\/style>");
  } catch (e) {
    console.warn("[BridgeHtmlGenerator] Could not read webview CSS:", e);
  }
  try {
    js = readFileSync(ext.webviewIndex, "utf8")
      .replace(/<\/script>/gi, "<\\/script>");
  } catch (e) {
    console.warn("[BridgeHtmlGenerator] Could not read webview JS:", e);
    js = 'document.getElementById("claude-error").textContent = "Failed to load webview/index.js";';
  }

  // Build VSCode theme variable block from Obsidian theme values
  const themeVars = `
    /* Map Obsidian theme → VSCode CSS variables used by the webview */
    --vscode-chat-font-family: ${theme.fontInterface};
    --vscode-chat-font-size: ${theme.fontSize};
    --vscode-font-family: ${theme.fontInterface};
    --vscode-font-size: ${theme.fontSize};
    --vscode-editor-font-family: ${theme.fontMonospace};
    --vscode-editor-font-size: ${theme.fontSize};
    --vscode-foreground: ${theme.textNormal};
    --vscode-descriptionForeground: ${theme.textMuted};
    --vscode-disabledForeground: ${theme.textFaint};
    --vscode-errorForeground: #e05252;
    --vscode-sideBar-background: ${theme.bgSecondary};
    --vscode-editor-background: ${theme.bgPrimary};
    --vscode-input-background: ${theme.bgFormField};
    --vscode-input-foreground: ${theme.textNormal};
    --vscode-input-placeholderForeground: ${theme.textFaint};
    --vscode-inlineChatInput-border: ${theme.bgBorder};
    --vscode-inputOption-activeBorder: ${theme.accent};
    --vscode-sideBarActivityBarTop-border: ${theme.bgBorder};
    --vscode-editorWidget-border: ${theme.bgBorder};
    --vscode-widget-border: ${theme.bgBorder};
    --vscode-menu-background: ${theme.bgSecondary};
    --vscode-menu-border: ${theme.bgBorder};
    --vscode-menu-foreground: ${theme.textNormal};
    --vscode-menu-selectionBackground: ${theme.accent};
    --vscode-menu-selectionForeground: ${theme.textOnAccent};
    --vscode-list-hoverBackground: ${theme.bgHover};
    --vscode-list-activeSelectionBackground: ${theme.accent};
    --vscode-list-activeSelectionForeground: ${theme.textOnAccent};
    --vscode-toolbar-hoverBackground: ${theme.bgHover};
    --vscode-editor-lineHighlightBackground: ${theme.bgHover};
    --vscode-button-foreground: ${theme.textOnAccent};
    --vscode-button-background: ${theme.accent};
    --vscode-button-hoverBackground: ${theme.accentHover};
    --vscode-progressBar-background: ${theme.accent};
    --vscode-badge-foreground: ${theme.textOnAccent};
    --vscode-badge-background: ${theme.accent};
    --vscode-sash-hoverBorder: ${theme.accent};
    --vscode-editorMarkerNavigationInfo-headerBackground: ${theme.accent};
    --vscode-gitDecoration-addedResourceForeground: #22c55e;
    --vscode-gitDecoration-deletedResourceForeground: #e05252;
    --vscode-charts-blue: #3b82f6;
    --vscode-charts-green: #22c55e;
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Code</title>
  <style>${css}</style>
  <style>
    html { ${themeVars} }
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { font-family: ${theme.fontInterface}; font-size: ${theme.fontSize}; }
    #root { height: 100%; display: flex; flex-direction: column; padding-bottom: 28px; box-sizing: border-box; }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="claude-error"></div>

  <script>
    // ── acquireVsCodeApi shim ─────────────────────────────────────────────
    // The VSCode webview bundle calls acquireVsCodeApi() once on init.
    // postMessage() sends to the Obsidian parent via window.parent.
    // Messages FROM the host arrive as { type: "from-extension", message: X }.
    (function() {
      let __state = {};
      window.acquireVsCodeApi = function() {
        return {
          postMessage: function(msg) { window.parent.postMessage(msg, '*'); },
          getState: function() { return __state; },
          setState: function(state) { __state = state; }
        };
      };
      window.__CLAUDE_CWD__ = ${JSON.stringify(cwd)};
      window.__RESOURCES_URL__ = ${JSON.stringify(resourcesUrl)};

      // Patch History API — the webview tries to replaceState with
      // 'about:srcdoc?session=...' which is rejected in about: documents.
      // We no-op these calls; session state is managed via postMessage instead.
      var _historyNoop = function() {};
      window.history.replaceState = _historyNoop;
      window.history.pushState = _historyNoop;
    })();
  </script>

  <script>${js}</script>
</body>
</html>`;
}

function pathToFileUrl(p: string): string {
  if (process.platform === "win32") {
    return "file:///" + p.replace(/\\/g, "/");
  }
  return "file://" + p;
}
