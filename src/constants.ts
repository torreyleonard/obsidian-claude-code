export const VIEW_TYPE_CLAUDE_CODE = "claude-code-view";
export const PLUGIN_DISPLAY_NAME = "Claude Code";

export const PERMISSION_MODES = [
  { id: "default", label: "Default", icon: "shield", description: "Claude asks before taking actions" },
  { id: "acceptEdits", label: "Auto-edit", icon: "pencil", description: "Auto-accept file edits, ask for other actions" },
  { id: "plan", label: "Plan", icon: "list-checks", description: "Describe changes without executing" },
  { id: "bypassPermissions", label: "Auto", icon: "zap", description: "Run without asking for permissions" },
] as const;

export type PermissionModeId = typeof PERMISSION_MODES[number]["id"];

