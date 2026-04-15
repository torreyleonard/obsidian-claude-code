import { existsSync, readdirSync } from "fs";
import { join } from "path";

const VSCODE_EXTENSION_DIRS = [
  join(process.env.HOME ?? "~", ".vscode", "extensions"),
  join(process.env.HOME ?? "~", ".vscode-insiders", "extensions"),
  join(process.env.HOME ?? "~", ".vscode-exploration", "extensions"),
  // Windows
  join(process.env.APPDATA ?? "", "Code", "User", "extensions"),
];

export interface ExtensionInfo {
  dir: string;
  version: string;
  webviewIndex: string;
  webviewCss: string;
  resourcesDir: string;
  /** Path to the native Claude binary bundled inside the extension, if present. */
  nativeBinary: string | null;
}

export class ExtensionFinder {
  private static _cache: ExtensionInfo | null | undefined = undefined;

  static find(): ExtensionInfo | null {
    if (this._cache !== undefined) return this._cache;

    let best: { info: ExtensionInfo; version: number[] } | null = null;

    for (const extensionsDir of VSCODE_EXTENSION_DIRS) {
      if (!existsSync(extensionsDir)) continue;

      let entries: string[];
      try {
        entries = readdirSync(extensionsDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.startsWith("anthropic.claude-code-")) continue;

        const dir = join(extensionsDir, entry);
        const webviewIndex = join(dir, "webview", "index.js");
        const webviewCss = join(dir, "webview", "index.css");

        if (!existsSync(webviewIndex) || !existsSync(webviewCss)) continue;

        // Parse version from directory name: anthropic.claude-code-2.1.109-darwin-arm64
        const versionMatch = entry.match(/claude-code-(\d+\.\d+\.\d+)/);
        if (!versionMatch) continue;

        const resourcesDir = join(dir, "resources");
        // Native binary: resources/native-binary/claude (or .exe on Windows)
        const nativeBinaryCandidates = [
          join(resourcesDir, "native-binary", "claude"),
          join(resourcesDir, "native-binary", "claude.exe"),
        ];
        const nativeBinary = nativeBinaryCandidates.find(existsSync) ?? null;

        const version = versionMatch[1].split(".").map(Number);
        if (!best || this._compareVersions(version, best.version) > 0) {
          best = {
            info: {
              dir,
              version: versionMatch[1],
              webviewIndex,
              webviewCss,
              resourcesDir,
              nativeBinary,
            },
            version,
          };
        }
      }
    }

    this._cache = best?.info ?? null;
    return this._cache;
  }

  static invalidate(): void {
    this._cache = undefined;
  }

  private static _compareVersions(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
}
