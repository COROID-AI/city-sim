#!/usr/bin/env node
/**
 * Dependency-free verification harness for the pelican-riding scene.
 *
 * Covers acceptance criteria AC1-AC6:
 *   A. self-containment: index.html references no external URLs, src,
 *      @import, <link>, or network APIs (AC3)
 *   B. two headless Chromium --dump-dom runs at different virtual-time
 *      budgets parse the page's data-* diagnostic probes: frames
 *      strictly increase, the sampled wheel angle advances,
 *      data-motion='moving', data-errors='0', the pelican and bicycle
 *      render at non-trivial widths, and the event-driven #selftest
 *      bell check reports 'passed' (AC1, AC2, AC4, AC5)
 *   C. two time-separated --screenshot captures produce valid PNGs with
 *      differing SHA-256 hashes, proving the view animates over time (AC2)
 *
 * Only Node built-ins are used. Chromium is probed before driving it and
 * failures print the captured stderr for diagnosis.
 *
 * Usage: node scripts/verify.mjs
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "index.html");
const artifactDir = path.join(root, "tmp", "verify-artifacts");

const DUMP_BUDGET_EARLY = 500;
const DUMP_BUDGET_LATE = 2500;
const SHOT_BUDGET_EARLY = 600;
const SHOT_BUDGET_LATE = 2400;
const MIN_PELICAN_W = 150;
const MIN_BICYCLE_W = 250;
const RUN_TIMEOUT_MS = 60000;

let failures = 0;

function report(name, ok, detail) {
  const line = detail ? `${name} — ${detail}` : name;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${line}`);
  if (!ok) failures += 1;
}

/** Locate a usable Chromium-family binary. */
function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "chromium",
    "chromium-browser",
    "google-chrome-stable",
    "google-chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 15000 });
    if (probe.status === 0) {
      return { bin: candidate, version: (probe.stdout || "").trim() };
    }
  }
  return null;
}

/** Run headless Chromium with the container-safe flag set. */
function runChromium(bin, args) {
  return spawnSync(
    bin,
    ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", ...args],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: RUN_TIMEOUT_MS }
  );
}

function stderrOf(res) {
  return ((res.stderr || "") + "\n" + (res.error ? String(res.error.message) : "")).trim();
}

/** Extract a data-* attribute from the dumped DOM. */
function domAttr(dom, name) {
  const match = dom.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : null;
}

function num(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ------------------------------------------------------------------ */
/* Check A: self-containment (AC3)                                     */
/* ------------------------------------------------------------------ */
function checkSelfContainment() {
  if (!existsSync(htmlPath)) {
    report("A self-containment: index.html exists", false, "file not found");
    return false;
  }
  const html = readFileSync(htmlPath, "utf8");
  const banned = [
    { re: /https?:/i, label: "http(s) URL" },
    { re: /\/\//, label: "double slash ('//' protocol-relative reference)" },
    { re: /@import/i, label: "@import" },
    { re: /<link\b/i, label: "<link> element" },
    { re: /\bsrc\s*=/i, label: "src= attribute" },
    { re: /url\s*\(\s*(?!#)/i, label: "non-fragment url() reference" },
    { re: /\bfetch\s*\(/i, label: "fetch() call" },
    { re: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
    { re: /\bintegrity\s*=/i, label: "integrity= attribute" },
    { re: /\bcrossorigin\s*=/i, label: "crossorigin= attribute" },
  ];
  const hits = banned.filter((rule) => rule.re.test(html)).map((rule) => rule.label);
  report(
    "A self-containment: no external references in index.html",
    hits.length === 0,
    hits.length === 0 ? "zero external URLs/src/@import/link/network references" : `found ${hits.join(", ")}`
  );
  return hits.length === 0;
}

/* ------------------------------------------------------------------ */
/* Check B: two headless --dump-dom runs (AC1, AC2, AC4, AC5)          */
/* ------------------------------------------------------------------ */
function checkDumpRuns(bin) {
  const urlEarly = pathToFileURL(htmlPath).href;
  const urlLate = `${urlEarly}#selftest`;

  const early = runChromium(bin, [
    "--dump-dom",
    "--window-size=1200,700",
    `--virtual-time-budget=${DUMP_BUDGET_EARLY}`,
    urlEarly,
  ]);
  if (early.status !== 0) {
    report("B1 chromium dump run (early budget)", false, stderrOf(early).slice(0, 500));
    return;
  }
  report("B1 chromium dump run (early budget)", true, `budget ${DUMP_BUDGET_EARLY}ms`);

  const late = runChromium(bin, [
    "--dump-dom",
    "--window-size=1200,700",
    `--virtual-time-budget=${DUMP_BUDGET_LATE}`,
    urlLate,
  ]);
  if (late.status !== 0) {
    report("B2 chromium dump run (late budget, #selftest)", false, stderrOf(late).slice(0, 500));
    return;
  }
  report("B2 chromium dump run (late budget, #selftest)", true, `budget ${DUMP_BUDGET_LATE}ms`);

  const earlyDom = early.stdout || "";
  const lateDom = late.stdout || "";

  /* frames strictly increase across the two budgets */
  const framesEarly = num(domAttr(earlyDom, "data-frames"));
  const framesLate = num(domAttr(lateDom, "data-frames"));
  report(
    "B3 data-frames strictly increases",
    framesEarly !== null && framesLate !== null && framesLate > framesEarly,
    `early=${framesEarly} late=${framesLate}`
  );

  /* sampled wheel angle advances (normalised to a non-zero delta) */
  const angleEarly = num(domAttr(earlyDom, "data-wheel-angle"));
  const angleLate = num(domAttr(lateDom, "data-wheel-angle"));
  let angleDiff = null;
  if (angleEarly !== null && angleLate !== null) {
    angleDiff = (((angleLate - angleEarly) % 360) + 360) % 360;
  }
  report(
    "B4 data-wheel-angle advances between runs",
    angleDiff !== null && angleDiff > 1 && angleDiff < 359,
    `early=${angleEarly} late=${angleLate} delta=${angleDiff === null ? "n/a" : angleDiff.toFixed(2)}deg`
  );

  /* motion probe only flips to moving after a genuine transform change */
  report(
    "B5 data-motion reports moving",
    domAttr(lateDom, "data-motion") === "moving",
    `value=${domAttr(lateDom, "data-motion")}`
  );

  /* zero uncaught errors in both runs */
  const errorsEarly = domAttr(earlyDom, "data-errors");
  const errorsLate = domAttr(lateDom, "data-errors");
  report(
    "B6 data-errors is 0 in both runs",
    errorsEarly === "0" && errorsLate === "0",
    `early=${errorsEarly} late=${errorsLate}`
  );

  /* rendered widths prove the pelican and bicycle actually draw (AC1) */
  const pelicanW = num(domAttr(lateDom, "data-pelican-w"));
  const bicycleW = num(domAttr(lateDom, "data-bicycle-w"));
  report(
    "B7 data-pelican-w / data-bicycle-w above minimums",
    pelicanW !== null && bicycleW !== null && pelicanW >= MIN_PELICAN_W && bicycleW >= MIN_BICYCLE_W,
    `pelican=${pelicanW}px (min ${MIN_PELICAN_W}) bicycle=${bicycleW}px (min ${MIN_BICYCLE_W})`
  );

  /* event-driven bell check through the #selftest click path (AC4) */
  report(
    "B8 data-bell-test passes via #selftest MouseEvent",
    domAttr(lateDom, "data-bell-test") === "passed",
    `value=${domAttr(lateDom, "data-bell-test")}`
  );
}

/* ------------------------------------------------------------------ */
/* Check C: time-separated screenshots differ (AC2)                    */
/* ------------------------------------------------------------------ */
function checkScreenshots(bin) {
  mkdirSync(artifactDir, { recursive: true });
  const url = pathToFileURL(htmlPath).href;
  const earlyPath = path.join(artifactDir, "pelican-early.png");
  const latePath = path.join(artifactDir, "pelican-late.png");
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const shots = [
    { label: "C1", name: "early", file: earlyPath, budget: SHOT_BUDGET_EARLY },
    { label: "C2", name: "late", file: latePath, budget: SHOT_BUDGET_LATE },
  ];
  const buffers = [];
  for (const shot of shots) {
    const res = runChromium(bin, [
      "--run-all-compositor-stages-before-draw",
      `--screenshot=${shot.file}`,
      "--window-size=1200,700",
      `--virtual-time-budget=${shot.budget}`,
      url,
    ]);
    if (res.status !== 0) {
      report(`${shot.label} screenshot (${shot.name}, budget ${shot.budget}ms)`, false, stderrOf(res).slice(0, 500));
      continue;
    }
    if (!existsSync(shot.file)) {
      report(`${shot.label} screenshot (${shot.name}) written`, false, "file missing");
      continue;
    }
    const size = statSync(shot.file).size;
    const buf = readFileSync(shot.file);
    const validMagic = buf.length >= 8 && buf.subarray(0, 8).equals(pngMagic);
    report(
      `${shot.label} screenshot (${shot.name}, budget ${shot.budget}ms) is a valid non-empty PNG`,
      validMagic && size > 5000,
      `${path.relative(root, shot.file)} ${size} bytes`
    );
    if (validMagic && size > 5000) buffers.push(buf);
  }

  if (buffers.length === 2) {
    const hashA = createHash("sha256").update(buffers[0]).digest("hex");
    const hashB = createHash("sha256").update(buffers[1]).digest("hex");
    report(
      "C3 time-separated screenshots have differing SHA-256 (scene animates)",
      hashA !== hashB,
      `early=${hashA.slice(0, 12)} late=${hashB.slice(0, 12)}`
    );
  } else {
    report("C3 time-separated screenshots have differing SHA-256 (scene animates)", false, "fewer than two valid PNGs");
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
console.log("Pelican riding — verification");
console.log(`repo root: ${root}`);

const selfContained = checkSelfContainment();
const chromium = findChromium();
if (!chromium) {
  report("chromium available", false, "no chromium/chrome binary found (set CHROMIUM_PATH)");
} else {
  report("chromium available", true, chromium.version || chromium.bin);
  checkDumpRuns(chromium.bin);
  checkScreenshots(chromium.bin);
}

if (!selfContained) {
  /* External references would invalidate the other checks' assumptions,
     but they still run so the report stays complete. */
  console.log("[note] self-containment failed; remaining checks run for completeness.");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
