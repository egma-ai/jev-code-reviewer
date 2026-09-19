import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { pairingToken } from '../src/config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = join(ROOT, 'extension');
const ARTIFACTS = join(ROOT, 'artifacts');
const SCREENSHOT = join(ARTIFACTS, 'real-github-extension.png');
const VIDEO = join(ARTIFACTS, 'real-github-extension.webm');
const MP4 = join(ARTIFACTS, 'jev-reviewer-demo.mp4');
const URL = 'https://github.com/egma-ai/jev-reviewer/pull/1/files';
const HOMEBREW_CHROMIUM = '/opt/homebrew/bin/chromium';
const executablePath = process.env.CHROMIUM_PATH || (existsSync(HOMEBREW_CHROMIUM) ? HOMEBREW_CHROMIUM : chromium.executablePath());
const args = [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`];
const run = promisify(execFile);

async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'jev-reviewer-real-demo-'));
  const token = await pairingToken();
  await mkdir(ARTIFACTS, { recursive: true });
  let context;
  try {
    context = await chromium.launchPersistentContext(join(temp, 'profile'), {
      executablePath, headless: true, args, colorScheme: 'light',
      viewport: { width: 1440, height: 1100 },
      recordVideo: { dir: join(ARTIFACTS, 'video-parts'), size: { width: 1440, height: 1100 } }
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
    // Pair internally. No API key or local token appears in the recording or logs.
    await worker.evaluate(async (value) => chrome.storage.local.set({ pairingToken: value }), token);
    const page = await context.newPage();
    const video = page.video();
    const errors = [];
    page.on('pageerror', (error) => { if (/jev|reviewer/i.test(error.stack || '')) errors.push(error.message); });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-jev-file]').length === 4, { timeout: 30000 });

    const files = page.locator('.js-file[data-jev-file]');
    const p0 = files.filter({ has: page.locator('.jrv-native-priority.jrv-priority--p0') });
    const p1 = files.filter({ has: page.locator('.jrv-native-priority.jrv-priority--p1') });
    const p2 = files.filter({ has: page.locator('.jrv-native-priority.jrv-priority--p2') }).first();
    const chevron = (file) => file.locator(':scope > .file-header button.js-details-target[aria-label="Toggle diff contents"]');
    assert.equal(await files.count(), 4);
    assert.equal(await page.locator('table[data-jev-code-hidden="true"]').count(), 4);
    assert.equal(await page.locator('#jev-reviewer-root,.jrv-shell,.jrv-card').count(), 0);
    assert.equal(await chevron(p0).getAttribute('aria-expanded'), 'true');
    assert.equal(await chevron(p1).getAttribute('aria-expanded'), 'false');
    assert.equal(await chevron(p2).getAttribute('aria-expanded'), 'false');
    assert.match(await p0.locator('.jrv-native-priority').getAttribute('title'), /prepared demo explanations/);
    assert.equal(await p0.locator('.jrv-old-logic').count(), 1);
    assert.equal(await p0.locator('.jrv-new-logic .jrv-change-note').count(), 1);
    assert.equal(await page.locator('[data-target="diff-layout.mainContainer"]').isVisible(), true);
    assert.equal(await page.getByRole('heading', { level: 1 }).count() > 0, true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: SCREENSHOT });

    // These are GitHub's own file controls; the extension adds no page toolbar.
    await p0.locator('.jrv-change-note__summary').click();
    await page.waitForTimeout(3500);
    await p0.locator('.jrv-change-note__summary').click();
    await chevron(p1).click();
    await p1.scrollIntoViewIfNeeded();
    assert.equal(await p1.locator('.jrv-native-replacement').isVisible(), true);
    await page.waitForTimeout(3500);
    await chevron(p1).click();
    await chevron(p2).click();
    await page.waitForTimeout(2500);
    await chevron(p2).click();

    // Verify the popup's source-view setting restores GitHub's original tables.
    await worker.evaluate(() => chrome.storage.local.set({ logicView: false }));
    await page.waitForFunction(() => !document.querySelector('[data-jev-code-hidden]'));
    assert.equal(await page.locator('.jrv-native-replacement').count(), 0);
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(3500);
    await worker.evaluate(() => chrome.storage.local.set({ logicView: true }));
    await page.waitForFunction(() => document.querySelectorAll('[data-jev-file]').length === 4);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(3000);
    assert.deepEqual(errors, []);

    const saveVideo = video ? video.saveAs(VIDEO) : Promise.resolve();
    await context.close();
    context = null;
    await saveVideo;
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-y', '-i', VIDEO, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', MP4
    ]);
    console.log(`Verified native GitHub file integration: ${URL}`);
    console.log(`Screenshot: ${SCREENSHOT}`);
    console.log(`Launch video: ${MP4}`);
  } finally {
    if (context) await context.close();
    await rm(temp, { recursive: true, force: true });
  }
}

await main();
