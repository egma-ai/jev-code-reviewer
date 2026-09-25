import test from 'node:test';
import assert from 'node:assert/strict';
import { keySources, describeKeySource } from '../scripts/setup-keys.mjs';

test('key sources say where each key is without exposing values', () => {
  const [typesafe, openai] = keySources({ TYPESAFE_API_KEY: 'stored-ts' }, { OPENAI_API_KEY: 'env-oa' });
  assert.deepEqual(typesafe, { name: 'TYPESAFE_API_KEY', stored: true, environment: false, differ: false, used: 'stored' });
  assert.deepEqual(openai, { name: 'OPENAI_API_KEY', stored: false, environment: true, differ: false, used: 'environment' });
  assert.match(describeKeySource(openai), /only in this shell's environment, not stored/);
  assert.doesNotMatch(JSON.stringify([typesafe, openai]) + describeKeySource(typesafe) + describeKeySource(openai), /stored-ts|env-oa/);
});

test('stored keys win over a different exported value, and the difference is reported', () => {
  const [, openai] = keySources({ OPENAI_API_KEY: 'stored' }, { OPENAI_API_KEY: 'other' });
  assert.equal(openai.used, 'stored');
  assert.equal(openai.differ, true);
  assert.match(describeKeySource(openai), /different value, which is ignored/);
  const [, same] = keySources({ OPENAI_API_KEY: 'same' }, { OPENAI_API_KEY: ' same ' });
  assert.equal(same.differ, false);
});

test('missing and blank keys are reported as missing', () => {
  const entries = keySources({ TYPESAFE_API_KEY: '   ' }, {});
  assert.ok(entries.every((entry) => entry.used === null));
  assert.match(describeKeySource(entries[0]), /^missing/);
});
