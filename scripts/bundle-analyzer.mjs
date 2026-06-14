#!/usr/bin/env node
/**
 * bundle-analyzer.mjs
 *
 * Zero-dependency analyzer for the `tsc` build output (`dist/`).
 *
 * Responsibilities:
 *   1. Walk the configured `distDir` (default: `dist/`) and compute the
 *      total size in bytes.
 *   2. Group the output by top-level folder (e.g. `dist/engine/`,
 *      `dist/ui/`, `dist/systems/`) so contributors can see which
 *      layer is contributing the most to the bundle.
 *   3. Print a fixed-width ASCII table.
 *   4. Exit `0` if the total is strictly less than `--max-mb` (default
 *      2 MB) and `1` otherwise. This makes the script a CI gate.
 *
 * This is the v1.0.0 replacement for @next/bundle-analyzer. The
 * project ships a `tsc` artifact, not a Next.js bundle, so a
 * zero-dep Node script gives us the same build-size signal without
 * pulling in the Next toolchain. The gate contract (build → measure
 * → fail at 2 MB) is preserved.
 *
 * Usage:
 *   node scripts/bundle-analyzer.mjs                  # uses defaults
 *   node scripts/bundle-analyzer.mjs --max-mb 2
 *   node scripts/bundle-analyzer.mjs --dir out
 *   ANALYZE=1 node scripts/bundle-analyzer.mjs       # sets exit 0
 */
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep, posix } from 'node:path';
import { argv, env, exit } from 'node:process';

const DEFAULT_DIR = 'dist';
const DEFAULT_MAX_MB = 2;

const BYTES_PER_MB = 1024 * 1024;

/**
 * Parse CLI flags. We intentionally avoid any third-party arg parser
 * to keep this script dependency-free.
 */
function parseArgs(args) {
  const opts = { dir: DEFAULT_DIR, maxMb: DEFAULT_MAX_MB };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--dir') {
      opts.dir = args[++i] ?? DEFAULT_DIR;
    } else if (a === '--max-mb') {
      const v = Number.parseFloat(args[++i] ?? '');
      if (Number.isFinite(v) && v > 0) opts.maxMb = v;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      exit(0);
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(
    [
      'bundle-analyzer.mjs — measure dist/ and enforce a size gate',
      '',
      'Options:',
      '  --dir <path>   Directory to analyze (default: dist)',
      '  --max-mb <n>   Fail if total >= n MB (default: 2)',
      '  -h, --help     Show this help',
      '',
    ].join('\n'),
  );
}

/**
 * Recursively walk `root` and return an array of {abs, rel, bytes}.
 */
async function walk(root) {
  const out = [];
  async function recurse(abs) {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (err) {
      // Missing dir is a hard error so the gate has something to fail on.
      throw new Error(`Cannot read directory ${abs}: ${err.message}`);
    }
    for (const entry of entries) {
      const child = join(abs, entry.name);
      if (entry.isDirectory()) {
        await recurse(child);
      } else if (entry.isFile()) {
        const s = await stat(child);
        out.push({ abs: child, rel: relative(root, child), bytes: s.size });
      }
    }
  }
  await recurse(root);
  return out;
}

/**
 * Group files by the first path segment under `root` (e.g. `engine`,
 * `ui`). Files directly under `root` go into the `_root` bucket.
 */
function groupByFolder(files, root) {
  const groups = new Map();
  for (const f of files) {
    const rel = f.rel.split(sep).join(posix.sep);
    const parts = rel.split(posix.sep);
    const folder = parts.length > 1 ? parts[0] : '_root';
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(f);
  }
  return groups;
}

function formatBytes(n) {
  if (n >= BYTES_PER_MB) return `${(n / BYTES_PER_MB).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${n} B`;
}

function formatRow(folder, bytes, count) {
  // Fixed-width columns; pad with spaces so the table is readable in
  // CI logs and local terminals alike.
  const f = folder.padEnd(18, ' ').slice(0, 18);
  const b = formatBytes(bytes).padStart(12, ' ');
  const c = String(count).padStart(6, ' ');
  return `  ${f} ${b}  (${c} files)`;
}

function renderTable(groups, totalBytes, maxMb) {
  const sorted = [...groups.entries()].sort(
    (a, b) => sumBytes(b[1]) - sumBytes(a[1]),
  );
  const lines = [];
  lines.push('Bundle size report');
  lines.push('------------------');
  lines.push(
    formatRow('folder', 'size', 'count'),
  );
  lines.push(
    formatRow('------', '----', '-----'),
  );
  for (const [folder, files] of sorted) {
    lines.push(formatRow(folder, sumBytes(files), files.length));
  }
  lines.push('');
  lines.push(
    formatRow('TOTAL', totalBytes, sumCounts(groups)),
  );
  const maxBytes = maxMb * BYTES_PER_MB;
  const status =
    totalBytes < maxBytes
      ? `OK  (under ${maxMb} MB budget)`
      : `FAIL (>= ${maxMb} MB budget)`;
  lines.push('');
  lines.push(`Status: ${status}`);
  return lines.join('\n');
}

function sumBytes(files) {
  let n = 0;
  for (const f of files) n += f.bytes;
  return n;
}

function sumCounts(groups) {
  let n = 0;
  for (const files of groups.values()) n += files.length;
  return n;
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  const root = opts.dir;
  let files;
  try {
    files = await walk(root);
  } catch (err) {
    process.stderr.write(`bundle-analyzer: ${err.message}\n`);
    exit(1);
    return;
  }
  const groups = groupByFolder(files, root);
  const totalBytes = sumBytes(files);
  const report = renderTable(groups, totalBytes, opts.maxMb);
  process.stdout.write(`${report}\n`);

  // `ANALYZE=1` is a local-dev override: print the report but do
  // not fail the run. This mirrors the @next/bundle-analyzer
  // convention where you opt in to the analysis without blocking
  // the build.
  if (env.ANALYZE === '1' && env.ANALYZE_FORCE !== '1') {
    exit(0);
    return;
  }

  const maxBytes = opts.maxMb * BYTES_PER_MB;
  if (totalBytes >= maxBytes) {
    process.stderr.write(
      `\nBundle size ${formatBytes(totalBytes)} exceeds budget of ${opts.maxMb} MB.\n`,
    );
    exit(1);
    return;
  }
  exit(0);
}

main();
