import type { PermissionModeId } from "./constants";
export type { PermissionModeId };

// ─── Plugin settings ─────────────────────────────────────────────────────────

export interface ClaudeCodeSettings {
  /** Override the detected claude binary path */
  claudeBinaryPath: string;
  /** Default permission mode */
  permissionMode: PermissionModeId;
  /** Working directory override (empty = use vault path) */
  workingDirectory: string;
  /** Default model (empty = SDK default) */
  model: string;
  /** Show thinking blocks */
  showThinking: boolean;
  /** Effort level */
  effort: "low" | "medium" | "high" | "max" | "";
}

export const DEFAULT_SETTINGS: ClaudeCodeSettings = {
  claudeBinaryPath: "",
  permissionMode: "default",
  workingDirectory: "",
  model: "",
  showThinking: true,
  effort: "",
};
