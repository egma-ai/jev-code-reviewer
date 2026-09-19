#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { setupKeys } from '../scripts/setup-keys.mjs';
import { loadPolicy, applyPolicy, writeJson, reportPath, digest, pairingToken } from '../src/config.mjs';
import { resolvePr, buildUnits } from '../src/git.mjs';
import { enrichContext } from '../src/context.mjs';
import { startServer } from '../src/server.mjs';

const usage = `Jev-Reviewer — behavior-first PR review

  jev-reviewer setup                     Enter missing Jev + OpenAI keys locally
  jev-reviewer analyze --pr URL          Analyze committed PR code with both providers
    --repo PATH                         Local clone (default: current directory)
    --policy FILE                       JSON priority rules (default: repo .jev-reviewer.json)
    --graphify / --no-graphify           Static context graph (default: on)
    --max-units N                       Bound provider calls (default: 12; excess stays visible)
    --output FILE                       Also write a report file (contains source excerpts)
  jev-reviewer serve [--port 4731]       Start the local extension bridge
  jev-reviewer demo [--port 4731]        Open the bundled recorded-demo URL
  jev-reviewer token                    Print the extension pairing token (not model keys)

Node 22+, git and gh are required. Graphify is optional but recommended.
Live analysis sends committed code context to TypeSafe and OpenAI.
`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    pr: { type: 'string' }, repo: { type: 'string' }, policy: { type: 'string' }, port: { type: 'string' },
    output: { type: 'string' }, 'max-units': { type: 'string' }, graphify: { type: 'boolean' }, 'no-graphify': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  const action = positionals[0];
  if (!action || values.help) return console.log(usage);
  if (action === 'setup') return setupKeys();
  if (action === 'token') return console.log(await pairingToken());
  if (action === 'serve' || action === 'demo') {
    const port = Number(values.port || 4731);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
    const server = await startServer({ port });
    console.log(`Jev-Reviewer is ready at http://127.0.0.1:${port}/demo`);
    console.log('Extension bridge is running. Pair using: jev-reviewer token');
    console.log('Demo is a labeled replay of a real Jev + OpenAI run. Ctrl+C to stop.');
    process.on('SIGINT', () => server.close(() => process.exit(0)));
    return;
  }
  if (action !== 'analyze') throw new Error(`Unknown command: ${action}`);
  const repo = resolve(values.repo || '.');
  const maxUnits = Number(values['max-units'] || 12);
  if (!Number.isInteger(maxUnits) || maxUnits < 1 || maxUnits > 100) throw new Error('--max-units must be 1–100.');
  const metadata = await resolvePr(repo, values.pr);
  const { repo: _, ...identity } = metadata;
  const policy = await loadPolicy(repo, values.policy && resolve(values.policy));
  const units = await buildUnits(repo, metadata.baseSha, metadata.headSha);
  console.log(`Reviewing ${metadata.repository} #${metadata.pullRequest}: ${units.length} change units at ${metadata.headSha.slice(0, 8)}.`);
  const context = await enrichContext(repo, metadata.headSha, units, { useGraphify: !values['no-graphify'], progress: console.log });
  console.log(`Graphify: ${context.graphify}. Running Jev classification and OpenAI explanations…`);
  const { analyzeWithProviders } = await import('../src/providers.mjs');
  const selected = units.slice(0, maxUnits);
  const generated = selected.length ? await analyzeWithProviders(selected, { policy }) : [];
  const byId = new Map(generated.map(change => [change.id, change]));
  if (generated.length !== selected.length || selected.some(unit => !byId.has(unit.id))) throw new Error('Provider results did not cover every requested unit. Existing report was not overwritten.');
  const changes = units.map(unit => {
    const result = byId.get(unit.id) || { id: unit.id, title: `Not analyzed: ${unit.path}`, priority: 'P0', oldLogic: 'Not analyzed.', newLogic: 'Not analyzed.', whatChanged: 'This change exceeded the configured analysis limit.', whyHumanReview: 'Inspect the original diff or rerun with a larger --max-units value.', signals: ['not_analyzed'], confidence: null };
    return {
      ...applyPolicy(result, unit, policy), files: [unit.path], diff: unit.diff,
      evidence: [
        { path: unit.oldPath, startLine: unit.oldRange.startLine, endLine: unit.oldRange.endLine, side: 'old', snippet: unit.oldCode },
        { path: unit.path, startLine: unit.newRange.startLine, endLine: unit.newRange.endLine, side: 'new', snippet: unit.newCode },
      ],
      contextWarnings: unit.context.warnings, graph: unit.context.graph,
    };
  });
  const report = { schemaVersion: 1, ...identity, generatedAt: new Date().toISOString(), mode: 'live',
    providers: { classifier: 'TypeSafe Jev', explanations: 'OpenAI' }, policyHash: digest(policy), display: policy.display,
    context, coverage: { total: units.length, analyzed: selected.length, unanalysed: units.length - selected.length }, changes,
  };
  const path = reportPath(metadata.repository, metadata.pullRequest);
  await writeJson(path, report);
  if (values.output) await writeJson(resolve(values.output), report);
  console.log(`Saved ${changes.length} cards (${changes.filter(x => x.priority === 'P0').length} P0, ${changes.filter(x => x.priority === 'P1').length} P1, ${changes.filter(x => x.priority === 'P2').length} P2).`);
  console.log(`Report: ${path}\nOpen ${metadata.url}/files with the extension and local server running.`);
}
main().catch(error => { console.error(`Jev-Reviewer: ${error.message}`); process.exitCode = 1; });
