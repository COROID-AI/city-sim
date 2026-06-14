/**
 * Tests for scripts/bundle-analyzer.mjs.
 *
 * We run the analyzer as a child process against a temporary `dist/`
 * tree so we can assert both the exit code and the printed table.
 *
 * Two scenarios are covered:
 *   1. Total <  budget → exit 0
 *   2. Total >= budget → exit 1
 *
 * A third scenario covers grouping: files directly under `dist/`
 * fall into the `_root` bucket, files under `dist/engine/` fall
 * into the `engine` bucket, etc.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'bundle-analyzer.mjs');

/**
 * Build a small directory tree under `root` with files of the given
 * byte sizes. Returns the root path.
 */
function buildTree(root, files) {
  for (const [rel, bytes] of files) {
    const full = join(root, rel);
    const dir = full.split(sep).slice(0, -1).join(sep);
    mkdirSync(dir, { recursive: true });
    writeFileSync(full, 'a'.repeat(bytes));
  }
  return root;
}

function runAnalyzer(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
  });
}

function freshTmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('bundle-analyzer.mjs', () => {
  test('exits 0 when total < budget', () => {
    const root = freshTmp('ba-ok-');
    // ~1 KB total, well under any sensible budget.
    buildTree(root, [
      ['engine/World.js', 500],
      ['ui/App.jsx', 400],
      ['index.js', 100],
    ]);
    const r = runAnalyzer(['--dir', root, '--max-mb', '2']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/engine/);
    expect(r.stdout).toMatch(/ui/);
    expect(r.stdout).toMatch(/_root/);
    expect(r.stdout).toMatch(/Status: OK/);
    rmSync(root, { recursive: true, force: true });
  });

  test('exits 1 when total >= budget', () => {
    const root = freshTmp('ba-fail-');
    // 3 MB of files; default budget is 2 MB.
    buildTree(root, [
      ['engine/World.js', 1024 * 1024],
      ['ui/App.jsx', 1024 * 1024],
      ['systems/Traffic.js', 1024 * 1024],
    ]);
    const r = runAnalyzer(['--dir', root, '--max-mb', '2']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/exceeds budget/);
    rmSync(root, { recursive: true, force: true });
  });

  test('respects a tiny --max-mb override', () => {
    const root = freshTmp('ba-tiny-');
    buildTree(root, [['index.js', 1024]]);
    const r = runAnalyzer(['--dir', root, '--max-mb', '0.0001']);
    expect(r.status).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });

  test('groups files by top-level folder', () => {
    const root = freshTmp('ba-group-');
    buildTree(root, [
      ['engine/World.js', 100],
      ['engine/Renderer.js', 200],
      ['systems/Time.js', 50],
      ['index.js', 25],
    ]);
    const r = runAnalyzer(['--dir', root, '--max-mb', '2']);
    expect(r.status).toBe(0);
    // Order is by descending size: engine (300), systems (50), _root (25).
    const lines = r.stdout.split('\n');
    const engineIdx = lines.findIndex((l) => l.includes('engine'));
    const systemsIdx = lines.findIndex((l) => l.includes('systems'));
    const rootIdx = lines.findIndex((l) => l.includes('_root'));
    expect(engineIdx).toBeLessThan(systemsIdx);
    expect(systemsIdx).toBeLessThan(rootIdx);
    rmSync(root, { recursive: true, force: true });
  });

  test('exits 1 with a clear error if the directory is missing', () => {
    const r = runAnalyzer(['--dir', '/no/such/path/xyz', '--max-mb', '2']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Cannot read directory/);
  });
});
