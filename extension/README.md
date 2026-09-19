# Jev-Reviewer Chrome extension

This Manifest V3 extension shows a local Jev-Reviewer report inside GitHub pull-request **Files changed** pages. It preserves GitHub's PR header, tabs, file wrappers, filenames, anchors, and native collapse controls. For each matched file, it replaces only the native diff table with a behavioral comparison. It has no build step and does not read local files.

## Load it unpacked

1. Start the local service with `jev-reviewer serve` (it listens on `127.0.0.1:4731`).
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this `extension` directory.
6. Run `jev-reviewer token` in a human-controlled terminal and copy the local pairing token.
7. Click the Jev-Reviewer extension icon, then follow **Connection** → **Local pairing token** → **Save**.
8. Open a URL shaped like `https://github.com/OWNER/REPO/pull/123/files` and enable **Show logic in place of code** in the popup.

The token is kept in Chrome extension local storage and is sent only to `http://127.0.0.1:4731` as a bearer token. It is separate from both model-provider keys. Do not ask a coding agent to print this token into its transcript.

## Behavior

- Each matched native file header gets a P0/P1/P2 badge. P0 files are expanded by default; P1 and P2 are collapsed using GitHub's own file chevrons.
- The file body shows Old logic and New logic columns. An information note beneath New logic explains what changed and expands to the human-review question.
- **Show logic in place of code** switches between the behavioral comparison and GitHub's untouched diff tables.
- **Refresh report** reloads an existing local report. It does not analyze the PR; the CLI or coding-agent skill does that.
- Connection and expand-by-default preferences live in the extension popup and persist locally. There is no on-page dashboard, toolbar, settings panel, or Analyze button.
- If logic view is off, the service is unavailable, or report freshness is stale or unverified, the native GitHub code stays visible. Unavailable or unverifiable reports add a warning badge to the extension icon, with details in its popup; there is no on-page warning banner.
- The popup reports provider provenance. Recorded Jev decisions with prepared demo copy are explicitly labeled and never presented as live OpenAI output.
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

## Renderer

`review-ui.js` exposes `globalThis.JevReviewerUI.renderLogicTable(container, changes, options)` for the per-file replacement, plus normalization, priority-badge, and standalone replay helpers. `review-ui.css` contains the shared table and badge styles. The content script groups every report unit for a file, inserts one logic table beside the hidden native table, and restores the original table without reloading when logic view is disabled.

## Tests

Run the dependency-free helper tests from the repository root:

```bash
node --test extension/test/*.test.mjs
```

`test/renderer-smoke.html` is a no-server browser fixture for the native file/table renderer. Its script asserts the new `.jrv-file`, logic-table cells, information note, default expansion, and literal rendering of HTML-shaped model output; it also rejects legacy `.jrv-card` dashboard markup.

The full extension test launches an unpacked Manifest V3 extension, an authenticated local server, and a GitHub-shaped page in a persistent Playwright Chromium context:

```bash
node scripts/test-extension.mjs
```

Set `CHROMIUM_PATH` if Chromium is installed somewhere Playwright cannot discover. The ignored screenshot artifact is written to `artifacts/extension-e2e.png`.
