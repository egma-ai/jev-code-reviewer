# Launch assets

- `docs/demo.mp4`: short recording on the actual public GitHub PR, with the unpacked extension connected to the local report server and logic shown inside GitHub's native file rows.
- `docs/preview.png`: screenshot of the same real PR with its native header, tabs, filenames, and file controls preserved.
- [PR #1](https://github.com/egma-ai/jev-code-reviewer/pull/1): intentionally open, non-deployed example changes.
- `scripts/capture-real-extension.mjs`: repeatable recording, requires local server on port 4731, Chromium/Playwright, and ffmpeg. Reads the local pairing token programmatically without printing it or putting it in the video.

The recording shows real Jev decisions and **prepared explanation text**. Keep that disclosure with this version of the video. Once funded OpenAI API access is available, regenerate `demo/report.json` with `node scripts/record-demo.mjs` and update the recording/provenance documentation accordingly.

## Draft X post

> My coding agent writes code faster than I can review it. I'm trying a different review interface:
>
> Old behavior → new behavior → the decision a human should check.
>
> Jev ranks the changes by attention needed. The Chrome extension replaces only the code table in each GitHub file row with the old and new logic—the rest of GitHub stays GitHub.
>
> Early OSS demo, MIT: https://github.com/egma-ai/jev-code-reviewer

Suggested reply/disclosure:

> This recording replays real Jev classifications. The explanation text is prepared demo copy; the live OpenAI explanation adapter is implemented, with live verification pending API credits. The whole workflow runs from your local checkout—no GitHub App or hosted reviewer backend.

Nothing has been posted to X automatically.
