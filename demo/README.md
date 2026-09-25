# Demo provenance

The replay uses the public [demonstration PR #1](https://github.com/egma-ai/jev-code-reviewer/pull/1) in this repository. It changes only a tiny, non-deployed example app.

`report.json` records the exact base/head commits, generation time, classifier model, distributions, context limits, and explanation provenance. **Every classification comes from a real TypeSafe Jev API call**, with any application-policy override recorded separately.

The initial recording uses **prepared explanation copy** from `prepared-explanations.json`. These are not OpenAI API outputs: the configured OpenAI project returned `credit_balance_exhausted`. Both the browser demo and report disclose this. Live OpenAI explanations have since run on real PRs with a funded key; this bundled recording still uses the prepared copy.

To regenerate with both live providers, configure funded keys and run:

```sh
node scripts/record-demo.mjs --pr https://github.com/egma-ai/jev-code-reviewer/pull/1
```

To explicitly use prepared prose with fresh **live Jev** classifications:

```sh
node scripts/record-demo.mjs --pr https://github.com/egma-ai/jev-code-reviewer/pull/1 --prepared
```

These commands replace the bundled public demo report. They refuse PRs outside this repository or changes outside `examples/demo-app/`. The normal `analyze` command never substitutes prepared prose or fixture classifications.
