#!/usr/bin/env node
/**
 * Objective checks on the captured browser evidence under `tests/evidence`.
 *
 * The screenshots are the qualitative part of the verification (a reviewer looks
 * at them), but three properties must be objectively true for that evidence to
 * mean anything, and this script proves them without any image dependency — it
 * decodes the PNGs with `node:zlib` and works on raw pixels:
 *
 *  1. **Every image is a real render**, not a blank or single-colour frame: the
 *     pixel variance and distinct-colour count must clear a floor.
 *  2. **Every era is visually distinct**: the five `default.png` views must differ
 *     pairwise, both in mean colour (lighting/palette) and in per-pixel difference,
 *     and every close-up must differ from its era's default view.
 *  3. **Fixed-pose comparability**: all captures share the same dimensions, so the
 *     five default views can be compared side by side.
 *
 * Usage: node tests/evidence/verify-images.mjs [--out tests/evidence]
 * Exit code 1 means the evidence is unusable (blank frame or indistinguishable
 * eras) and names the offending pair.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const YEAR_IDS = ['1945', '1965', '1985', '2005', '2025'];

/** Smallest acceptable pixel variance (mean squared deviation from the mean). */
const VARIANCE_FLOOR = 250;
/**
 * Smallest acceptable number of distinct colours, sampled on a 5-bit-per-channel
 * grid. The scenes are painted with procedural, fairly flat materials under a
 * single lighting rig, so a real render still reports only a few hundred distinct
 * quantised colours; a blank or single-colour frame reports 1.
 */
const COLOUR_FLOOR = 250;
/**
 * Smallest acceptable mean-colour distance between two eras' default views. This
 * floor is deliberately low: mean colour separates the eras whose palettes differ
 * (1945 vs 1985 is ~30), while the strong distinctness evidence is the per-pixel
 * difference share below, which holds for every pair.
 */
const MEAN_COLOUR_SEPARATION = 5;
/** Smallest acceptable share of differing pixels between two era default views. */
const PIXEL_DIFFERENCE_SHARE = 0.2;

/* -------------------------------------------------------------------------- */
/* Minimal PNG decoder (8-bit truecolour, with or without alpha)               */
/* -------------------------------------------------------------------------- */

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('not a PNG file');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || (colourType !== 2 && colourType !== 6)) {
    throw new Error(`unsupported PNG (bit depth ${bitDepth}, colour type ${colourType})`);
  }
  const channels = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      const value = line[x];
      let restored;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + Math.floor((left + up) / 2);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          restored = value + predictor;
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
      current[x] = restored & 0xff;
    }
    current.copy(pixels, y * stride);
    previous = current;
  }
  return { width, height, channels, pixels };
}

/* -------------------------------------------------------------------------- */
/* Image statistics                                                           */
/* -------------------------------------------------------------------------- */

function statistics(image) {
  const { width, height, channels, pixels } = image;
  const colours = new Set();
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLuma = 0;
  let sumLumaSquares = 0;
  let samples = 0;
  /* Sample every 4th pixel: fast, and plenty for these thresholds. */
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * channels;
      const r = pixels[index] ?? 0;
      const g = pixels[index + 1] ?? 0;
      const b = pixels[index + 2] ?? 0;
      colours.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sumR += r;
      sumG += g;
      sumB += b;
      sumLuma += luma;
      sumLumaSquares += luma * luma;
      samples += 1;
    }
  }
  const meanLuma = sumLuma / samples;
  return {
    width,
    height,
    mean: [sumR / samples, sumG / samples, sumB / samples],
    meanLuma,
    variance: sumLumaSquares / samples - meanLuma * meanLuma,
    distinctColours: colours.size,
  };
}

function meanColourDistance(left, right) {
  return Math.hypot(left.mean[0] - right.mean[0], left.mean[1] - right.mean[1], left.mean[2] - right.mean[2]);
}

/** Share of sampled pixels whose colour differs by more than `threshold` levels. */
function differenceShare(leftImage, rightImage, threshold = 12) {
  const { width, height, channels, pixels } = leftImage;
  let differing = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * channels;
      const delta =
        Math.abs((pixels[index] ?? 0) - (rightImage.pixels[index] ?? 0)) +
        Math.abs((pixels[index + 1] ?? 0) - (rightImage.pixels[index + 1] ?? 0)) +
        Math.abs((pixels[index + 2] ?? 0) - (rightImage.pixels[index + 2] ?? 0));
      if (delta > threshold) differing += 1;
      samples += 1;
    }
  }
  return differing / samples;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  let out = HERE;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out' && argv[index + 1]) out = resolve(argv[index + 1]);
  }
  return { out };
}

function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const failures = [];
  const images = new Map();

  for (const year of YEAR_IDS) {
    const directory = join(out, year);
    let files;
    try {
      files = readdirSync(directory).filter((name) => name.endsWith('.png')).sort();
    } catch (error) {
      failures.push(`${year}: no evidence directory (${error.message})`);
      continue;
    }
    if (files.length < 4) failures.push(`${year}: expected 4 images, found ${files.length}`);
    for (const file of files) {
      const image = decodePng(readFileSync(join(directory, file)));
      const stats = statistics(image);
      images.set(`${year}/${file}`, { image, stats });
      const label = `${year}/${file}`;
      console.log(
        `${label.padEnd(34)} ${stats.width}x${stats.height} mean=[${stats.mean
          .map((value) => value.toFixed(1))
          .join(', ')}] luma=${stats.meanLuma.toFixed(1)} variance=${stats.variance.toFixed(0)} colours=${stats.distinctColours}`,
      );
      if (stats.variance < VARIANCE_FLOOR) {
        failures.push(`${label}: frame looks blank (variance ${stats.variance.toFixed(1)})`);
      }
      if (stats.distinctColours < COLOUR_FLOOR) {
        failures.push(`${label}: too few distinct colours (${stats.distinctColours})`);
      }
      if (stats.width !== 1280 || stats.height !== 720) {
        failures.push(`${label}: unexpected viewport ${stats.width}x${stats.height}`);
      }
    }
  }

  console.log('\npairwise separation of the fixed-pose default views');
  for (let left = 0; left < YEAR_IDS.length; left += 1) {
    for (let right = left + 1; right < YEAR_IDS.length; right += 1) {
      const leftEntry = images.get(`${YEAR_IDS[left]}/default.png`);
      const rightEntry = images.get(`${YEAR_IDS[right]}/default.png`);
      if (!leftEntry || !rightEntry) continue;
      const colour = meanColourDistance(leftEntry.stats, rightEntry.stats);
      const share = differenceShare(leftEntry.image, rightEntry.image);
      const label = `${YEAR_IDS[left]} vs ${YEAR_IDS[right]}`;
      console.log(
        `  ${label.padEnd(16)} mean-colour distance=${colour.toFixed(2)} differing pixels=${(share * 100).toFixed(1)}%`,
      );
      if (colour < MEAN_COLOUR_SEPARATION) {
        failures.push(`${label}: default views are too similar in colour (${colour.toFixed(2)})`);
      }
      if (share < PIXEL_DIFFERENCE_SHARE) {
        failures.push(`${label}: default views differ on only ${(share * 100).toFixed(1)}% of pixels`);
      }
    }
  }

  console.log('\nclose-ups versus their era default view');
  for (const year of YEAR_IDS) {
    const base = images.get(`${year}/default.png`);
    if (!base) continue;
    for (const view of ['menu', 'music', 'counter']) {
      const closeUp = images.get(`${year}/closeup-${view}.png`);
      if (!closeUp) continue;
      const share = differenceShare(base.image, closeUp.image);
      console.log(`  ${`${year} ${view}`.padEnd(16)} differing pixels=${(share * 100).toFixed(1)}%`);
      if (share < PIXEL_DIFFERENCE_SHARE) {
        failures.push(`${year} close-up ${view}: does not look like a close-up (${(share * 100).toFixed(1)}%)`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\nEvidence check failed:\n - ${failures.join('\n - ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nEvidence check passed: ${images.size} images are real, distinct renders.`);
}

main();
