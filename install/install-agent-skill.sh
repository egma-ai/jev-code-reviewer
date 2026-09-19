#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'USAGE'
Install the Jev-Reviewer agent skill.

Usage:
  install-agent-skill.sh (--codex | --claude | --all) [--symlink | --copy] [--force]

Targets:
  --codex   Install to ~/.agents/skills/jev-reviewer
  --claude  Install to ~/.claude/skills/jev-reviewer
  --all     Install to both targets

Options:
  --symlink Link to the canonical skill in this checkout (default)
  --copy    Copy the canonical skill into each target
  --force   Back up an existing target before installing
  --help    Show this help

This installer never requests or stores API keys. Run `jev-reviewer setup`
separately; it is the local configuration boundary for live provider keys.
USAGE
}

selected_target=""
install_mode="symlink"
replace_existing="false"

while (($# > 0)); do
  case "$1" in
    --codex|--claude|--all)
      if [[ -n "$selected_target" ]]; then
        printf 'Choose exactly one of --codex, --claude, or --all.\n' >&2
        exit 2
      fi
      selected_target="${1#--}"
      ;;
    --symlink)
      install_mode="symlink"
      ;;
    --copy)
      install_mode="copy"
      ;;
    --force)
      replace_existing="true"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ -z "$selected_target" ]]; then
  usage >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source_skill="$(cd -- "$script_dir/../skill/jev-reviewer" && pwd)"
install_root="${JEV_REVIEWER_INSTALL_ROOT:-${HOME:?HOME is not set}}"

if [[ ! -f "$source_skill/SKILL.md" ]]; then
  printf 'Canonical skill not found at %s\n' "$source_skill" >&2
  exit 1
fi

install_one() {
  local agent_name="$1"
  local skills_dir="$2"
  local destination="$skills_dir/jev-reviewer"

  mkdir -p -- "$skills_dir"

  if [[ -L "$destination" ]] && [[ "$(readlink "$destination")" == "$source_skill" ]] && [[ "$install_mode" == "symlink" ]]; then
    printf '%s skill is already linked at %s\n' "$agent_name" "$destination"
    return
  fi

  if [[ -e "$destination" || -L "$destination" ]]; then
    if [[ "$replace_existing" != "true" ]]; then
      printf '%s already exists. Re-run with --force to back it up first: %s\n' "$agent_name" "$destination" >&2
      return 1
    fi

    local backup_path="${destination}.backup.$(date +%Y%m%d%H%M%S).$$"
    mv -- "$destination" "$backup_path"
    printf 'Backed up existing %s skill to %s\n' "$agent_name" "$backup_path"
  fi

  if [[ "$install_mode" == "copy" ]]; then
    cp -R -- "$source_skill" "$destination"
  else
    ln -s -- "$source_skill" "$destination"
  fi

  printf 'Installed %s skill at %s (%s)\n' "$agent_name" "$destination" "$install_mode"
}

case "$selected_target" in
  codex)
    install_one "Codex" "$install_root/.agents/skills"
    ;;
  claude)
    install_one "Claude Code" "$install_root/.claude/skills"
    ;;
  all)
    install_one "Codex" "$install_root/.agents/skills"
    install_one "Claude Code" "$install_root/.claude/skills"
    ;;
esac

printf '\nSkill installation does not configure credentials.\n'
printf 'For live analysis, run jev-reviewer setup directly in your terminal.\n'
