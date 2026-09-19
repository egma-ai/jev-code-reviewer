import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, randomUUID } from 'node:crypto';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const cacheDir = () => process.env.JEV_REVIEWER_CACHE_DIR || join(homedir(), '.cache', 'jev-reviewer');
export const configDir = () => process.env.JEV_REVIEWER_CONFIG_DIR || join(homedir(), '.config', 'jev-reviewer');
export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}
export function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export async function pairingToken() {
  const path = join(configDir(), 'pairing-token');
  try { return (await readFile(path, 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  try { await writeFile(path, token + '\n', { mode: 0o600, flag: 'wx' }); return token; }
  catch (error) { if (error.code !== 'EEXIST') throw error; return (await readFile(path, 'utf8')).trim(); }
}
export async function loadPolicy(repo, customPath) {
  const defaults = await readJson(join(ROOT, 'config/policy.json'));
  let overrides = {};
  const path = customPath || (repo ? join(repo, '.jev-reviewer.json') : null);
  if (path) {
    try { overrides = await readJson(path); }
    catch (error) { if (customPath || error.code !== 'ENOENT') throw new Error(`Cannot read review policy: ${path}`); }
  }
  const policy = { ...defaults, ...overrides, priorities: { ...defaults.priorities, ...overrides.priorities }, display: { ...defaults.display, ...overrides.display } };
  for (const key of ['P0', 'P1', 'P2']) {
    if (typeof policy.priorities[key] !== 'string' || typeof policy.display[key] !== 'boolean') throw new Error(`Invalid policy for ${key}.`);
  }
  if (!['P0', 'P1'].includes(policy.uncertainPriority)) throw new Error('uncertainPriority must be P0 or P1, never P2.');
  if (!Array.isArray(policy.alwaysReviewPaths) || policy.alwaysReviewPaths.some(x => typeof x !== 'string')) throw new Error('alwaysReviewPaths must be strings.');
  return policy;
}
export function matchesGlob(path, pattern) {
  let expression = '';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { expression += '(?:.*/)?'; i += 2; }
      else { expression += '.*'; i++; }
    } else if (pattern[i] === '*') expression += '[^/]*';
    else expression += pattern[i].replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`^${expression}$`).test(path);
}
export function applyPolicy(change, unit, policy) {
  const reasons = [];
  let priority = change.priority;
  if (!['P0', 'P1', 'P2'].includes(priority)) { priority = policy.uncertainPriority; reasons.push('Classifier returned an unsupported priority.'); }
  if (unit.context.truncated || unit.unsupported) {
    priority = ['P0', policy.uncertainPriority].includes(priority) ? priority : policy.uncertainPriority;
    reasons.push('Changed code is incomplete or unsupported; human inspection required.');
  }
  if (policy.alwaysReviewPaths.some(pattern => [unit.path, unit.oldPath].filter(Boolean).some(path => matchesGlob(path, pattern)))) {
    priority = 'P0'; reasons.push('A configured always-review path matched.');
  }
  return { ...change, priority, modelPriority: change.priority, policyReasons: reasons };
}
export function reportPath(repository, number, directory = cacheDir()) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[1-9]\d*$/.test(String(number))) throw new Error('Invalid repository or PR number.');
  return join(directory, 'reviews', `${repository.toLowerCase().replace('/', '--')}--${number}.json`);
}
