import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);
export async function command(binary, args, cwd, options = {}) {
  try { return (await execute(binary, args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 120000, ...options })).stdout; }
  catch (error) { throw new Error(`${binary} ${args[0]} failed (${error.code || 'unknown'}). Check the command locally for details.`); }
}
export const git = (repo, ...args) => command('git', ['-c', 'core.quotepath=false', ...args], repo);
export function parsePr(value) {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)(?:\/[^?#]*)?(?:[?#].*)?$/.exec(value || '');
  if (!match || [match[1], match[2]].some(x => x === '.' || x === '..')) throw new Error('Use a full https://github.com/OWNER/REPO/pull/NUMBER URL.');
  return { repository: `${match[1]}/${match[2]}`, number: Number(match[3]), url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` };
}
export async function resolvePr(repo, prUrl) {
  repo = resolve(repo);
  await git(repo, 'rev-parse', '--show-toplevel');
  const pr = parsePr(prUrl);
  const metadata = JSON.parse(await command('gh', ['api', `repos/${pr.repository}/pulls/${pr.number}`], repo));
  const identity = metadata.base?.repo?.full_name;
  if (identity?.toLowerCase() !== pr.repository.toLowerCase()) throw new Error('GitHub returned a different repository.');
  // Verify local origin identity before allowing a read of local source for this PR.
  const origin = (await git(repo, 'remote', 'get-url', 'origin')).trim();
  const expected = pr.repository.toLowerCase();
  const remoteMatch = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/.exec(origin);
  if (!remoteMatch || remoteMatch[1].toLowerCase() !== expected) throw new Error('Local origin does not match the PR repository. Use a clone of the PR base repository.');
  const baseTip = metadata.base.sha;
  const head = metadata.head.sha;
  if (![baseTip, head].every(x => /^[0-9a-f]{40}$/.test(x))) throw new Error('Invalid commit identity from GitHub.');
  for (const sha of [baseTip, head]) {
    try { await git(repo, 'cat-file', '-e', `${sha}^{commit}`); }
    catch { await git(repo, 'fetch', '--no-tags', 'origin', sha); }
  }
  const baseSha = (await git(repo, 'merge-base', baseTip, head)).trim();
  return { repository: pr.repository, pullRequest: pr.number, url: pr.url, title: metadata.title, baseSha, baseTipSha: baseTip, headSha: head, state: metadata.state, repo };
}
export async function readSource(repo, sha, path) {
  // git show reads the committed blob, never the working tree or symlink target.
  return git(repo, 'show', `${sha}:${path}`);
}
export function parseHunks(diff) {
  const lines = diff.split('\n');
  const hunks = [];
  for (const line of lines) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (match) hunks.push({ oldStart: +match[1], oldCount: match[2] === undefined ? 1 : +match[2], newStart: +match[3], newCount: match[4] === undefined ? 1 : +match[4], heading: match[5].trim(), diff: line + '\n' });
    else if (hunks.length) hunks.at(-1).diff += line + '\n';
  }
  return hunks;
}
function excerpt(source, start, count) {
  const lines = source.split('\n');
  const from = Math.max(0, start - 1 - 40);
  const to = Math.min(lines.length, start - 1 + count + 40);
  const code = lines.slice(from, to).map((line, index) => `${from + index + 1}: ${line}`).join('\n');
  return { code: code.slice(0, 18000), startLine: from + 1, endLine: to, truncated: code.length > 18000 };
}
export async function buildUnits(repo, base, head) {
  const raw = (await git(repo, 'diff', '--name-status', '-z', '--find-renames', base, head, '--')).split('\0');
  const units = [];
  for (let i = 0; i < raw.length && raw[i];) {
    const status = raw[i++];
    let oldPath = raw[i++];
    const path = /^[RC]/.test(status) ? raw[i++] : oldPath;
    const diff = await git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--unified=5', '--find-renames', base, head, '--', oldPath, ...(path !== oldPath ? [path] : []));
    let oldSource = '', newSource = '', readFailure = false;
    if (status !== 'A') { try { oldSource = await readSource(repo, base, oldPath); } catch { readFailure = true; } }
    if (status !== 'D') { try { newSource = await readSource(repo, head, path); } catch { readFailure = true; } }
    const parsed = parseHunks(diff);
    // Renames/binary/submodule changes remain visible, even without text hunks.
    for (const [index, hunk] of (parsed.length ? parsed : [null]).entries()) {
      const old = excerpt(oldSource, hunk?.oldStart || 1, hunk?.oldCount || 0);
      const current = excerpt(newSource, hunk?.newStart || 1, hunk?.newCount || 0);
      const unsupported = readFailure || (!parsed.length && !/^R100/.test(status));
      const chosenDiff = hunk?.diff || diff;
      units.push({
        id: createHash('sha256').update(`${path}:${index}:${base}:${head}`).digest('hex').slice(0, 16),
        path, oldPath, status, diff: chosenDiff.slice(0, 20000), oldCode: old.code, newCode: current.code,
        range: hunk, oldRange: old, newRange: current, unsupported,
        context: { related: [], warnings: unsupported ? ['Non-text change or source could not be read.'] : [], truncated: old.truncated || current.truncated || chosenDiff.length > 20000, scope: 'Changed hunk with surrounding committed source; not a complete runtime analysis.' },
      });
    }
  }
  return units;
}
