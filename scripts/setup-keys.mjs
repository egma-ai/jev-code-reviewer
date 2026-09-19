#!/usr/bin/env node
// Run this in your own terminal. Key values are never printed or sent to the agent.
import { mkdir, readFile, writeFile, rename, chmod, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const credentialsPath = join(homedir(), '.config', 'jev-reviewer', 'credentials.json');

export async function loadCredentials(path = credentialsPath) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    // Do not include parser messages: they can contain parts of a key.
    throw new Error('Could not read the local credentials file. Check its JSON format locally.');
  }
}

export async function saveCredentials(values, path = credentialsPath) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Credentials directory must not be a symlink.');
  await chmod(directory, 0o700);
  const temporary = join(directory, `.credentials-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(values, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

export function readSecret(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run setup in an interactive terminal; do not paste keys into chat or command arguments.');
  }
  return new Promise((accept, reject) => {
    let value = '';
    const previousRaw = process.stdin.isRaw;
    process.stdout.write(label);
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(previousRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else accept(value.trim());
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') return finish(new Error('Setup cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ' && character !== '\u001b') value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

export async function setupKeys({ replaceOpenAI = process.argv.includes('--replace-openai') } = {}) {
  const existing = await loadCredentials();
  const updated = { ...existing };
  let changed = false;
  console.log('Jev-Reviewer key setup. Input is hidden. Keys are stored outside the repository.');
  for (const [name, label] of [
    ['TYPESAFE_API_KEY', 'Jev / TypeSafe API key'],
    ['OPENAI_API_KEY', 'OpenAI API key'],
  ]) {
    if (!(replaceOpenAI && name === 'OPENAI_API_KEY') && (process.env[name]?.trim() || (typeof existing[name] === 'string' && existing[name].trim()))) {
      console.log(`${label}: already configured (value hidden).`);
      continue;
    }
    const value = await readSecret(`${label} (paste, then Enter): `);
    if (!value) throw new Error(`${label} was empty. Run setup again when ready.`);
    updated[name] = value;
    changed = true;
  }
  if (changed) await saveCredentials(updated);
  console.log('Both keys are configured. API access has not yet been tested.');
  if (changed) console.log(`Saved to ${credentialsPath} (owner-only file permissions; not encrypted).`);
  console.log('You can now tell the agent: keys are ready. Do not send the key values.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  setupKeys().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
