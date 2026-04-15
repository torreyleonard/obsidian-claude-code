import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Common locations where the `claude` binary might live. */
const COMMON_PATHS: string[] = [
  // npm global installs
  "/usr/local/bin/claude",
  "/usr/bin/claude",
  // macOS Homebrew
  "/opt/homebrew/bin/claude",
  // Linux local bin
  `${process.env.HOME}/.local/bin/claude`,
  // Volta
  `${process.env.HOME}/.volta/bin/claude`,
  // asdf
  `${process.env.HOME}/.asdf/shims/claude`,
  // nvm (current)
  ...(process.env.NVM_BIN ? [`${process.env.NVM_BIN}/claude`] : []),
  // Bun
  `${process.env.HOME}/.bun/bin/claude`,
  // Claude's own install locations
  `${process.env.HOME}/.claude/local/claude`,
  `${process.env.HOME}/.claude/bin/claude`,
];

export class ClaudePathFinder {
  private static _cached: string | null | undefined = undefined;

  /**
   * Returns the resolved path to the `claude` binary, or null if not found.
   * Checks in order: explicit override → PATH → common locations.
   */
  static async find(override?: string): Promise<string | null> {
    if (override && override.trim()) {
      return existsSync(override.trim()) ? override.trim() : null;
    }

    if (this._cached !== undefined) return this._cached;

    // Try PATH first
    try {
      const { stdout } = await execFileAsync("which", ["claude"]);
      const p = stdout.trim();
      if (p && existsSync(p)) {
        this._cached = p;
        return p;
      }
    } catch {
      // which not available or claude not on PATH
    }

    // Windows: try `where`
    if (process.platform === "win32") {
      try {
        const { stdout } = await execFileAsync("where", ["claude"]);
        const p = stdout.split("\n")[0].trim();
        if (p && existsSync(p)) {
          this._cached = p;
          return p;
        }
      } catch {}
    }

    // Walk common locations
    for (const p of COMMON_PATHS) {
      if (p && existsSync(p)) {
        this._cached = p;
        return p;
      }
    }

    // Windows npm global
    if (process.platform === "win32") {
      const appData = process.env.APPDATA ?? "";
      const candidates = [
        join(appData, "npm", "claude.cmd"),
        join(appData, "npm", "claude"),
        join(process.env.PROGRAMFILES ?? "", "nodejs", "claude.cmd"),
      ];
      for (const p of candidates) {
        if (existsSync(p)) {
          this._cached = p;
          return p;
        }
      }
    }

    this._cached = null;
    return null;
  }

  /** Invalidate the cache (call after settings change). */
  static invalidate(): void {
    this._cached = undefined;
  }
}
