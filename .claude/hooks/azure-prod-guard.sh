#!/usr/bin/env bash
# PreToolUse hook for Azure prod mutations.
#
# Receives JSON on stdin: {"tool_name":"Bash","tool_input":{"command":"...","description":"..."}, ...}
# Exit 0 => allow. Exit 2 => block with stderr shown to the model.
#
# Strategy:
# - Only inspect Bash invocations.
# - Block obviously destructive operations on shared cloud resources.
# - Anything else: pass through (the permissions block in settings.json handles "ask"/"allow").

set -u

input=$(cat)

# Pull out the command string. jq is optional; fall back to grep.
if command -v jq >/dev/null 2>&1; then
  tool=$(jq -r '.tool_name // ""' <<<"$input")
  cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
else
  tool=$(printf '%s' "$input" | sed -nE 's/.*"tool_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -1)
  cmd=$(printf '%s' "$input" | sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"((\\.|[^"\\])*)".*/\1/p' | head -1)
fi

[ "$tool" = "Bash" ] || exit 0
[ -n "$cmd" ] || exit 0

block() {
  printf 'azure-prod-guard: blocked — %s\n' "$1" >&2
  printf '   command: %s\n' "$cmd" >&2
  printf '   To proceed, ask the user to run it manually, or update .claude/settings.json.\n' >&2
  exit 2
}

# Hard-deny patterns regardless of permissions
case "$cmd" in
  *"az group delete"*) block "deleting the resource group is not allowed" ;;
  *"az containerapp env delete"*) block "deleting the Container Apps environment is not allowed" ;;
  *"az acr delete"*) block "deleting the registry is not allowed" ;;
  *"git push"*"--force"*) block "force push is not allowed" ;;
  *"git push -f"*) block "force push is not allowed" ;;
esac

exit 0
