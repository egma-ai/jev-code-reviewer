# Launch assets

- `docs/demo.mp4`: 25-second recording on the actual public GitHub PR, with the unpacked extension connected to the local report server.
- `docs/preview.png`: screenshot of the same real PR and report.
- [PR #1](https://github.com/egma-ai/jev-reviewer/pull/1): intentionally open, non-deployed example changes.
- `scripts/capture-real-extension.mjs`: repeatable recording, requires local server on port 4731, Chromium/Playwright, and ffmpeg. Reads the local pairing token programmatically without printing it or putting it in the video.

The recording shows real Jev decisions and **prepared explanation text**. Keep that disclosure with this version of the video. Once funded OpenAI API access is available, regenerate `demo/report.json` with `node scripts/record-demo.mjs` and update the recording/provenance documentation accordingly.

## Draft X post

> My coding agent writes code faster than I can review it. I'm trying a different review interface:
>
> Old behavior → new behavior → the decision a human should check.
>
> Jev ranks the changes by attention needed. The Chrome extension puts those cards directly in GitHub.
>
> Early OSS demo, MIT: https://github.com/egma-ai/jev-reviewer

Suggested reply/disclosure:

> This recording replays real Jev classifications. The explanation text is prepared demo copy; the live OpenAI explanation adapter is implemented, with live verification pending API credits. The whole workflow runs from your local checkout—no GitHub App or hosted reviewer backend.

Nothing has been posted to X automatically.
