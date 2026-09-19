# Jev-Reviewer Chrome extension

This Manifest V3 extension overlays GitHub pull-request **Files changed** pages with the natural-language review report produced by the local Jev-Reviewer service. It has no build step and does not read local files.

## Load it unpacked

1. Start the local service with `jev-reviewer serve` (it listens on `127.0.0.1:4731`).
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this `extension` directory.
6. Open a URL shaped like `https://github.com/OWNER/REPO/pull/123/files`.

The first report can be paired by running `jev-reviewer token` in a human-controlled terminal, opening **Display settings**, pasting that token, and selecting **Save**. The token is kept in Chrome extension local storage and is sent only to `http://127.0.0.1:4731` as a bearer token. Do not ask a coding agent to print this token into its transcript.

## Behavior

- P0 review cards are expanded by default; P1 and P2 are collapsed.
- The raw GitHub diff is hidden after a report loads and remains available through **View code diff**.
- If the service is unavailable or rejects the pairing token, the native GitHub diff stays visible.
- Priority visibility and expansion defaults are configurable and persist locally.
- The analyzed head SHA is shown as current, stale, or unverified when GitHub does not expose its head SHA in the page metadata.
- Provider provenance and analysis coverage are shown above the cards. Recorded Jev decisions with prepared demo copy are explicitly labeled and never presented as live OpenAI output.
- Graphify/context limitations and policy overrides are surfaced as review notes instead of being hidden in report metadata.
- Model output is inserted with DOM `textContent`; the extension never injects report HTML.

## API contract

The service worker calls:

```text
GET http://127.0.0.1:4731/api/reviews/{owner}/{repo}/{pullRequest}
Authorization: Bearer {pairingToken}
Accept: application/json
```

Expected report shape:

```json
{
  "repository": "owner/repo",
  "pullRequest": 123,
  "title": "Improve session rotation",
  "baseSha": "...",
  "headSha": "...",
  "generatedAt": "2026-09-18T12:00:00Z",
  "mode": "live",
  "changes": [
    {
      "id": "session-rotation",
      "title": "Session rotation semantics",
      "priority": "P0",
      "oldLogic": "...",
      "newLogic": "...",
      "whatChanged": "...",
      "whyHumanReview": "...",
      "files": ["src/session.ts"],
      "evidence": [{ "path": "src/session.ts", "startLine": 20, "endLine": 44, "side": "new", "snippet": "..." }],
      "confidence": 0.91
    }
  ]
}
```

Unknown priorities are treated as P0.

## Shared renderer

`review-ui.js` exposes `globalThis.JevReviewerUI.renderReview(container, report, options)`. `review-ui.css` contains all renderer styles, so the same renderer can be loaded by a standalone local demo page without Chrome APIs.

## Tests

Run the dependency-free helper tests from the repository root:

```bash
node --test extension/test/*.test.mjs
```

`test/renderer-smoke.html` is a browser fixture for visually checking the shared renderer, including literal rendering of HTML-shaped model output.

The full extension test launches an unpacked Manifest V3 extension, an authenticated local server, and a GitHub-shaped page in a persistent Playwright Chromium context:

```bash
node scripts/test-extension.mjs
```

Set `CHROMIUM_PATH` if Chromium is installed somewhere Playwright cannot discover. The ignored screenshot artifact is written to `artifacts/extension-e2e.png`.
