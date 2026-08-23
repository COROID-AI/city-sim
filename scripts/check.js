#!/usr/bin/env node
/**
 * Cheap verification for every later task:
 *   node --check (syntax) over every source module under src/.
 * Exit code 0 = all files parse as valid ES modules.
 *
 * Usage: node scripts/check.js
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (extname(full) === '.js') out.push(full);
  }
  return out;
}

/** Syntax-only parse via Node's module loader (import/export aware). */
function nodeCheck(file) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('node:child_process');
    const p = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || file))));
  });
}

const files = walk(SRC);
console.log(`[check] found ${files.length} src file(s)`);

let failed = 0;
for (const file of files) {
  try {
    await nodeCheck(file);
    console.log(`  ok ${file}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${file}\n    ${String(e.message).trim()}`);
  }
}
if (failed) {
  console.error(`[check] ${failed} file(s) failed`);
  process.exit(1);
}
console.log('[check] all src files parse as ES modules');