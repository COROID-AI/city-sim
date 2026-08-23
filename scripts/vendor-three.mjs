/* Copies the exact installed three.js build into ./vendor/three so the
 * importmap serves byte-identical code to what package.json pins.
 *
 * Addresses the version-drift finding:
 *  - package.json pins three to an EXACT semver (no ^/~), so npm can never
 *    silently upgrade it;
 *  - this script (wired as the postinstall hook) re-copies whatever was
 *    actually installed into vendor/, so runtime always matches the lockfile;
 *  - the game imports zero three/examples/jsm modules, so addon path/layout
 *    changes across releases cannot break the bundle.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
/* three's "exports" map hides its package.json, so resolve the runtime entry
 * ("three" -> build/three.cjs) and walk up to the directory owning it. */
let root = path.dirname(require.resolve('three'));
let version = '';
for (let i = 0; i < 4 && !version; i++) {
  const p = path.join(root, 'package.json');
  if (fs.existsSync(p)) {
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (pkg.name === 'three') version = pkg.version;
    else root = path.dirname(root);
  } else {
    root = path.dirname(root);
  }
}
if (!version) throw new Error('could not locate installed three package');

const dst = path.join(process.cwd(), 'vendor', 'three');
fs.mkdirSync(dst, { recursive: true });

/* r181+ splits the build: three.module.min.js re-exports three.core.min.js,
 * so copy every local file it references, not just the entry module. */
const entry = fs.readFileSync(path.join(root, 'build', 'three.module.min.js'), 'utf8');
fs.copyFileSync(path.join(root, 'build', 'three.module.min.js'), path.join(dst, 'three.module.min.js'));
for (const m of entry.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
  const rel = m[1];
  const src = path.resolve(root, 'build', rel);
  if (!src.startsWith(path.join(root, 'build'))) continue;
  fs.copyFileSync(src, path.join(dst, path.basename(rel)));
}

const lic = path.join(root, 'LICENSE');
if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(dst, 'LICENSE.three'));

process.stdout.write(`vendored three@${version} -> vendor/three/\n`);
