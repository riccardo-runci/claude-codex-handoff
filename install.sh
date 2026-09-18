#!/usr/bin/env bash
set -euo pipefail

repo_url="https://github.com/riccardo-runci/claude-codex-handoff.git"
install_dir="$HOME/.claude-handoff"

if [ -d "$install_dir/.git" ]; then
    echo "claude-handoff: aggiorno installazione esistente in $install_dir"
    git -C "$install_dir" pull --ff-only
else
    echo "claude-handoff: clono in $install_dir"
    git clone "$repo_url" "$install_dir"
fi

(cd "$install_dir" && npm link)

echo ""
echo "Fatto. Prova: claude-handoff --help"
