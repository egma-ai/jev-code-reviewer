# Demo Jev-Reviewer

There are two honest demo modes:

- **Recorded replay** is deterministic, needs no provider keys, and is best for a short launch video. It uses a real public PR with recorded live Jev classifications and prepared explanation copy. It is not live model analysis; [the provenance record](../demo/README.md) explains why the initial explanations are prepared.
- **Live analysis** reads a local checkout and calls TypeSafe Jev plus OpenAI. Use it when demonstrating the complete pipeline and network access is reliable.

## One-time local preparation

Install project dependencies, make the CLI convenient to invoke, and install the unpacked extension:

```bash
npm install
npm link
./install/install-agent-skill.sh --all
```

The extension requires no build. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `extension/` directory. Keep this checkout available when the skill is installed by symlink.

The skill installer does not configure provider credentials. It also does not add a background hook.

## Recommended X demo: recorded replay

Start the replay server:

```bash
jev-reviewer demo
```

Keep that terminal running. For the standalone UI, open the printed local `/demo` URL.

For the GitHub-overlay version of the replay, print the local pairing token in a separate human-controlled terminal:

```bash
jev-reviewer token
```

Open [the demonstration PR's Files changed page](https://github.com/egma-ai/jev-reviewer/pull/1/files), then paste the token into **Display settings** in the extension card. The token is not printed by `jev-reviewer demo`. Confirm the extension shows its **replay** mode badge.

Suggested 35-second capture:

1. Show the ordinary PR diff for two seconds: many files and lines, no obvious review path.
2. Enable Jev-Reviewer and show the summary count: P0, P1, and P2.
3. Open a P0 card. Point to **Old logic**, **New logic**, **What changed**, and **Why human review**.
4. Show P1 and P2 collapsed by default.
5. Reveal the underlying GitHub diff to demonstrate that the prose is a navigation layer, not hidden evidence.
6. Change a display filter or expand a lower-priority group.
7. End on: “AI made code generation cheap. Jev-Reviewer routes scarce human attention.”

Use this spoken disclosure near the beginning or in the post text:

> This replay uses recorded live Jev classifications and prepared explanation copy for a real public PR. No model calls happen during playback.

Do not describe replay mode as a live Jev or OpenAI request, or the prepared explanations as OpenAI output.

## Live analysis demo

Before recording, choose a public PR and check out its repository locally. Confirm `gh` can read the PR, then configure both providers from your own terminal:

```bash
gh auth status
jev-reviewer setup
```

The setup prompt hides input and stores credentials outside the repository. Never paste either key into an agent chat, command argument, GitHub issue, or screen recording.

Run analysis with an absolute repository path:

```bash
jev-reviewer analyze \
  --pr https://github.com/OWNER/REPOSITORY/pull/NUMBER \
  --repo /absolute/path/to/local/checkout
```

Graphify enrichment is attempted by default and falls back cleanly when the optional CLI is unavailable. Use `--no-graphify` to skip it; `--graphify` is a redundant explicit enable. To demonstrate repository-specific policy, add `--policy /absolute/path/to/policy.json`.

After analysis completes, serve the cached report:

```bash
jev-reviewer serve --port 4731
```

In a separate human-controlled terminal, print the pairing token, open **Display settings** in the extension card, and paste it there:

```bash
jev-reviewer token
```

Do not ask a coding agent to print the token. Open the exact PR's **Files changed** page and confirm the report corresponds to the analyzed commit before recording.

## Agent-driven PR flow

After the portable skill is installed, ask the coding agent to implement a change and create or update a PR. While the agent is active, the skill instructs it to run this as the final post-PR step:

```bash
jev-reviewer analyze --pr <github-pr-url> --repo <absolute-local-path>
```

This is best effort, not a guaranteed hook. If someone updates the PR outside that agent session, rerun analysis explicitly.

## Before publishing

- Ensure no provider key, credentials file, pairing token, private source, or unrelated browser tab is visible.
- Keep the replay badge visible when using recorded data.
- Verify the PR URL and code are public if they appear in the video.
- Confirm the underlying diff can still be opened from a review card.
- Avoid claiming Jev-Reviewer proves correctness; it prioritizes human attention.
