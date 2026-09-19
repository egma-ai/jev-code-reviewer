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
const ARTIFACT = join(ROOT, 'artifacts', 'extension-e2e.png');
const TOKEN = 'extension-e2e-pairing-token';
const REPOSITORY = 'egma-ai/jev-reviewer';
const PULL_REQUEST = 1;
const ANALYZED_HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PAGE_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BUNDLED_CHROMIUM = '/opt/homebrew/bin/chromium';

const report = {
  repository: REPOSITORY,
  pullRequest: PULL_REQUEST,
  title: 'Make pull request review human-sized',
  url: 'https://github.com/egma-ai/jev-reviewer/pull/1',
  baseSha: 'cccccccccccccccccccccccccccccccccccccccc',
  headSha: ANALYZED_HEAD,
  generatedAt: '2026-09-18T12:00:00.000Z',
  mode: 'replay',
  providers: { explanation: 'openai', prioritization: 'jev' },
  display: { P0: true, P1: false, P2: false },
  changes: [
    {
      id: 'auth-boundary',
      title: 'Protect session rotation <img src=x onerror=alert(1)>',
      priority: 'P0',
      oldLogic: 'The browser could request any cached review without proving it was paired.',
      newLogic: 'The local bridge now requires a timing-safe bearer-token match.',
      whatChanged: 'Review data is now restricted to a paired local extension.',
      whyHumanReview: 'This changes the trust boundary between private source analysis and the browser.',
      files: ['src/server.mjs', 'extension/service-worker.js'],
      evidence: [{ path: 'src/server.mjs', startLine: 20, endLine: 32, side: 'new', snippet: 'equalSecret(authorization, expectedToken)' }]
    },
    {
      id: 'review-card',
      title: 'Render semantic change cards',
      priority: 'P1',
      oldLogic: 'Reviewers started with the raw code diff.',
      newLogic: 'Reviewers start with old logic, new logic, and what changed.',
      whatChanged: 'The information hierarchy moved from lines to behavioral decisions.',
      whyHumanReview: 'The interaction is new and should be checked for clarity.',
      files: ['extension/review-ui.js']
    },
    {
      id: 'styling',
      title: 'Apply the review-card presentation',
      priority: 'P2',
      oldLogic: 'The prototype had no presentation layer.',
      newLogic: 'Namespaced CSS styles the injected cards.',
      whatChanged: 'Visual styling was added without changing review behavior.',
      whyHumanReview: 'Automated rendering evidence is sufficient.',
      files: ['extension/review-ui.css']
    }
  ]
};

function githubFixture() {
  return `<!doctype html>
  <html><head>
    <meta charset="utf-8">
    <meta name="octolytics-dimension-pull_request_head_sha" content="${PAGE_HEAD}">
    <title>Human-sized review · Pull Request #1 · egma-ai/jev-reviewer</title>
  </head><body>
    <main>
      <h1>Make pull request review human-sized</h1>
      <div data-target="diff-layout.mainContainer" class="js-diff-progressive-container">
        <div id="native-diff">Native GitHub code diff</div>
      </div>
    </main>
  </body></html>`;
}

async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'jev-reviewer-extension-'));
  const profile = join(temp, 'chromium-profile');
  const reportFile = join(temp, 'reviews', 'egma-ai--jev-reviewer--1.json');
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  let server;
  let context;
  try {
    server = await startServer({ port: 4731, token: TOKEN, directory: temp });
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.CHROMIUM_PATH || (existsSync(BUNDLED_CHROMIUM) ? BUNDLED_CHROMIUM : chromium.executablePath()),
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
    });
    await context.route('https://github.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: githubFixture()
    }));

    const page = await context.newPage();
    await page.goto('https://github.com/egma-ai/jev-reviewer/pull/1/files');

    const root = page.locator('#jev-reviewer-root');
    await root.waitFor();
    await assert.rejects(root.locator('.jrv-card').first().waitFor({ timeout: 500 }), /Timeout/);
    await assert.doesNotReject(root.getByText('Local reviewer unavailable').waitFor());
    assert.equal(await page.locator('#native-diff').isVisible(), true, 'native diff stays visible before pairing');

    await root.getByText('Set pairing token').click();
    await root.locator('.jrv-token-input').fill(TOKEN);
    await root.getByRole('button', { name: 'Save and retry' }).click();
    await root.locator('.jrv-card').first().waitFor();

    assert.equal(await root.locator('details.jrv-card[data-priority="P0"]').getAttribute('open'), '', 'P0 is expanded');
    assert.equal(await root.locator('details.jrv-card[data-priority="P1"]').getAttribute('open'), null, 'P1 is collapsed');
    assert.equal(await root.locator('details.jrv-card[data-priority="P2"]').getAttribute('open'), null, 'P2 is collapsed');
    assert.match(await root.locator('.jrv-freshness').textContent(), /^Stale/, 'head mismatch is called stale');
    assert.equal(await page.locator('#native-diff').isVisible(), true, 'stale analysis keeps raw diff visible');
    assert.equal(await root.locator('img').count(), 0, 'HTML-shaped model output is not interpreted as markup');
    assert.match(await root.locator('.jrv-card__title').first().textContent(), /<img src=x/, 'HTML-shaped model output is visible as text');

    await root.getByRole('button', { name: 'Hide code diff' }).click();
    assert.equal(await page.locator('#native-diff').isVisible(), false, 'reviewer can explicitly hide a stale diff');

    await page.reload();
    await root.locator('.jrv-card').first().waitFor();
    assert.equal(await root.getByText('Local reviewer unavailable').count(), 0, 'pairing token persists across reload');

    await mkdir(dirname(ARTIFACT), { recursive: true });
    await page.screenshot({ path: ARTIFACT, fullPage: true });

    await root.getByRole('button', { name: 'Hide code diff' }).click();
    assert.equal(await page.locator('#native-diff').isVisible(), false);
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    server = null;
    await root.getByRole('button', { name: 'Refresh' }).click();
    await root.getByText('Local reviewer unavailable').waitFor();
    assert.equal(await page.locator('#native-diff').isVisible(), true, 'native diff is restored when localhost becomes unavailable');

    console.log(`Extension end-to-end test passed. Screenshot: ${ARTIFACT}`);
  } finally {
    if (context) await context.close();
    if (server) await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temp, { recursive: true, force: true });
  }
}

await main();
