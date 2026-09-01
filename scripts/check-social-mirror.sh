#!/usr/bin/env bash
# Check the private 2140.social mirror (git@github.com:2140wtf/2140-social.git)
# for updates that are not yet in this repo, focused on the baosocial /
# chat / room code.
#
# The room-privacy / public-ghost update is expected to arrive via a future
# sync of this mirror. Run this script after anyone says "the mirror synced",
# or proactively before porting chat changes.
#
# Note: repo history may be shallow, so "new commits" detection falls back
# to a tree diff when no common ancestor is available.
#
# Usage: scripts/check-social-mirror.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

REMOTE="social"
URL="git@github.com:2140wtf/2140-social.git"

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo ">> adding remote $REMOTE -> $URL"
  git remote add "$REMOTE" "$URL"
fi

echo ">> fetching $REMOTE ..."
git fetch "$REMOTE" --prune >/dev/null 2>&1

HEAD_SHA=$(git rev-parse "$REMOTE/main")
MB=$(git merge-base main "$REMOTE/main" 2>/dev/null || true)

echo
echo "social/main @ ${HEAD_SHA:0:10} ($(git log -1 --format=%cs "$REMOTE/main"))"
if [ -z "$MB" ]; then
  echo "merge-base: (none — shallow history; using tree diff)"
else
  echo "merge-base with our main: ${MB:0:10}"
fi
echo

if [ -n "$MB" ] && [ "$MB" = "$HEAD_SHA" ]; then
  echo "✅ Mirror is fully contained in our main — no new commits."
else
  if [ -n "$MB" ]; then
    echo "== NEW commits on the mirror (not yet in our main) =="
    git log --oneline --no-decorate "$MB..$REMOTE/main" | head -30
    echo
  else
    echo "== recent mirror commits (history is shallow; showing last 15) =="
    git log --oneline --no-decorate "$REMOTE/main" -15
    echo
  fi
fi

echo "== baosocial/ delta: ours (main) vs mirror (social/main) =="
STAT=$(git diff --stat main "$REMOTE/main" -- src/lib/baosocial | tail -1)
if [ -z "$STAT" ]; then
  echo "  none — vendored protocol is identical to the mirror."
else
  echo "  $STAT"
  echo
  echo "  changed files:"
  git diff --name-only main "$REMOTE/main" -- src/lib/baosocial | sed 's/^/    /'
fi

echo
echo "== chat/room-relevant files changed anywhere in the mirror =="
git diff --name-only main "$REMOTE/main" | grep -iE "baosocial|room|chat|scroll|community|BaoCommunit" | head -20 | sed 's/^/  /' || echo "  none"