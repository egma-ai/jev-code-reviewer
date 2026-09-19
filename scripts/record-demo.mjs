#!/usr/bin/env node
// Explicit developer utility: only the project's public demo PR may be bundled.
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { resolvePr, buildUnits } from '../src/git.mjs';
import { enrichContext } from '../src/context.mjs';
import { classifyWithJev, explainWithOpenAI } from '../src/providers.mjs';
import { ROOT, readJson, writeJson, loadPolicy, applyPolicy, digest, reportPath } from '../src/config.mjs';

async function main() {
  const {values}=parseArgs({options:{repo:{type:'string'},pr:{type:'string'},prepared:{type:'boolean'}}});
  const metadata=await resolvePr(resolve(values.repo || ROOT),values.pr || 'https://github.com/egma-ai/jev-reviewer/pull/1');
  if(metadata.repository.toLowerCase()!=='egma-ai/jev-reviewer') throw new Error('Only the public Jev-Reviewer demonstration repository can be bundled.');
  const units=await buildUnits(metadata.repo,metadata.baseSha,metadata.headSha);
  if(units.some(unit=>!unit.path.startsWith('examples/demo-app/'))) throw new Error('Demo PR must modify only examples/demo-app/.');
  const policy=await loadPolicy(metadata.repo);
  const context=await enrichContext(metadata.repo,metadata.headSha,units,{progress:console.log});
  const prepared=await readJson(join(ROOT,'demo/prepared-explanations.json'));
  const changes=[];
  for(const unit of units){
    console.log(`Calling Jev for ${unit.path}…`);
    const classification=await classifyWithJev(unit,{policy});
    const explanation=values.prepared ? prepared[unit.path] : await explainWithOpenAI(unit,{policy});
    if(!explanation) throw new Error('Missing prepared explanation.');
    changes.push({...applyPolicy({...explanation,...classification,id:unit.id,providerMetadata:{...explanation.providerMetadata,...classification.providerMetadata},signals:[...(explanation.signals || []),...(classification.signals || [])]},unit,policy),
      files:[unit.path],diff:unit.diff,
      evidence:[{path:unit.oldPath,side:'old',startLine:unit.oldRange.startLine,endLine:unit.oldRange.endLine,snippet:unit.oldCode},{path:unit.path,side:'new',startLine:unit.newRange.startLine,endLine:unit.newRange.endLine,snippet:unit.newCode}],
      contextWarnings:unit.context.warnings,graph:unit.context.graph,
    });
  }
  const {repo:_,...identity}=metadata;
  const report={schemaVersion:1,...identity,generatedAt:new Date().toISOString(),mode:'replay',
    providers:{classifier:'TypeSafe Jev (recorded live API results)',explanations:values.prepared?'Prepared demonstration copy — not an OpenAI API result':'OpenAI (recorded live API results)'},
    provenance:{classification:'live-typesafe-api',explanations:values.prepared?'prepared-copy':'live-openai-api',note:values.prepared?'These priorities are recorded Jev results. The explanation text was prepared for this demo; it is not a live OpenAI API result.':'Both providers called live on the source revisions recorded in this report.'},
    policyHash:digest(policy),display:policy.display,context,coverage:{total:units.length,analyzed:units.length,unanalysed:0},changes};
  await writeJson(join(ROOT,'demo/report.json'),report);
  await writeJson(reportPath(metadata.repository,metadata.pullRequest),report);
  console.log(`Recorded ${changes.length} cards: ${changes.map(change=>change.priority).join(', ')}. Explanation provenance: ${report.provenance.explanations}.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
