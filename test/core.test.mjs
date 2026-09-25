import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rename, unlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { applyPolicy, reportPath, writeJson } from '../src/config.mjs';
import { buildUnits, parsePr, readSource } from '../src/git.mjs';
import { graphifyEnvironment } from '../src/context.mjs';
import { startServer } from '../src/server.mjs';

const execute = promisify(execFile);

async function git(repo, ...args) {
  return (await execute('git', args, { cwd: repo })).stdout.trim();
}

async function committedFixture(t) {
  const repo = await mkdtemp(join(tmpdir(), 'jev-reviewer-git-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await git(repo, 'init', '--quiet');
  await git(repo, 'config', 'user.name', 'Jev Reviewer Test');
  await git(repo, 'config', 'user.email', 'jev-reviewer-test@example.invalid');
  await mkdir(join(repo, 'src'), { recursive: true });

  const baseLines = Array.from({ length: 80 }, (_, index) => `export const line${index + 1} = ${index + 1};`);
  baseLines[4] = 'export const firstBehavior = "base-first";';
  baseLines[69] = 'export const secondBehavior = "base-second";';
  await writeFile(join(repo, 'src/logic.mjs'), `${baseLines.join('\n')}\n`);
  await writeFile(join(repo, 'src/remove.mjs'), 'export const removed = "base-only";\n');
  await writeFile(join(repo, 'src/rename-old.mjs'), 'export const stableRename = true;\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '--quiet', '-m', 'base');
  const base = await git(repo, 'rev-parse', 'HEAD');

  const headLines = [...baseLines];
  headLines[4] = 'export const firstBehavior = "head-first";';
  headLines[69] = 'export const secondBehavior = "head-second";';
  await writeFile(join(repo, 'src/logic.mjs'), `${headLines.join('\n')}\n`);
  await writeFile(join(repo, 'src/add.mjs'), 'export const added = "head-only";\n');
  await unlink(join(repo, 'src/remove.mjs'));
  await rename(join(repo, 'src/rename-old.mjs'), join(repo, 'src/rename-new.mjs'));
  await git(repo, 'add', '--all');
  await git(repo, 'commit', '--quiet', '-m', 'head');
  const head = await git(repo, 'rev-parse', 'HEAD');

  // These uncommitted values must never enter analysis built for base..head.
  await writeFile(join(repo, 'src/logic.mjs'), 'WORKTREE_ONLY_SECRET\n');
  await writeFile(join(repo, 'src/rename-new.mjs'), 'WORKTREE_RENAME_SECRET\n');
  return { repo, base, head };
}

test('PR parsing accepts canonical GitHub URLs and rejects ambiguous numbers', () => {
  assert.deepEqual(parsePr('https://github.com/Owner/Repo/pull/42/files?diff=split'), {
    repository: 'Owner/Repo',
    number: 42,
    url: 'https://github.com/Owner/Repo/pull/42',
  });
  assert.throws(() => parsePr('42'), /full https:\/\/github\.com/);
});

test('buildUnits reads old and new committed refs for additions, deletions, renames, and separate hunks', async (t) => {
  const { repo, base, head } = await committedFixture(t);
  assert.match(await readSource(repo, base, 'src/logic.mjs'), /base-first/);
  assert.match(await readSource(repo, head, 'src/logic.mjs'), /head-first/);

  const units = await buildUnits(repo, base, head);
  const modified = units.filter((unit) => unit.path === 'src/logic.mjs');
  assert.equal(modified.length, 2, 'distant edits should remain separate review hunks');
  assert.ok(modified.some((unit) => unit.oldCode.includes('base-first') && unit.newCode.includes('head-first')));
  assert.ok(modified.some((unit) => unit.oldCode.includes('base-second') && unit.newCode.includes('head-second')));

  const added = units.find((unit) => unit.path === 'src/add.mjs');
  assert.equal(added.status, 'A');
  assert.match(added.newCode, /head-only/);
  assert.doesNotMatch(added.oldCode, /head-only/);

  const deleted = units.find((unit) => unit.path === 'src/remove.mjs');
  assert.equal(deleted.status, 'D');
  assert.match(deleted.oldCode, /base-only/);
  assert.doesNotMatch(deleted.newCode, /base-only/);

  const renamed = units.find((unit) => unit.path === 'src/rename-new.mjs');
  assert.match(renamed.status, /^R100$/);
  assert.equal(renamed.oldPath, 'src/rename-old.mjs');
  assert.match(renamed.oldCode, /stableRename/);
  assert.match(renamed.newCode, /stableRename/);
  assert.equal(renamed.unsupported, false);

  for (const unit of units) {
    assert.doesNotMatch(unit.oldCode, /WORKTREE_/);
    assert.doesNotMatch(unit.newCode, /WORKTREE_/);
  }
});

test('policy forces configured paths to P0 and escalates incomplete context', () => {
  const policy = {
    uncertainPriority: 'P1',
    alwaysReviewPaths: ['**/auth/**', '**/migrations/**'],
  };
  const ordinary = { path: 'src/feature.mjs', oldPath: 'src/feature.mjs', unsupported: false, context: { truncated: false } };
  const auth = { ...ordinary, path: 'src/auth/session.mjs', oldPath: 'src/auth/session.mjs' };
  const renamedMigration = { ...ordinary, path: 'src/schema/new.sql', oldPath: 'src/migrations/old.sql' };

  const forced = applyPolicy({ priority: 'P2' }, auth, policy);
  assert.equal(forced.priority, 'P0');
  assert.equal(forced.modelPriority, 'P2');
  assert.match(forced.policyReasons.join(' '), /always-review path/);
  assert.equal(applyPolicy({ priority: 'P2' }, renamedMigration, policy).priority, 'P0');

  assert.equal(applyPolicy({ priority: 'P2' }, { ...ordinary, unsupported: true }, policy).priority, 'P1');
  assert.equal(applyPolicy({ priority: 'P2' }, { ...ordinary, context: { truncated: true } }, policy).priority, 'P1');
  assert.equal(applyPolicy({ priority: 'unknown' }, ordinary, policy).priority, 'P1');
  assert.equal(applyPolicy({ priority: 'P2', providerMetadata: { jev: { contextTruncated: true } } }, ordinary, policy).priority, 'P1');
  assert.equal(applyPolicy({ priority: 'P0', modelPriority: 'P2' }, ordinary, policy).modelPriority, 'P2');
  assert.equal(applyPolicy(
    { priority: 'P2' },
    { ...ordinary, unsupported: true },
    { ...policy, uncertainPriority: 'P0' },
  ).priority, 'P0');
});

test('Graphify receives an allowlisted environment without provider or unrelated process secrets', () => {
  const env = graphifyEnvironment({
    PATH: '/test/bin',
    HOME: '/test/home',
    OPENAI_API_KEY: 'not-a-real-key',
    TYPESAFE_API_KEY: 'not-a-real-key',
    AWS_SESSION_TOKEN: 'not-a-real-token',
    DATABASE_URL: 'postgres://not-real',
    NODE_OPTIONS: '--require ./untrusted-hook.cjs',
  }, '/isolated/home');
  assert.equal(env.PATH, '/test/bin');
  assert.equal(env.HOME, '/isolated/home');
  assert.equal(env.USERPROFILE, '/isolated/home');
  assert.equal(env.XDG_CONFIG_HOME, '/isolated/home/.config');
  assert.equal(env.GRAPHIFY_QUERY_LOG_DISABLE, '1');
  assert.equal(env.GRAPHIFY_MAX_WORKERS, '2');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.TYPESAFE_API_KEY, undefined);
  assert.equal(env.AWS_SESSION_TOKEN, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
});

function request(server, path, { method = 'GET', headers = {} } = {}) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (incoming) => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk) => { body += chunk; });
      incoming.on('end', () => {
        let parsed = body;
        try { parsed = JSON.parse(body); } catch {}
        resolve({ status: incoming.statusCode, headers: incoming.headers, body: parsed });
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('local report server enforces token, host, origin, route, method, and cached identity', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jev-reviewer-server-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const demoPath = join(directory, 'demo.json');
  await writeFile(demoPath, JSON.stringify({ repository: 'public/example', pullRequest: 1, changes: [] }));
  const expected = { repository: 'Owner/Repo', pullRequest: 7, headSha: 'a'.repeat(40), changes: [] };
  const path = reportPath(expected.repository, expected.pullRequest, directory);
  await writeJson(path, expected);
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o077, 0, 'cached reports must not be group/world readable');
    assert.equal((await stat(dirname(path))).mode & 0o077, 0, 'report directory must not be group/world accessible');
  }

  const token = 'local-test-pairing-token';
  const authorization = { Authorization: `Bearer ${token}` };
  const server = await startServer({ port: 0, token, directory, demoPath });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  assert.equal((await request(server, '/health')).status, 200);
  const replay = await request(server, '/api/demo');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.mode, 'replay');
  assert.equal((await request(server, '/api/reviews/public/example/1')).status, 401);
  const extensionReplay = await request(server, '/api/reviews/public/example/1', { headers: authorization });
  assert.equal(extensionReplay.status, 200);
  assert.equal(extensionReplay.body.mode, 'replay');
  assert.equal(extensionReplay.body.repository, 'public/example');
  await assert.rejects(
    stat(reportPath('public/example', 1, directory)),
    (error) => error.code === 'ENOENT',
    'replay fallback must not create or replace a live cache file',
  );
  assert.equal((await request(server, '/api/reviews/public/example/2', { headers: authorization })).status, 404);

  assert.equal((await request(server, '/api/reviews/Owner/Repo/7')).status, 401);
  assert.equal((await request(server, '/api/reviews/Owner/Repo/7', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await request(server, '/api/pairing')).status, 401, 'the pairing check requires the token');
  assert.equal((await request(server, '/api/pairing', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const pairing = await request(server, '/api/pairing', { headers: authorization });
  assert.equal(pairing.status, 200);
  assert.deepEqual(pairing.body, { paired: true });

  const allowedOrigin = `chrome-extension://${'a'.repeat(32)}`;
  const accepted = await request(server, '/api/reviews/Owner/Repo/7', {
    headers: { ...authorization, Origin: allowedOrigin },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.headSha, expected.headSha);
  assert.equal(accepted.headers['access-control-allow-origin'], allowedOrigin);

  assert.equal((await request(server, '/api/reviews/Owner/Repo/7', {
    headers: { ...authorization, Origin: 'https://attacker.example' },
  })).status, 403);
  assert.equal((await request(server, '/api/reviews/Owner/Repo/7', {
    headers: { ...authorization, Host: 'attacker.example' },
  })).status, 403);
  assert.equal((await request(server, '/api/reviews/Owner/Repo/7', {
    method: 'POST', headers: authorization,
  })).status, 405);
  assert.equal((await request(server, '/api/reviews/Owner/Repo/7/../../../../etc/passwd', {
    headers: authorization,
  })).status, 404);
  assert.equal((await request(server, '/api/reviews/Owner%2F..%2Fetc/Repo/7', {
    headers: authorization,
  })).status, 404);

  const preflight = await request(server, '/api/reviews/Owner/Repo/7', {
    method: 'OPTIONS', headers: { Origin: allowedOrigin },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-methods'], 'GET');

  await writeJson(path, { ...expected, repository: 'Other/Repo' });
  const mismatch = await request(server, '/api/reviews/Owner/Repo/7', { headers: authorization });
  assert.equal(mismatch.status, 500);
  assert.deepEqual(mismatch.body, { error: 'Could not load the local report.' });
  assert.doesNotMatch(JSON.stringify(mismatch.body), /Other\/Repo/);
});
