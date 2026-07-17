#!/usr/bin/env bash
# agon-init — Generate an AGENTS.md file with an interactive wizard
# Usage: agon-init [--global|--project]
#   --global   → ~/.agon/AGENTS.md (personal config, applies everywhere)
#   --project  → ./AGENTS.md (project-specific, overrides global)
#   (default)  → auto-detect based on current directory

set -euo pipefail

# ── Colors ──
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
RESET='\033[0m'

info()  { echo -e "${CYAN}→${RESET} $*"; }
ok()    { echo -e "${GREEN}✓${RESET} $*"; }
dim()   { echo -e "${DIM}$*${RESET}"; }

# ── Determine target ──
MODE="${1:-}"
if [[ "$MODE" == "--global" ]]; then
  TARGET="$HOME/.agon/AGENTS.md"
  KIND="global"
elif [[ "$MODE" == "--project" ]]; then
  TARGET="$(pwd)/AGENTS.md"
  KIND="project"
elif [[ -d ".git" || -f "package.json" || -f "Cargo.toml" ]]; then
  TARGET="$(pwd)/AGENTS.md"
  KIND="project"
else
  TARGET="$HOME/.agon/AGENTS.md"
  KIND="global"
fi

mkdir -p "$(dirname "$TARGET")"

echo ""
echo -e "${BOLD}AGENTS.md Generator (${KIND})${RESET}"
echo -e "${DIM}Target: ${TARGET}${RESET}"
echo ""

# ── Check existing ──
if [[ -f "$TARGET" ]]; then
  echo -e "${YELLOW}⚠${RESET} ${TARGET} already exists."
  read -rp "Overwrite? [y/N] " OVERWRITE
  [[ "${OVERWRITE,,}" != "y" ]] && { echo "Aborted."; exit 0; }
fi

# ── Helpers ──
ask() {
  local prompt="$1" default="${2:-}"
  if [[ -n "$default" ]]; then
    read -rp "$(echo -e "${CYAN}?${RESET} ${prompt} [${default}]: ")" answer
    echo "${answer:-$default}"
  else
    read -rp "$(echo -e "${CYAN}?${RESET} ${prompt}: ")" answer
    echo "$answer"
  fi
}

ask_yn() {
  local prompt="$1" default="${2:-n}"
  read -rp "$(echo -e "${CYAN}?${RESET} ${prompt} [${default^^}]: ")" answer
  local val="${answer:-$default}"
  [[ "${val,,}" == "y" || "${val,,}" == "yes" ]]
}

# ── User ──
NAME=$(ask "Your name" "$(whoami)")
LANGUAGE=$(ask "Preferred language" "adapts to input")
SHELL_NAME=$(ask "Shell" "zsh")
NOTIFICATIONS=$(ask_yn "Use macOS notifications (osascript)?" "n")

# ── Style ──
echo ""
dim "── Style ──"
DIRECT=$(ask_yn "Direct, concise style?" "y")
CESAR_VOICE=$(ask_yn "Cesar voice (taste, dry, honest)?" "y")

# ── Orchestration ──
echo ""
dim "── Orchestration ──"
SOLO_BIAS=$(ask_yn "Default to solo (no team)?" "y")
FORGE_USE=$(ask_yn "Use Forge for complex implementations?" "y")
TRIBUNAL_USE=$(ask_yn "Use Tribunal for tradeoffs/breaking changes?" "y")
BRAINSTORM_USE=$(ask_yn "Use Brainstorm when stuck on direction?" "n")
CAMPFIRE_USE=$(ask_yn "Use Campfire for fuzzy exploration?" "n")

# ── Confidence ──
echo ""
dim "── Confidence Thresholds ──"
HIGH_THRESHOLD=$(ask "Just do it threshold %" "96")
MID_THRESHOLD=$(ask "Quick self-check threshold %" "80")
dim "  Below ${MID_THRESHOLD}%: investigate first"

# ── Project-specific ──
PROJECT_DESC=""
TOOLS=""
if [[ "$KIND" == "project" ]]; then
  echo ""
  dim "── Project ──"
  PROJECT_DESC=$(ask "Short project description" "")
  TOOLS=$(ask "Key tools/frameworks (comma-separated)" "")
fi

# ── Generate ──
echo ""
info "Generating ${TARGET}..."

{
  if [[ "$KIND" == "global" ]]; then
    cat <<HEADER
# AGENTS.md — Personal (global)

Applies to every workspace. Project-specific overrides go in \`PROJECT_ROOT/AGENTS.md\`.

## User

- Name: ${NAME}
- Language: ${LANGUAGE}
- Shell: ${SHELL_NAME}
HEADER
    [[ "$NOTIFICATIONS" == true ]] && echo "- Notifications: \`done\` function in .zshrc (\`osascript\` macOS notifications)"
  else
    cat <<HEADER
# AGENTS.md — $(basename "$(pwd)")

${PROJECT_DESC:+${PROJECT_DESC}}

Engine/model settings: \`agon config\` (~/.agon/config.json)
HEADER
  fi

  echo ""
  echo "## Orchestration Defaults"
  echo ""
  if [[ "$SOLO_BIAS" == true ]]; then
    echo "- **Default: self.** Investigate first, escalate only when genuinely uncertain."
    echo "- **Solo bias.** Team only for multi-file refactors or architecture decisions."
  fi
  [[ "$FORGE_USE" == true ]] && echo "- **Forge** → complex implementations, quality matters."
  [[ "$TRIBUNAL_USE" == true ]] && echo "- **Tribunal** → tradeoffs, breaking changes, controversial choices."
  [[ "$BRAINSTORM_USE" == true ]] && echo "- **Brainstorm** → when genuinely stuck on direction."
  [[ "$CAMPFIRE_USE" == true ]] && echo "- **Campfire** → fuzzy exploration, ambiguous requirements."

  echo ""
  echo "## Confidence Thresholds"
  echo ""
  echo "- ${HIGH_THRESHOLD}%+ → just do it"
  echo "- ${MID_THRESHOLD}-${HIGH_THRESHOLD}% → quick self-check, then proceed"
  echo "- <${MID_THRESHOLD}% → investigate first (read 3 files before dispatching 3 engines)"

  echo ""
  echo "## Style"
  echo ""
  if [[ "$DIRECT" == true ]]; then
    echo "- Direct. No hedging, no fortune-cookie wisdom."
    echo "- Show work briefly — say why, what you found. No play-by-play."
  fi
  if [[ "$CESAR_VOICE" == true ]]; then
    echo "- Cesar voice: taste over opinions, honest uncertainty, occasionally dry."
  fi

  if [[ "$KIND" == "project" && -n "$TOOLS" ]]; then
    echo ""
    echo "## Tools & Frameworks"
    echo ""
    echo "- ${TOOLS}"
  fi

  echo ""

} > "$TARGET"

ok "Written to ${TARGET}"
echo ""
dim "Preview:"
echo ""
cat "$TARGET"
echo ""
ok "Done. Edit anytime — Agon picks it up on next session."
