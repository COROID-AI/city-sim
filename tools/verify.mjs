#!/usr/bin/env node
/**
 * tools/verify.mjs — one-command acceptance verification for rocket-launch.html.
 *
 * DEV-ONLY. Runs both gates in order and exits non-zero if either fails:
 *   1. tools/verify-static.mjs   — structure/self-containment/fullscreen/no-UI/contract (no browser)
 *   2. tools/verify-browser.mjs  — live headless-Chromium run of the checkpoint matrix, which also
 *                                  emits tmp/verify/evidence.json (per-criterion live state + frames)
 *
 * Usage:
 *   node tools/verify.mjs            # static gate + full browser matrix
 *   node tools/verify.mjs --quick    # static gate + 5 checkpoints (fast smoke run)
 *   node tools/verify.mjs --mirror   # force the local-mirror mode of the browser gate
 *
 * Extra arguments are forwarded to the browser gate. `npm test` and `npm run verify` run this file.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const forwarded = process.argv.slice(2);

function gate(script, args) {
  console.log(`\n=== ${script} ${args.join(' ')}`.trimEnd());
  const res = spawnSync(process.execPath, [path.join(HERE, script), ...args], { stdio: 'inherit' });
  if (res.error) {
    console.log(`\n${script} could not run: ${res.error.message}`);
    return 1;
  }
  return res.status === null ? 1 : res.status;
}

const staticStatus = gate('verify-static.mjs', []);
// The deterministic gate is authoritative for structure; still run the render gate either way so a
// structural regression never hides a runtime one.
const browserStatus = gate('verify-browser.mjs', forwarded);

console.log('\nacceptance verification summary');
console.log(`  tools/verify-static.mjs  : ${staticStatus === 0 ? 'PASS' : `FAIL (exit ${staticStatus})`}`);
console.log(`  tools/verify-browser.mjs : ${browserStatus === 0 ? 'PASS' : `FAIL (exit ${browserStatus})`}`);
const failed = staticStatus !== 0 || browserStatus !== 0;
console.log(failed ? '  verdict: FAIL' : '  verdict: PASS');
process.exit(failed ? 1 : 0);
