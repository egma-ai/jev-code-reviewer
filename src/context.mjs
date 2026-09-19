import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { git, readSource, command } from './git.mjs';

const codeFile = /\.(?:[cm]?js|jsx|tsx?|py|go|rs|java|rb|c|h|cpp|cs|swift|kt|php|vue|svelte|sql)$/i;
const excluded = /(?:^|\/)(?:node_modules|vendor|dist|\.git|\.env[^/]*|credentials[^/]*)(?:\/|$)/;

export function graphifyEnvironment(source = process.env, isolatedHome) {
  const allowed = new Set([
    'PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'VIRTUAL_ENV', 'CONDA_PREFIX', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'PYTHONIOENCODING',
  ]);
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key.toUpperCase()) && typeof value === 'string') env[key] = value;
  }
  if (isolatedHome) {
    env.HOME = isolatedHome;
    env.USERPROFILE = isolatedHome;
    env.XDG_CONFIG_HOME = join(isolatedHome, '.config');
    env.XDG_CACHE_HOME = join(isolatedHome, '.cache');
  }
  env.GRAPHIFY_QUERY_LOG_DISABLE = '1';
  env.GRAPHIFY_MAX_WORKERS = '2';
  return env;
}

export function graphNeighbors(graph, changedPaths) {
  const nodes = graph.nodes || [];
  const edges = graph.links || graph.edges || [];
  const file = node => String(node.file || node.file_path || node.source_file || node.path || '').replaceAll('\\', '/');
  const changed = new Set(nodes.filter(node => changedPaths.some(path => file(node) === path || file(node).endsWith('/' + path))).map(node => String(node.id)));
  const ids = new Set();
  const selectedEdges = [];
  for (const edge of edges) {
    const source = String(typeof edge.source === 'object' ? edge.source.id : edge.source);
    const target = String(typeof edge.target === 'object' ? edge.target.id : edge.target);
    if (changed.has(source) || changed.has(target)) { ids.add(source); ids.add(target); selectedEdges.push(edge); }
  }
  return { nodes: nodes.filter(node => ids.has(String(node.id)) || changed.has(String(node.id))).slice(0, 40), edges: selectedEdges.slice(0, 60), totalNodes: nodes.length, totalEdges: edges.length, matchedNodes: changed.size };
}

export async function enrichContext(repo, headSha, units, { useGraphify = true, progress = () => {} } = {}) {
  const paths = (await git(repo, 'ls-tree', '-r', '--name-only', headSha)).trim().split('\n').filter(Boolean);
  // Fetch imports and test candidates from the same committed snapshot. This is a bounded heuristic.
  for (const unit of units) {
    const stem = unit.path.split('/').at(-1).replace(/\.[^.]+$/, '');
    const imports = [...unit.newCode.matchAll(/(?:from\s+|require\(|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
    const candidates = paths.filter(path => path !== unit.path && codeFile.test(path) && !excluded.test(path) && (
      ((/test|spec/.test(path)) && path.includes(stem)) || imports.some(name => {
        const clean = name.replace(/^(?:\.\.\/|\.\/)+/, '').replace(/\.[^.]+$/, '');
        return clean && (path.endsWith(clean + '.mjs') || path.endsWith(clean + '.js') || path.endsWith(clean + '.ts') || path.endsWith(clean + '.py'));
      })
    )).slice(0, 3);
    for (const path of candidates) {
      try { const code = await readSource(repo, headSha, path); unit.context.related.push({ path, code: code.slice(0, 5000), truncated: code.length > 5000 }); }
      catch { unit.context.warnings.push(`Related source unavailable: ${path}`); }
    }
  }
  if (!useGraphify) return { graphify: 'disabled', note: 'Source context only; no graph was generated.' };
  const snapshot = await mkdtemp(join(tmpdir(), 'jev-graph-'));
  try {
    progress('Building local Graphify context from the committed head…');
    const tree = (await git(repo, 'ls-tree', '-rz', headSha)).split('\0').filter(Boolean);
    let files = 0, bytes = 0, skipped = 0;
    for (const entry of tree) {
      const match = /^(\d+) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
      if (!match || !['100644', '100755'].includes(match[1])) continue;
      const path = match[3];
      if (!codeFile.test(path) || excluded.test(path)) continue;
      if (path.split('/').some(part => part === '..') || path.startsWith('/')) continue;
      if (files >= 500 || bytes > 5_000_000) { skipped++; continue; }
      const source = await readSource(repo, headSha, path);
      if (source.length > 300000) { skipped++; continue; }
      await mkdir(dirname(join(snapshot, path)), { recursive: true });
      await writeFile(join(snapshot, path), source);
      files++; bytes += source.length;
    }
    // Graphify's code-only mode is AST-based. Run from the isolated committed snapshot and
    // pass an allowlisted environment so unrelated repository files and credentials stay out.
    await command('graphify', ['extract', '.', '--code-only', '--no-cluster', '--max-workers', '2'], snapshot, {
      env: graphifyEnvironment(process.env, snapshot), timeout: 180000,
    });
    let graph;
    for (const filename of ['graphify-out/graph.json', 'graphify-out/extraction.json', '.graphify_extraction.json']) {
      try { graph = JSON.parse(await readFile(join(snapshot, filename), 'utf8')); break; } catch {}
    }
    if (!graph) throw new Error('Graphify did not produce a supported graph JSON.');
    // Normalize absolute snapshot paths and ensure the report does not retain temporary paths.
    const portable = JSON.parse(JSON.stringify(graph).split(snapshot + '/').join(''));
    for (const unit of units) {
      unit.context.graph = graphNeighbors(portable, [unit.path]);
      unit.context.graph.snapshot = headSha;
      unit.context.graph.scope = 'Head snapshot only; static relationships, not proof of runtime impact.';
      const graphFiles = [...new Set(unit.context.graph.nodes.map(node => node.file || node.file_path || node.source_file || node.path).filter(path => typeof path === 'string' && paths.includes(path) && path !== unit.path))].slice(0, 2);
      for (const path of graphFiles) {
        if (unit.context.related.some(item => item.path === path)) continue;
        try { const source = await readSource(repo, headSha, path); unit.context.related.push({ path, code: source.slice(0, 4000), truncated: source.length > 4000 }); } catch {}
      }
    }
    return { graphify: 'available', files, skipped, nodes: portable.nodes?.length || 0, edges: (portable.links || portable.edges || []).length, snapshot: headSha, note: 'Bounded static graph of head; missing dynamic/external dependencies remain unknown.' };
  } catch (error) {
    for (const unit of units) unit.context.warnings.push('Graphify context unavailable; using committed source and heuristic related files.');
    return { graphify: 'unavailable', note: error.message };
  } finally { await rm(snapshot, { recursive: true, force: true }); }
}
