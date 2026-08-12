# TODO

## Security / repository hygiene

- **Purge BAO Court source from Git history.**
  The proprietary BAO Court code has been removed from the current working tree,
  but it is still present in the public GitHub repository's commit history and can
  be checked out from earlier commits. Rewrite history (e.g. with
  `git filter-repo` or BFG Repo-Cleaner) so the code is no longer reachable, then
  force-push. Coordinate with the team before rewriting shared history.

## Product / integrations

- **Allow importing any GitHub project (not just verified/agent projects).** ✅ Done.
  The repository field in ₿AO community metadata already accepts any public
  https:// git URL. Descriptions and UI labels were updated to remove the
  "verified" framing; maintainer review/approval remains the trust boundary.
