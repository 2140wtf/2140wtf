# TODO

> **Signing policy for this repository**
>
> Work on `2140wtf/2140wtf` should be signed with the **2140 signing keys** by
> default. The `baocommunity` keys are reserved for the ₿AO Community tech stack
> and should only be used here when imported from the upstream `baocommunity`
> repositories or when the user explicitly requests it and gives permission.
> If you are unsure which key to use, ask the user — never sign 2140 commits with
> baocommunity keys without explicit approval.

## Licensing / attribution

- **Secure the `baocommunity.dev` domain and verify it on GitHub.**
  The unsigned `baocommunity` commits in `2140wtf/2140wtf` use the author email
  `dev@baocommunity.dev`. Once the domain is owned, add and verify
  `dev@baocommunity.dev` on the `baocommunity` GitHub account. GitHub will
  then show the existing commits as Verified; no history rewrite or public
  comments are needed. Do not reveal the intent publicly until the domain is
  secured, to prevent squatting.

## Product / integrations

- **Allow importing any GitHub project (not just verified/agent projects).** ✅ Done.
  The project command, MCP tool, and UI labels were updated to accept any public
  `https://` git URL; maintainer review remains the trust boundary.
