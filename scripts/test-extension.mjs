import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from '../src/server.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = join(ROOT, 'extension');
const ARTIFACT = join(ROOT, 'artifacts', 'extension-native-e2e.png');
const TOKEN = 'extension-e2e-pairing-token';
const REPOSITORY = 'egma-ai/jev-code-reviewer';
const PULL_REQUEST = 1;
const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STALE_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const HOMEBREW_CHROMIUM = '/opt/homebrew/bin/chromium';

const filePriorities = {
  'src/server.mjs': 'P0',
  'extension/service-worker.js': 'P0',
  'extension/review-ui.js': 'P1',
  'extension/review-ui.css': 'P2'
};

const report = {
  repository: REPOSITORY,
  pullRequest: PULL_REQUEST,
  title: 'Make pull request review human-sized',
  url: 'https://github.com/egma-ai/jev-code-reviewer/pull/1',
  baseSha: 'cccccccccccccccccccccccccccccccccccccccc',
  headSha: HEAD,
  generatedAt: '2026-09-18T12:00:00.000Z',
  mode: 'replay',
  providers: { classifier: 'TypeSafe Jev', explanations: 'Prepared copy' },
  provenance: {
    classification: 'live-typesafe-api',
    explanations: 'prepared-copy',
    note: 'Recorded Jev priorities; prepared demo explanations.'
  },
  display: { P0: true, P1: false, P2: false },
  changes: [
    {
      id: 'auth-boundary',
      title: 'Protect session rotation',
      priority: 'P0',
      oldLogic: 'Requests were accepted without pairing. <img id="model-xss" src=x onerror=alert(1)>',
      newLogic: 'The local bridge requires a timing-safe bearer-token match.',
      whatChanged: 'Private review data is restricted to the paired extension.',
      whyHumanReview: 'Confirm the localhost trust boundary and token lifecycle.',
      files: ['src/server.mjs', 'extension/service-worker.js']
    },
    {
      id: 'review-logic',
      title: 'Render semantic logic alongside the native diff',
      priority: 'P1',
      oldLogic: 'Reviewers started with every changed line.',
      newLogic: 'Reviewers start with an old/new natural-language comparison.',
      whatChanged: 'The review unit moved from lines to behavioral logic.',
      whyHumanReview: 'Check whether the explanation preserves the important behavior.',
      files: ['extension/review-ui.js']
    },
    {
      id: 'native-style',
      title: 'Use GitHub-native presentation',
      priority: 'P2',
      oldLogic: 'The prototype used a separate dashboard.',
      newLogic: 'The semantic comparison lives inside each native file container.',
      whatChanged: 'Presentation changed without altering runtime behavior.',
      whyHumanReview: 'Automated DOM and rendering evidence is sufficient.',
      files: ['extension/review-ui.css']
    }
  ]
};

function nativeFile(path, index) {
  return `<div class="js-file" id="native-file-${index}" data-tagsearch-path="${path}">
    <div class="js-file-header" id="native-header-${index}" data-path="${path}">
      <button class="js-details-target" type="button" aria-expanded="true" aria-label="Toggle diff contents">⌄</button>
      <span class="Truncate-text">${path}</span>
    </div>
    <div class="js-file-content" id="native-content-${index}">
      <table class="diff-table" id="native-table-${index}"><tbody><tr><td>native code for ${path}</td></tr></tbody></table>
    </div>
  </div>`;
}

function githubFixture() {
  const files = Object.keys(filePriorities).map(nativeFile).join('\n');
  return `<!doctype html>
  <html data-color-mode="light"><head>
    <meta charset="utf-8">
    <meta name="octolytics-dimension-pull_request_head_sha" content="${HEAD}">
    <title>Human-sized review · Pull Request #1 · egma-ai/jev-code-reviewer</title>
  </head><body>
    <nav id="github-tabs"><a>Code</a><a>Issues</a><a>Pull requests</a></nav>
    <aside id="github-sidebar">Changed files</aside>
    <main id="github-pr-shell">
      <header id="github-pr-header"><h1>Make pull request review human-sized</h1></header>
      <div class="js-pull-refresh-on-pjax" data-url="/compare?end_commit_oid=${HEAD}"></div>
      <div id="files_bucket" class="files-bucket js-diff-progressive-container" data-target="diff-layout.mainContainer">${files}</div>
    </main>
    <script>
      window.__nativeNodes = {
        shell: document.querySelector('#github-pr-shell'),
        header: document.querySelector('#github-pr-header'),
        tabs: document.querySelector('#github-tabs'),
        sidebar: document.querySelector('#github-sidebar'),
        files: [...document.querySelectorAll('.js-file')],
        headers: [...document.querySelectorAll('.js-file-header')],
        tables: [...document.querySelectorAll('table.diff-table')]
      };
      document.addEventListener('click', (event) => {
        const button = event.target.closest('button.js-details-target');
        if (!button) return;
        const content = button.closest('.js-file').querySelector('.js-file-content');
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!expanded));
        content.hidden = expanded;
      });
    </script>
  </body></html>`;
}

async function extensionWorker(context) {
  return context.serviceWorkers()[0] || context.waitForEvent('serviceworker', { timeout: 20000 });
}

async function waitForState(page, state, timeout = 15000) {
  await page.waitForFunction((expected) => document.documentElement.dataset.jevReviewerState === expected, state, { timeout });
}

async function popupAction(githubPage, popupPage, selector, action = 'click') {
  await githubPage.bringToFront();
  await popupPage.evaluate(({ target, eventType }) => {
    const node = document.querySelector(target);
    if (!node) throw new Error(`Popup control missing: ${target}`);
    if (eventType === 'click') node.click();
  }, { target: selector, eventType: action });
}

async function assertNativeNodesPreserved(page) {
  assert.equal(await page.evaluate(() => {
    const refs = window.__nativeNodes;
    return refs.shell === document.querySelector('#github-pr-shell') &&
      refs.header === document.querySelector('#github-pr-header') &&
      refs.tabs === document.querySelector('#github-tabs') &&
      refs.sidebar === document.querySelector('#github-sidebar') &&
      refs.files.every((node, index) => node === document.querySelectorAll('.js-file')[index]) &&
      refs.headers.every((node, index) => node === document.querySelectorAll('.js-file-header')[index]) &&
      refs.tables.every((node, index) => node === document.querySelectorAll('table.diff-table')[index]);
  }), true, 'GitHub shell, navigation, file, header, and table nodes are retained');
}

async function assertNativeCodeRestored(page, state) {
  await waitForState(page, state);
  assert.equal(await page.locator('.jrv-native-replacement').count(), 0, `${state} removes semantic replacements`);
  assert.equal(await page.locator('table.diff-table[data-jev-code-hidden="true"]').count(), 0, `${state} clears code-hidden markers`);
  for (const table of await page.locator('table.diff-table').all()) {
    assert.equal(await table.isVisible(), true, `${state} keeps native code visible`);
  }
  await assertNativeNodesPreserved(page);
}

async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'jev-reviewer-extension-'));
  const profile = join(temp, 'chromium-profile');
  const reportFile = join(temp, 'reviews', 'egma-ai--jev-code-reviewer--1.json');
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  let server;
  let context;
  try {
    server = await startServer({ port: 4731, token: TOKEN, directory: temp });
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.CHROMIUM_PATH || (existsSync(HOMEBREW_CHROMIUM) ? HOMEBREW_CHROMIUM : chromium.executablePath()),
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
    });
    await context.route('https://github.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: githubFixture()
    }));

    const page = await context.newPage();
    await page.goto('https://github.com/egma-ai/jev-code-reviewer/pull/1/files');
    await assertNativeCodeRestored(page, 'unavailable');

    const worker = await extensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    assert.equal(await popup.locator('#token').getAttribute('type'), 'password', 'pairing token input is masked');
    await popup.locator('#token').fill(TOKEN);
    await page.bringToFront();
    await popup.evaluate(() => document.querySelector('#save').click());
    await waitForState(page, 'ready');

    assert.equal(await page.locator('.jrv-native-replacement').count(), 4, 'all four native files receive semantic replacements');
    assert.equal(await page.locator('table.diff-table[data-jev-code-hidden="true"]').count(), 4, 'only native code tables are hidden');
    assert.equal(await page.locator('.jrv-native-priority').count(), 4, 'each native file header receives a priority badge');
    for (const [path, expectedPriority] of Object.entries(filePriorities)) {
      const file = page.locator(`.js-file[data-tagsearch-path="${path}"]`);
      assert.equal(await file.getAttribute('data-jev-file'), expectedPriority);
      assert.equal(await file.locator('.jrv-native-priority').textContent(), expectedPriority);
      assert.equal(await file.locator('button.js-details-target').getAttribute('aria-expanded'), expectedPriority === 'P0' ? 'true' : 'false');
      assert.equal(await file.locator('.jrv-native-replacement .jrv-logic-table').count(), 1);
    }
    assert.equal(await page.locator('#model-xss').count(), 0, 'model HTML is never interpreted as markup');
    assert.match(await page.locator('[data-tagsearch-path="src/server.mjs"] .jrv-old-logic').textContent(), /<img id="model-xss"/);
    await assertNativeNodesPreserved(page);

    // GitHub updates these values in place during SPA navigation. Conflicting full SHAs
    // must restore code immediately, without waiting for a popup refresh or polling timer.
    await page.evaluate((head) => {
      document.querySelector('.js-pull-refresh-on-pjax').setAttribute('data-url', `/compare?end_commit_oid=${head}`);
    }, STALE_HEAD);
    await waitForState(page, 'unverified', 2500);
    assert.equal(await page.locator('.jrv-native-replacement').count(), 0, 'conflicting GitHub head sources immediately restore native code');
    assert.equal(await page.locator('table.diff-table[data-jev-code-hidden="true"]').count(), 0);

    await page.evaluate((head) => {
      document.querySelector("meta[name='octolytics-dimension-pull_request_head_sha']").setAttribute('content', head);
    }, STALE_HEAD);
    await waitForState(page, 'stale', 2500);
    assert.equal(await page.locator('.jrv-native-replacement').count(), 0, 'consensus on a different head remains safely stale');

    await page.evaluate((head) => {
      document.querySelector('.js-pull-refresh-on-pjax').setAttribute('data-url', `/compare?end_commit_oid=${head}`);
      document.querySelector("meta[name='octolytics-dimension-pull_request_head_sha']").setAttribute('content', head);
    }, HEAD);
    await waitForState(page, 'ready', 2500);
    assert.equal(await page.locator('.jrv-native-replacement').count(), 4, 'matching head attributes reapply logic view without refresh');
    assert.equal(await page.locator('table.diff-table[data-jev-code-hidden="true"]').count(), 4);
    await assertNativeNodesPreserved(page);

    const status = await popup.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, { type: 'JEV_REVIEWER_STATUS' });
    });
    assert.equal(status.state, 'ready', 'content script responds to popup status requests');
    await popup.waitForFunction(() => document.querySelector('#provenance').textContent.trim().length > 0, null, { timeout: 3000 });
    assert.match(await popup.locator('#provenance').textContent(), /Jev|recorded/i);
    assert.ok((await popup.locator('#status').textContent()).trim(), 'popup presents current status');

    await popupAction(page, popup, '#logic-view');
    await assertNativeCodeRestored(page, 'disabled');
    await popupAction(page, popup, '#logic-view');
    await waitForState(page, 'ready');
    assert.equal(await page.locator('.jrv-native-replacement').count(), 4, 'logic view reapplies without replacing native file nodes');

    const p1Default = popup.locator('input[data-priority="P1"]');
    assert.equal(await p1Default.isChecked(), false, 'P1 defaults collapsed');
    await popupAction(page, popup, 'input[data-priority="P1"]');
    await page.waitForFunction(() => document.querySelector('[data-jev-file="P1"] button.js-details-target')?.getAttribute('aria-expanded') === 'true');

    await writeFile(reportFile, `${JSON.stringify({ ...report, headSha: STALE_HEAD }, null, 2)}\n`);
    await popupAction(page, popup, '#refresh');
    await assertNativeCodeRestored(page, 'stale');

    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    await page.evaluate(() => document.querySelector("meta[name='octolytics-dimension-pull_request_head_sha']")?.remove());
    await page.evaluate(() => document.querySelector('.js-pull-refresh-on-pjax')?.remove());
    await popupAction(page, popup, '#refresh');
    await assertNativeCodeRestored(page, 'unverified');

    await page.evaluate((head) => {
      const meta = document.createElement('meta');
      meta.name = 'octolytics-dimension-pull_request_head_sha';
      meta.content = head;
      document.head.append(meta);
    }, HEAD);
    await popupAction(page, popup, '#refresh');
    await waitForState(page, 'ready');
    assert.equal(await page.locator('.jrv-native-replacement').count(), 4);

    await mkdir(dirname(ARTIFACT), { recursive: true });
    await page.screenshot({ path: ARTIFACT, fullPage: true });

    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    server = null;
    await popupAction(page, popup, '#refresh');
    await assertNativeCodeRestored(page, 'unavailable');
    assert.match(await popup.locator('#status').textContent(), /unavailable|offline|not reachable/i);

    console.log(`Native extension end-to-end test passed. Screenshot: ${ARTIFACT}`);
  } finally {
    if (context) await context.close();
    if (server) await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temp, { recursive: true, force: true });
  }
}

await main();
