#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${HOME}/ragenayr-pi"
PI_DIR="${HOME}/.pi/agent"

cd "$REPO_DIR"
git pull --rebase

mkdir -p extensions prompts skills themes

[ -d "$PI_DIR/extensions" ] && rsync -a --delete "$PI_DIR/extensions/" "$REPO_DIR/extensions/"
[ -d "$PI_DIR/prompts" ] && rsync -a --delete "$PI_DIR/prompts/" "$REPO_DIR/prompts/"
[ -d "$PI_DIR/skills" ] && rsync -a --delete "$PI_DIR/skills/" "$REPO_DIR/skills/"
[ -d "$PI_DIR/themes" ] && rsync -a --delete "$PI_DIR/themes/" "$REPO_DIR/themes/"

if [ -n "$(git status --porcelain)" ]; then
  git add .
  git commit -m "pisync $(hostname) $(date +%F-%T)"
  git push
else
  echo "No repo changes to commit"
fi

pi update --extensions

echo "Done: repo synced and pi extensions updated."
