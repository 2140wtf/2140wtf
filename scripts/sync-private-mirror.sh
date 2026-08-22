#!/usr/bin/env bash
# Sync a complete copy of the public 2140wtf/2140wtf repo into the private
# backup 2140wtf/2140wtf_private (all branches + tags, force-updated).
#
# One-time setup (browser): create EMPTY private repo 2140wtf/2140wtf_private.
# Then run this script any time — it mirrors origin exactly.
set -euo pipefail

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo ">> mirroring origin (public) …"
git clone --mirror github-2140:2140wtf/2140wtf.git "$TMP/mirror.git"
cd "$TMP/mirror.git"

echo ">> pushing full copy to private backup …"
git push --mirror github-2140:2140wtf/2140wtf_private.git

echo ">> done. private = exact copy of public (branches + tags)."
