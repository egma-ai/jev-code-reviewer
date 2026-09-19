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

async function extensionWorker(context) {
  return context.serviceWorkers()[0] || context.waitForEvent('serviceworker', { timeout: 20000 });
}

async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'jev-reviewer-real-demo-'));
  const profile = join(temp, 'profile');
  const token = await pairingToken();
  await mkdir(ARTIFACTS, { recursive: true });
  await rm(VIDEO, { force: true });
  await rm(MP4, { force: true });

  let setupContext;
  let context;
  try {
    // Seed chrome.storage without placing the local token in browser-visible UI or logs.
    setupContext = await chromium.launchPersistentContext(profile, { executablePath, headless: true, args });
    const setupPage = await setupContext.newPage();
    await setupPage.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await setupPage.locator('#jev-reviewer-root').waitFor({ timeout: 30000 });
    const worker = await extensionWorker(setupContext);
    await worker.evaluate(async (pairingTokenValue) => chrome.storage.local.set({ pairingToken: pairingTokenValue }), token);
    await setupContext.close();
    setupContext = null;

    context = await chromium.launchPersistentContext(profile, {
      executablePath,
      headless: true,
      args,
      viewport: { width: 1440, height: 1100 },
      recordVideo: { dir: join(ARTIFACTS, 'video-parts'), size: { width: 1440, height: 1100 } }
    });
    const page = await context.newPage();
    const video = page.video();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const root = page.locator('#jev-reviewer-root');
    await root.locator('.jrv-card').first().waitFor({ timeout: 30000 });
    await root.scrollIntoViewIfNeeded();

    assert.equal(await root.locator('.jrv-provenance__title').textContent(), 'Recorded Jev decisions · prepared demo explanations');
    assert.equal(
      await root.locator('.jrv-provenance__note').textContent(),
      'These priorities are recorded Jev results. The explanation text was prepared for this demo; it is not a live OpenAI API result.'
    );
    assert.match(await root.locator('.jrv-coverage').textContent(), /4\/4 changes analyzed/);
    assert.equal(await root.locator('.jrv-priority--p0').count(), 1);
    assert.equal(await root.locator('.jrv-priority--p1').count(), 1);
    assert.equal(await root.locator('.jrv-priority--p2').count(), 2);
    assert.equal(await root.locator('details.jrv-card[data-priority="P0"]').getAttribute('open'), '');
    assert.equal(await root.locator('details.jrv-card[data-priority="P1"]').getAttribute('open'), null);
    assert.equal(await root.locator('details.jrv-card[data-priority="P2"]').first().getAttribute('open'), null);
    assert.match(await root.locator('.jrv-freshness').textContent(), /^Current at 9c58b51e/);
    assert.equal(await root.getByText('Human review question').count(), 4);
    assert.equal(await root.getByText('Why this priority').count(), 0);
    assert.equal(await page.locator('[data-jev-native-diff="true"]').isVisible(), false);

    const p0 = root.locator('details.jrv-card[data-priority="P0"]');
    const p1 = root.locator('details.jrv-card[data-priority="P1"]');
    const p2 = root.locator('details.jrv-card[data-priority="P2"]').first();

    // Hold the initial attention-ranked view long enough to read the provenance and P0 card.
    await page.waitForTimeout(5000);

    // Inspect the source evidence behind the P0 summary, then return to the semantic view.
    await p0.locator('details.jrv-evidence > summary').click();
    await page.waitForTimeout(4000);
    await p0.locator('details.jrv-evidence > summary').click();
    await page.waitForTimeout(500);

    // Compare the attention tiers: collapse P0, inspect P1, then briefly inspect a P2.
    await p0.locator(':scope > summary').click();
    await p1.locator(':scope > summary').click();
    await page.waitForTimeout(5000);
    await p1.locator(':scope > summary').click();
    await p2.locator(':scope > summary').click();
    await page.waitForTimeout(3000);
    await p2.locator(':scope > summary').click();

    // Restore defaults, show that the original GitHub diff remains one click away, then reset.
    await p0.locator(':scope > summary').click();
    await root.scrollIntoViewIfNeeded();
    await root.getByRole('button', { name: 'View code diff' }).click();
    const nativeDiff = page.locator('[data-jev-native-diff="true"]');
    await nativeDiff.scrollIntoViewIfNeeded();
    await page.waitForTimeout(4000);
    await root.scrollIntoViewIfNeeded();
    await root.getByRole('button', { name: 'Hide code diff' }).click();
    await page.waitForTimeout(800);

    assert.equal(await p0.getAttribute('open'), '');
    assert.equal(await p1.getAttribute('open'), null);
    assert.equal(await p2.getAttribute('open'), null);
    assert.equal(await nativeDiff.isVisible(), false);
    await page.screenshot({ path: SCREENSHOT });

    const saveVideo = video ? video.saveAs(VIDEO) : Promise.resolve();
    await context.close();
    context = null;
    await saveVideo;
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-y', '-i', VIDEO, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', MP4
    ]);
    console.log(`Verified the unpacked extension on ${URL}`);
    console.log(`Screenshot: ${SCREENSHOT}`);
    console.log(`Video: ${VIDEO}`);
    console.log(`Launch video: ${MP4}`);
  } finally {
    if (setupContext) await setupContext.close();
    if (context) await context.close();
    await rm(temp, { recursive: true, force: true });
  }
}

await main();
