---
name: jev-reviewer
description: Analyze and refresh Jev-Reviewer results when creating, updating, pushing to, or inspecting a GitHub pull request. Use after an agent changes a PR and for historical-PR demos; this skill invokes the local CLI and is not a guaranteed background hook.
---

# Jev Reviewer

Use the local `jev-reviewer` CLI to turn a pull request into prioritized, natural-language review cards for the locally installed browser extension.

## Creating or updating a pull request

Complete the requested implementation, run the repository's normal verification, push the intended commits, and create or update the pull request first. Then, as the final post-PR step, run:

```bash
jev-reviewer analyze --pr <github-pr-url> --repo <local-repository-path>
```

Use the full GitHub PR URL returned by the PR workflow and the repository's absolute local path. If the PR identity is unclear, resolve it with the repository's existing GitHub tooling instead of guessing.

This is a best-effort agent workflow, not an event listener. Do not claim the skill will run after the agent exits or when another actor pushes commits.

Do not create, push, or modify a PR solely to make analysis possible unless the user requested that action. If no PR exists or the latest commits are not pushed, state that analysis is deferred and provide the exact command to run later.

## Live analysis

Live analysis requires locally configured `TYPESAFE_API_KEY` for Jev classification and `OPENAI_API_KEY` for natural-language explanations. If setup is incomplete, ask the user to run this directly in their terminal:

```bash
jev-reviewer setup
```

Never ask the user to paste a key into chat, add it to this skill, commit it, print it, or inspect its value. Skill installation and credential setup are separate.

The CLI attempts local Graphify enrichment by default and falls back to source-only context when Graphify is unavailable. `--no-graphify` disables that attempt; `--graphify` is an optional explicit enable. Do not present Graphify installation as required.

## Recorded demo

To replay the bundled, precomputed demonstration without provider keys, run:

```bash
jev-reviewer demo
```

Describe this accurately as a recorded report replay, not live model analysis. The bundled report contains real recorded Jev classifications and prepared explanation copy; see `demo/README.md` for provenance. Follow the command's output to open the standalone replay or matching PR page.

## Browser bridge

For a previously analyzed PR, start or confirm the local bridge:

```bash
jev-reviewer serve --port 4731
```

The human can run `jev-reviewer token` to obtain the local browser-extension pairing token. Never run that command in an agent transcript: the token is for the human to copy into the locally loaded extension.

## Results and policy

- Treat the cards as supplemental review guidance, not proof that a PR is safe.
- Report analysis failures and stale results clearly. Never silently reuse results from a different commit.
- Preserve existing tests, approval rules, and human-review requirements.
- Use P0 as the highest priority. Read [references/priority-policy.md](references/priority-policy.md) only when interpreting or changing priority policy.
- Configure priorities in `config/policy.json`, a repository `.jev-reviewer.json`, or a file passed with `--policy`; do not edit this skill to change review policy.
- Do not start a persistent server unless the user is preparing to use the browser extension or explicitly asks for it.

If `jev-reviewer` is unavailable, report the missing prerequisite instead of inventing an installation command.
