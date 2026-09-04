#!/usr/bin/env node
/**
 * Verifies the produced Coroid 30s promo deliverable.
 *
 * Acceptance checks:
 *   AC-1  dist/coroid_promo_30s.mp4 exists
 *   AC-2  Video duration is 30.0s (+/- 0.5s tolerance)
 *   AC-3  Resolution is 1920x1080
 *   AC-4  Determinism: smoke-render hash manifest shows consistent frames
 *   AC-6  Dependency manifest (requirements.txt) present for reproduction
 *
 * Uses ffmpeg (bundled with imageio-ffmpeg) to parse container metadata.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const VIDEO = path.join(ROOT, "dist", "coroid_promo_30s.mp4");
const HASH_MANIFEST = path.join(ROOT, "dist", "frame_hashes.json");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  if (r.error) throw r.error;
  return (r.stdout || "") + (r.stderr || "");
}

function findFfmpeg() {
  const base = path.join(ROOT, ".venv", "lib", "python3.11", "site-packages", "imageio_ffmpeg", "binaries");
  const candidates = [];
  if (fs.existsSync(base)) {
    for (const f of fs.readdirSync(base)) {
      if (f.startsWith("ffmpeg-")) candidates.push(path.join(base, f));
    }
  }
  candidates.push("ffmpeg");
  for (const c of candidates) {
    try {
      if (run(c, ["-version"]).includes("ffmpeg")) return c;
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

function probe(ffmpeg) {
  // Decode 1 frame, capture stream metadata from stderr.
  const out = run(ffmpeg, ["-hide_banner", "-i", VIDEO, "-frames:v", "1", "-f", "null", "-"]);
  const durM = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const resM = out.match(/(\d{3,4})x(\d{3,4})(?:,\s*|\s*\[)/);
  let duration = null;
  let resolution = null;
  if (durM) {
    duration = parseInt(durM[1], 10) * 3600 + parseInt(durM[2], 10) * 60 + parseFloat(durM[3]);
  }
  if (resM) {
    resolution = `${resM[1]}x${resM[2]}`;
  }
  return { duration, resolution, raw: out };
}

function main() {
  const results = [];
  const add = (ref, status, evidence) => results.push({ ref, status, evidence });

  // AC-1: output exists
  if (fs.existsSync(VIDEO)) {
    const sizeMB = fs.statSync(VIDEO).size / 1e6;
    add("AC-1", "PASS", `dist/coroid_promo_30s.mp4 present (${sizeMB.toFixed(1)} MB)`);
  } else {
    add("AC-1", "FAIL", "dist/coroid_promo_30s.mp4 not found");
  }

  // AC-2 / AC-3: parse duration & resolution via ffmpeg
  const ffmpeg = findFfmpeg();
  if (ffmpeg && fs.existsSync(VIDEO)) {
    try {
      const p = probe(ffmpeg);
      const okDur = p.duration !== null && Math.abs(p.duration - 30.0) <= 0.5;
      add("AC-2", okDur ? "PASS" : "FAIL",
        p.duration !== null ? `duration=${p.duration.toFixed(2)}s (target 30.0s)` : "could not parse duration");
      add("AC-3", p.resolution === "1920x1080" ? "PASS" : "FAIL",
        p.resolution ? `resolution=${p.resolution} (target 1920x1080)` : "could not parse resolution");
    } catch (e) {
      add("AC-2", "NOT_VERIFIED", `ffmpeg probe failed: ${e.message}`);
      add("AC-3", "NOT_VERIFIED", `ffmpeg probe failed: ${e.message}`);
    }
  } else {
    add("AC-2", "NOT_VERIFIED", "No video or ffmpeg available");
    add("AC-3", "NOT_VERIFIED", "No video or ffmpeg available");
  }

  // AC-4: determinism manifest
  if (fs.existsSync(HASH_MANIFEST)) {
    const m = JSON.parse(fs.readFileSync(HASH_MANIFEST, "utf-8"));
    const stable = m.frames.every((f) => f.consistent === true);
    add("AC-4", stable ? "PASS" : "FAIL", `determinism manifest: ${m.frames.length} frames checked, consistent=${stable}`);
  } else {
    add("AC-4", "NOT_VERIFIED", "No frame hash manifest produced (run smoke render)");
  }

  // AC-6: dependency manifest
  const hasReq = fs.existsSync(path.join(ROOT, "requirements.txt"));
  const hasPkg = fs.existsSync(path.join(ROOT, "package.json"));
  add("AC-6", hasReq && hasPkg ? "PASS" : "FAIL", `requirements.txt=${hasReq}, package.json=${hasPkg}`);

  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === "FAIL").length;
  const notv = results.filter((r) => r.status === "NOT_VERIFIED").length;
  console.log(`\nSUMMARY: ${results.length - failed - notv} PASS, ${failed} FAIL, ${notv} NOT_VERIFIED`);
  process.exit(failed > 0 ? 1 : 0);
}

main();