/* ===========================================================================
   Offline structural conformance check for the single-file rocket launch scene.

   No browser, no network. Reads index.html and verifies the delivery contract:
     - exactly one self-contained product file, no build tooling, no assets
     - the only external URLs are the pinned Three.js CDN module and its
       documented fallback host
     - r160 colour pipeline (SRGB output + ACES tone mapping), no removed APIs
     - every planned subsystem is present
     - no overlay UI / text / HUD, full-bleed CSS, auto-start, debug hook
   Exits non-zero with a per-assertion report on any failure.
   =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { Verifier, ROOT, INDEX_PATH, THREE_CDN, THREE_FALLBACK, THREE_HOSTS } from './lib/harness.mjs';

const v = new Verifier('verify-static');

/* --------------------------------------------------------------------------
   1. Single-file / no-build delivery
   -------------------------------------------------------------------------- */
if (!v.ok('index.html exists at the repository root', fs.existsSync(INDEX_PATH), INDEX_PATH)) v.finish();
const html = fs.readFileSync(INDEX_PATH, 'utf8');
v.ok('index.html is non-trivial (> 40 KB of source)', html.length > 40000, `${html.length} bytes`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(path.relative(ROOT, p));
  }
  return out;
}
const files = walk(ROOT);
v.info('repository files: ' + files.join(', '));

const rootFiles = files.filter(f => !f.includes(path.sep));
v.ok('exactly one HTML product file at the root', rootFiles.filter(f => f.endsWith('.html')).length === 1,
  rootFiles.filter(f => f.endsWith('.html')).join(', '));

const forbiddenBuild = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'tsconfig.json',
  'vite.config.js', 'vite.config.ts', 'webpack.config.js', 'rollup.config.js', 'esbuild.config.js',
  'parcel.json', 'babel.config.js', '.babelrc', 'Makefile', 'Dockerfile', 'netlify.toml', 'vercel.json'];
const presentBuild = files.filter(f => forbiddenBuild.includes(path.basename(f)));
v.ok('no build tooling / manifests / bundler configs were added', presentBuild.length === 0, presentBuild.join(', '));

const assetExt = ['.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.glb', '.gltf', '.fbx', '.obj',
  '.mp3', '.wav', '.ogg', '.woff', '.woff2', '.ttf', '.dds', '.ktx', '.bin'];
const assets = files.filter(f => assetExt.includes(path.extname(f).toLowerCase()));
v.ok('no external asset files (textures, models, audio, fonts) exist', assets.length === 0, assets.join(', '));

const strayJs = files.filter(f => ['.js', '.mjs', '.cjs'].includes(path.extname(f)) && !f.startsWith('tests' + path.sep));
v.ok('no extra JavaScript source files outside the test suite', strayJs.length === 0, strayJs.join(', '));

/* --------------------------------------------------------------------------
   2. Network surface: the Three.js CDN module is the only external dependency
   -------------------------------------------------------------------------- */
const urls = Array.from(new Set((html.match(/https?:\/\/[^\s"'`)<>\\]+/g) || [])));
v.info('URL literals: ' + (urls.length ? urls.join(' | ') : '(none)'));
const allowed = new Set([THREE_CDN, THREE_FALLBACK]);
const badUrls = urls.filter(u => !allowed.has(u.replace(/[.,;]$/, '')));
v.ok('every http(s) URL is the pinned Three.js CDN module or its documented fallback',
  badUrls.length === 0, badUrls.join(', '));
v.ok('the pinned module URL is present', html.includes(THREE_CDN));
v.ok('a second-CDN fallback import is present', html.includes(THREE_FALLBACK));
v.ok('the pinned version is r160', /three@0\.160\.0/.test(html));

v.ok('an import map maps the bare specifier "three"',
  /<script[^>]*type=["']importmap["'][^>]*>[\s\S]*?"three"\s*:/.test(html));
v.ok('Three.js is loaded as an ES module (not the removed UMD build)',
  /<script[^>]*type=["']module["']/.test(html) && /import\(/.test(html));
v.ok('no removed/deprecated Three.js API usage (outputEncoding, sRGBEncoding, three.min.js)',
  !/outputEncoding|sRGBEncoding|three(\.min)?\.js/.test(html));

const localRefs = html.match(/(?:src|href)\s*=\s*["'][^"'>]+["']/g) || [];
const localAssetRefs = localRefs.filter(r => !/https?:/.test(r));
v.ok('no local stylesheet/script/asset references', localAssetRefs.length === 0, localAssetRefs.join(', '));
v.ok('no CSS url() asset references', !/url\(\s*['"]?(?!data:)[^)'"]+['"]?\s*\)/.test(html));

/* --------------------------------------------------------------------------
   3. Subsystem markers
   -------------------------------------------------------------------------- */
const markers = {
  'renderer + sRGB colour pipeline': /WebGLRenderer[\s\S]{0,600}?outputColorSpace\s*=\s*THREE\.SRGBColorSpace/,
  'ACES filmic tone mapping': /\.ACESFilmicToneMapping/,
  'soft shadow maps': /PCFSoftShadowMap/,
  'adaptive pixel ratio / quality scaling': /adaptQuality|renderScale/,
  'post-processing render targets': /WebGLRenderTarget/,
  'bloom bright-pass + blur chain': /brightMat|blurMaterial/,
  'heat-shimmer composite': /uHeat|heat shimmer/i,
  'bright sky dome shader': /SphereGeometry\(14000|uHorizon/,
  'exponential haze fog': /FogExp2/,
  'layered colourful terrain': /terrainHeight|buildTerrain/,
  'distant hills': /hillGeo/,
  'layered clouds': /CLOUD_LAYERS/,
  'launch pad + flame trench': /buildPad|flame trench/i,
  'service gantry / support tower': /buildGantry/,
  'swing arms': /swingArms/,
  'hold-down clamps': /buildHoldDownClamp/,
  'support equipment (tanks, pipes, masts, barriers)': /buildSupport|barriers/,
  'hero rocket geometry': /buildRocket/,
  'rocket nose cone (lathe)': /LatheGeometry/,
  'rocket fins (extrude)': /ExtrudeGeometry/,
  'rocket greebles': /greebles/,
  'engine bells': /bellGeo|engine bells/i,
  'multi-layer flames': /FLAME_LAYERS/,
  'dynamic exhaust plume': /flamePlume|plumeLenAt/,
  'thrust-driven engine light': /engineLight/,
  'ground smoke / dust systems': /makeSmokeSystem/,
  'post-liftoff smoke trail': /smokeTrail/,
  'sparks / embers / debris': /makeSparkSystem[\s\S]*?uGravity/,
  'grass + vegetation reaction': /buildVegetation|aOrigin/,
  'loose objects blown by exhaust': /animProps\.loose/,
  'warning lights / beacons': /beacons/,
  'deterministic timeline': /const T = \{[\s\S]{0,200}?ignite:[\s\S]{0,600}?liftoff:/,
  'clamp release before liftoff': /release:\s*9\.6[\s\S]{0,200}liftoff:\s*10\.0/,
  'cinematic camera rig': /updateCamera|cameraParams/,
  'bounded camera shake': /shakeAmpAt/,
  'optional drag-orbit / wheel zoom': /pointerdown[\s\S]*?addEventListener\('wheel'/,
  'instanced / pooled geometry': /InstancedMesh|InstancedBufferGeometry/,
  'procedural canvas textures': /CanvasTexture/,
  'debug hook window.__LAUNCH__': /window\.__LAUNCH__\s*=/,
  'debug hook API (seek/sample/setQuality/restart)': /LAUNCH\.seek\s*=/,
  'debug hook API (sample)': /LAUNCH\.sample\s*=/,
  'debug hook API (restart)': /LAUNCH\.restart\s*=/,
  'debug hook API (setQuality)': /LAUNCH\.setQuality\s*=/
};
for (const [label, re] of Object.entries(markers)) {
  v.ok('subsystem present: ' + label, re.test(html));
}

/* --------------------------------------------------------------------------
   4. No overlay UI, no text, no extra DOM
   -------------------------------------------------------------------------- */
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (!v.ok('<body> block is present', !!bodyMatch)) v.finish();
// strip script blocks (module + import map) and comments; nothing visible may remain
const withoutScripts = bodyMatch[1]
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const remaining = withoutScripts.replace(/<canvas[^>]*>\s*<\/canvas>/i, '').trim();
v.ok('body contains only the scene canvas (no textual or UI markup)', remaining.length === 0,
  'leftover markup: ' + remaining.slice(0, 160));

const forbiddenTags = ['button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'label', 'menu', 'nav',
  'header', 'footer', 'ul', 'ol', 'li', 'input', 'select', 'textarea', 'a', 'table', 'div', 'img', 'video',
  'audio', 'canvas id="hud"', 'svg'];
const foundTags = forbiddenTags.filter(t => new RegExp('<' + t + '[\\s>]', 'i').test(html));
v.ok('no overlay UI elements anywhere in the document', foundTags.length === 0, foundTags.join(', '));
v.ok('no innerHTML / DOM text injection', !/innerHTML|outerHTML|document\.write/.test(html));
v.ok('no aria/HUD roles or screen-reader labels', !/role\s*=|aria-label|tabindex/.test(html));

/* --------------------------------------------------------------------------
   5. Full-bleed viewport CSS
   -------------------------------------------------------------------------- */
v.ok('html/body reset to zero margin and padding',
  /html,\s*body\s*\{[^}]*margin:\s*0[^}]*padding:\s*0/.test(html));
v.ok('document overflow is hidden (no scrollbars or unused area)', /overflow:\s*hidden/.test(html));
v.ok('body pinned to the viewport', /body\s*\{[^}]*position:\s*fixed/.test(html));
v.ok('canvas fills 100% width and height',
  /canvas#stage\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s.test(html));
v.ok('canvas fixed at offset 0 with no border', /canvas#stage\s*\{[^}]*position:\s*fixed/.test(html)
  && /canvas#stage\s*\{[^}]*border:\s*0/.test(html));
v.ok('full-bleed resize handling present',
  /window\.addEventListener\('resize', resize\)/.test(html) && /renderer\.setSize\(viewW, viewH, false\)/.test(html));

/* --------------------------------------------------------------------------
   6. Auto-start and the non-visual debug hook
   -------------------------------------------------------------------------- */
v.ok('the animation starts on load without user input', /requestAnimationFrame\(frame\)/.test(html));
v.ok('no click/keypress gate delays the start', !/addEventListener\(\s*['"](click|keydown|keypress|touchstart)['"]/.test(html));
v.ok('no autoplay/audio or external runtime dependency', !/new Audio|AudioContext|XMLHttpRequest/.test(html));
v.ok('the debug hook is a plain JS global (no DOM output)', /const LAUNCH = \{\};/.test(html));

v.finish();
