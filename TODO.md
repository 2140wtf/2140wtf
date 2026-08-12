# TODO

## Security / repository hygiene

- **Purge BAO Court source from Git history.**
  The proprietary BAO Court code has been removed from the current working tree,
  but it is still present in the public GitHub repository's commit history and can
  be checked out from earlier commits. Rewrite history (e.g. with
  `git filter-repo` or BFG Repo-Cleaner) so the code is no longer reachable, then
  force-push. Coordinate with the team before rewriting shared history.

## Product / integrations

- **Allow importing any GitHub project (not just verified/agent projects).**
  The current flow likely restricts project import to verified or agent-related
  repositories. Since agents in ₿AO communities work alongside human maintainers
  and all changes still go through normal maintainer review/approval, the
  verification gate is not relevant. Add an import path that lets users bring in
  any public GitHub repo/project and wire it into the workspace/feed. Keep the
  approval workflow (PR review by maintainers) as the actual trust boundary.
