# Contributing to 2140.wtf

We welcome contributions, but we have high standards. 2140.wtf is a carefully designed product with a specific vision, and every pull request must meet that bar. This guide exists to help you succeed.

**Required reading before you start:**

- **2140.wtf Philosophy** (summarized below under "Understanding 2140.wtf") -- the product vision. Your change must align with it.
- `AGENTS.md` in this repo -- the codebase conventions. Your AI tool should load this file.

## Understanding 2140.wtf

2140.wtf is a carnival, not a platform. Before contributing, you need to understand what that means.

### The product decision filter

Every change to 2140.wtf should pass this test:

> *Does this make 2140.wtf more magnetic, more threatening to the status quo, and more peaceful to inhabit?*

- **Magnetic** -- 2140.wtf attracts through experience, not ideology. People don't need to understand Nostr to love it. They need to feel something they haven't felt online since the early web. Features should be odd, intriguing, and captivating -- not generic social media clones.
- **Threatening to the status quo** -- 2140.wtf threatens mainstream platforms when someone opens it and thinks: *"Why can't my platform do this?"* Theming, games, treasure hunts, interoperable micro-apps -- these are things walled gardens can't replicate.
- **Peaceful to inhabit** -- 2140.wtf displaces argument with creation, conformity with expression, and consumption with participation. No ads, no engagement-optimized algorithms, no outrage incentives.

If a change does all three, it belongs. If it only does one, think harder. If it does none, it doesn't belong here.

### What 2140.wtf is NOT

- A Twitter/X clone with decentralization bolted on
- A place to replicate features that mainstream platforms already do well
- A showcase for generic UI components or boilerplate social features

### What 2140.wtf IS

- A convergence point for interoperable Nostr experiences (games, treasure hunts, themes, color moments, live streams, and things nobody has imagined yet)
- A place where profiles feel like worlds, not business cards
- The most fun you've had on the internet in years

The philosophy summary above is the complete vision.

## What we accept

### Bug fixes

One bug, one pull request. Fix exactly one thing. Don't bundle unrelated changes, don't sneak in refactors, don't "clean up while you're in there." Small, focused PRs get reviewed fast. Large ones sit.

When the bug was introduced by an identifiable prior commit, add a `Regression-of: <short-sha>` trailer to the bottom of your commit message. See AGENTS.md "Attributing Regressions" for the convention.

### New features and significant changes

Every feature PR must link to an existing open issue and clearly align with the **2140.wtf Philosophy**. The philosophy alignment section in the PR template is where you make the case for why your change belongs in 2140.wtf. If you can't articulate that clearly, the change probably doesn't belong.

If you have an idea for a feature that doesn't have an issue yet:

1. Build it as a standalone Nostr app first .
2. Prove it works and get user feedback.
3. Open an issue to discuss integration.

**Feature PRs that don't link to an issue or don't align with the 2140.wtf Philosophy will be closed.** Our open issues are our internal roadmap -- some require deep product context. If your implementation doesn't match the product vision, it will be closed regardless of code quality.

## Required tools

- **Claude Opus 4.6** (or the latest frontier model) -- not Sonnet, not GPT-4o, not local models. Quality depends on model quality.
- **An AI coding agent with plan/research mode** -- [OpenCode](https://opencode.ai), [Shakespeare](https://shakespeare.diy), Cursor, or similar.
- **Node.js 22+** and npm 10.9.4+.

## The contribution workflow

Follow these steps in order. Skipping steps is the most common reason PRs are rejected.

### 1. Ask: does anyone need this?

Before writing a single line of code, answer this honestly. For bug fixes this is straightforward -- someone hit the bug. For features, it requires more thought. Is there evidence of real user demand? Is the underlying technology mature enough? A beautifully written feature for a nonexistent user base is the wrong thing to build. If you can't point to a concrete user need, reconsider.

### 2. Understand the issue

Read the issue thoroughly. If anything is unclear, ask in the issue comments before writing code. Understand not just *what* to change, but *why* -- what problem does this solve for users?

### 3. Read the codebase conventions

Read `AGENTS.md` in the repo root. This is the single source of truth for how code should be written in this project. Your AI tool should load this file automatically. If it doesn't, paste it in or configure your tool to read it.

### 4. Read the philosophy

Read the **2140.wtf Philosophy**. 2140.wtf is a carnival, not a platform. Your change should feel like it belongs in 2140.wtf -- not like it was transplanted from a generic social media template. Apply the product decision filter above.

### 5. Plan before you code

Start your AI tool in **plan mode** (or research/think mode). Spend the first few prompts:

- Exploring the existing codebase to understand how similar features are implemented
- Reading the files you'll need to modify
- Proposing an approach

Do not write code until you have a plan. The most expensive mistake is implementing the wrong approach.

### 6. Implement

Switch to code mode and implement your plan. Use Opus 4.6 or equivalent.

### 7. Run the test suite

```sh
npm run test
```

This runs type-checking, linting, unit tests, and a production build. All must pass. Do not submit an PR with a failing test suite.

### 8. Self-review

Run this prompt against your diff (copy the full `git diff` output and paste it to your AI tool along with this prompt):

```
Review this diff as if you are a senior maintainer of this codebase who has to
maintain it long-term. For each finding, state the file, line, and issue.

- [ ] Does the diff contain changes that weren't requested? Flag anything out of scope.
- [ ] Is there dead code, commented-out blocks, or debug artifacts left in?
- [ ] Are there placeholder comments like "// In a real app..." or "// TODO: implement"?
- [ ] For every value displayed to a user, can you trace it from source to render without a gap?
- [ ] Are error, loading, and empty states all handled -- and in the right order?
- [ ] Does a mutation reflect in the UI without requiring a manual refresh?
- [ ] Is there a new read/write path that assumes fresh data but could get a stale cache?
- [ ] For replaceable/addressable Nostr events: is fetchFreshEvent used before mutation?
- [ ] Does anything new block the critical render path or fire N+1 network requests?
- [ ] Are Nostr queries efficient (combined kinds, relay-level filtering vs client-side)?
- [ ] Are user inputs used in queries or rendered as content without sanitization?
- [ ] Were existing patterns/conventions in AGENTS.md ignored in favor of something novel?
- [ ] Are secrets, keys, or env-specific values hardcoded?
- [ ] Does the code use the `any` type anywhere?
- [ ] Is the code Capacitor-compatible (no `<a download>`, no `window.open()`)?
- [ ] Are new Nostr event kinds documented in NIP.md with links to relevant specs?
- [ ] Are there any new images >100KB or other large binary assets that should be hosted externally?
- [ ] Is there any use of dangerouslySetInnerHTML, eval, innerHTML, or SVG string interpolation?
- [ ] Is any data from a Nostr event (tags, content, pubkey, URLs) used in a security-sensitive context (href, src, query filter, trust decision) without validation?
- [ ] If this is a bug fix and the offending commit is identifiable, does the commit message include a `Regression-of: <short-sha>` trailer? (See AGENTS.md "Attributing Regressions".)

Skip anything a linter or type checker would catch. Focus on logic, data flow, and intent.

Then answer: "If you were the people who have to maintain this codebase and deal
with all long-term issues, what would be your biggest concerns about this
implementation?"
```

Address every finding before submitting.

### 9. Deploy a live preview

Deploy your branch so reviewers can test it without pulling your code:

```sh
npm run build
npx surge dist your-branch-name.surge.sh
```

Or use Netlify, Vercel, or any static hosting. Include the live preview URL in your PR description.

### 10. Take screenshots

Capture before and after screenshots of any UI changes. Include them directly in the PR description. If your change has no visual component, state that explicitly.

### 11. Submit

Fill out every field in the PR template. Incomplete PRs will not be reviewed.

## What gets your PR closed without review

- No linked issue
- Feature PRs with no clear alignment with the **2140.wtf Philosophy**
- Features that fail the product decision filter (not magnetic, not threatening to the status quo, not peaceful)
- Incomplete PR template (missing checklist, screenshots, or preview URL)
- Changes that go beyond what was asked for (scope creep)
- Placeholder code, dead code, or debug artifacts
- Evidence of low-quality AI generation ("In a real application..." comments, hallucinated APIs, generic template code)
- Failing test suite
- No evidence of planning (code-first, think-later approach produces recognizable patterns)
- Undocumented Nostr event kinds (new kinds must be in NIP.md)
- Large binary assets committed to git (images >100KB, fonts, videos)
- Security issues (dangerouslySetInnerHTML, eval, innerHTML, unsanitized user input)

## PR review process

1. GitHub Actions runs the full test suite on your PR. If it fails, read the logs and fix the failure.
2. Maintainers will review your PR when all CI checks pass and the template is complete.
3. If changes are requested, address them promptly. Stale PRs will be closed.

We appreciate your interest in contributing. These standards exist because reviewing a low-quality PR takes 3x longer than doing the work ourselves. Help us help you by following the process.
