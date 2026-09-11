#!/usr/bin/env bash
# Publish ALMATY 60 to GitHub and enable GitHub Pages for the static game.
# Prerequisites (one time): GitHub CLI from https://cli.github.com and `gh auth login`.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${1:-almaty60}"
VISIBILITY="${2:-public}"   # GitHub Pages on the free plan needs a public repository.
command -v gh >/dev/null || { echo 'Install GitHub CLI first: https://cli.github.com'; exit 2; }
gh auth status >/dev/null 2>&1 || { echo 'Run: gh auth login'; exit 3; }
OWNER="$(gh api user --jq .login)"
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
  git push -u origin main
else
  gh repo create "$REPO" "--$VISIBILITY" --source . --remote origin --push \
    --description 'ALMATY 60 — city game with 60-second brand missions. Browser 3D playable, secure backend, Unreal slice.'
fi
# Pages served by the Actions workflow (.github/workflows/pages.yml)
gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || \
gh api -X PUT "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || true
gh workflow run pages.yml >/dev/null 2>&1 || true
echo "Repository: https://github.com/$OWNER/$REPO"
echo "Game (after the Pages workflow finishes, ~1 min): https://$OWNER.github.io/$REPO/"
