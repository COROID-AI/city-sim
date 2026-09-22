/**
 * tools/lib/png.mjs — dependency-free PNG decoder + frame statistics.
 *
 * DEV-ONLY. Not part of the product deliverable. Uses only Node builtins
 * (node:fs, node:zlib) so the verification harness never needs an install step.
 *
 * decodePNG(path)  -> { width, height, data: Uint8ClampedArray (RGBA), ... }
 * frameStats(img)  -> brightness / saturation / colour richness / density / border stats
 * diffRatio(a, b)  -> fraction of pixels that differ measurably
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Decode a PNG file (8-bit, non-interlaced, colour types 0/2/4/6) to RGBA. */
export function decodePNG(path) {
  const buf = readFileSync(path);
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) throw new Error(`not a PNG file: ${path}`);
  }
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  let palette = null;

  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd > buf.length) throw new Error(`truncated PNG chunk ${type} in ${path}`);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      if (buf[dataStart + 10] !== 0) throw new Error('unsupported PNG compression method');
      if (buf[dataStart + 11] !== 0) throw new Error('unsupported PNG filter method');
      interlace = buf[dataStart + 12];
    } else if (type === 'PLTE') {
      palette = Buffer.from(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(buf.subarray(dataStart, dataEnd)));
    } else if (type === 'IEND') {
      break;
    }
    off = dataEnd + 4; // skip CRC
  }

  if (!width || !height) throw new Error(`PNG has no IHDR: ${path}`);
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (expected 8)`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = x >= bpp && y > 0 ? out[prevStart + x - bpp] : 0;
      let value;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + ((a + b) >> 1); break;
        case 4: value = rawByte + paeth(a, b, c); break;
        default: throw new Error(`bad PNG filter type ${filter} on row ${y}`);
      }
      out[rowStart + x] = value & 0xff;
    }
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += bpp) {
    let r;
    let g;
    let bl;
    let al = 255;
    if (colorType === 0) {
      r = g = bl = out[p];
    } else if (colorType === 4) {
      r = g = bl = out[p];
      al = out[p + 1];
    } else if (colorType === 2) {
      r = out[p];
      g = out[p + 1];
      bl = out[p + 2];
    } else if (colorType === 6) {
      r = out[p];
      g = out[p + 1];
      bl = out[p + 2];
      al = out[p + 3];
    } else {
      const idx = out[p] * 3;
      r = palette[idx];
      g = palette[idx + 1];
      bl = palette[idx + 2];
    }
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = bl;
    data[i * 4 + 3] = al;
  }

  return { width, height, data, colorType, bitDepth, path };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function saturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Per-frame visual statistics.
 *  - meanLuma            0..255 brightness of the whole frame
 *  - meanSaturation      0..1
 *  - uniqueColors        distinct 5-bit-per-channel colours (caps at 32768)
 *  - largestUniformFrac  largest connected region of near-identical 8x8 blocks
 *  - border              per-edge fraction of pixels matching a reference colour
 *  - sky                 blue-sky reading of a horizontal band
 */
export function frameStats(img, opts = {}) {
  const { width, height, data } = img;
  const refColor = opts.borderColor || null;
  const tol = opts.borderTolerance ?? 8;

  let lumaSum = 0;
  let satSum = 0;
  const colors = new Set();
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    lumaSum += luma(r, g, b);
    satSum += saturation(r, g, b);
    colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
  }
  const px = width * height;

  const block = opts.block || 8;
  const bw = Math.max(1, Math.floor(width / block));
  const bh = Math.max(1, Math.floor(height / block));
  const blockKeys = new Int32Array(bw * bh);
  const blockLuma = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let n = 0;
      for (let y = by * block; y < (by + 1) * block && y < height; y++) {
        for (let x = bx * block; x < (bx + 1) * block && x < width; x++) {
          const i = (y * width + x) * 4;
          rs += data[i];
          gs += data[i + 1];
          bs += data[i + 2];
          n++;
        }
      }
      const r = rs / n;
      const g = gs / n;
      const b = bs / n;
      blockKeys[by * bw + bx] = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      blockLuma[by * bw + bx] = luma(r, g, b);
    }
  }
  const largestUniformFrac = largestRegion(blockKeys, bw, bh) / (bw * bh);

  let border = null;
  if (refColor) {
    const match = (i) =>
      Math.abs(data[i * 4] - refColor[0]) <= tol &&
      Math.abs(data[i * 4 + 1] - refColor[1]) <= tol &&
      Math.abs(data[i * 4 + 2] - refColor[2]) <= tol;
    const top = edgeCoverage(width, height, match, 'top');
    const bottom = edgeCoverage(width, height, match, 'bottom');
    const left = edgeCoverage(width, height, match, 'left');
    const right = edgeCoverage(width, height, match, 'right');
    border = { top, bottom, left, right, max: Math.max(top, bottom, left, right) };
  }

  return {
    width,
    height,
    meanLuma: lumaSum / px,
    meanSaturation: satSum / px,
    uniqueColors: colors.size,
    largestUniformFrac,
    border,
    ...skyStats(data, width, height, opts.skyBand),
    corners: cornerColors(data, width, height),
  };
}

function edgeCoverage(width, height, match, edge) {
  let hits = 0;
  let total = 0;
  const band = 2;
  if (edge === 'top' || edge === 'bottom') {
    for (let b = 0; b < band; b++) {
      const y = edge === 'top' ? b : height - 1 - b;
      for (let x = 0; x < width; x++) {
        total++;
        if (match(y * width + x)) hits++;
      }
    }
  } else {
    for (let b = 0; b < band; b++) {
      const x = edge === 'left' ? b : width - 1 - b;
      for (let y = 0; y < height; y++) {
        total++;
        if (match(y * width + x)) hits++;
      }
    }
  }
  return total ? hits / total : 0;
}

/** Fraction of pixels in the given band (default top 25%) that read as blue sky. */
function skyStats(data, width, height, band) {
  const y0 = band ? band[0] : 0;
  const y1 = band ? band[1] : Math.max(1, Math.floor(height * 0.25));
  let blue = 0;
  let warm = 0;
  let n = 0;
  let lum = 0;
  for (let y = y0; y < Math.min(y1, height); y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      n++;
      lum += luma(r, g, b);
      // bright, blue-dominant and not washed out to white => sky
      if (b > 140 && b > r + 18 && b >= g - 2 && (b - r) > 18) blue++;
      if (r > 200 && g > 150 && b < 150) warm++;
    }
  }
  return n ? { skyBlueFrac: blue / n, warmFrac: warm / n, bandLuma: lum / n } : { skyBlueFrac: 0, warmFrac: 0, bandLuma: 0 };
}

function cornerColors(data, width, height) {
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  return {
    tl: at(0, 0),
    tr: at(width - 1, 0),
    bl: at(0, height - 1),
    br: at(width - 1, height - 1),
  };
}

/** Largest 4-connected region of identical quantised blocks (iterative flood fill). */
function largestRegion(keys, bw, bh) {
  const seen = new Uint8Array(bw * bh);
  const stack = new Int32Array(bw * bh);
  let best = 0;
  for (let start = 0; start < keys.length; start++) {
    if (seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const key = keys[start];
    let size = 0;
    while (sp > 0) {
      const cur = stack[--sp];
      size++;
      const cx = cur % bw;
      const cy = (cur - cx) / bw;
      if (cx > 0) push(cur - 1);
      if (cx < bw - 1) push(cur + 1);
      if (cy > 0) push(cur - bw);
      if (cy < bh - 1) push(cur + bw);
    }
    if (size > best) best = size;

    function push(idx) {
      if (seen[idx] || keys[idx] !== key) return;
      seen[idx] = 1;
      stack[sp++] = idx;
    }
  }
  return best;
}

/** Statistics for a sub-rectangle given in normalised coordinates. */
export function regionStats(img, x0, y0, x1, y1) {
  const { width, height, data } = img;
  const px0 = Math.max(0, Math.floor(x0 * width));
  const px1 = Math.min(width, Math.ceil(x1 * width));
  const py0 = Math.max(0, Math.floor(y0 * height));
  const py1 = Math.min(height, Math.ceil(y1 * height));
  let lum = 0;
  let red = 0;
  let sat = 0;
  let n = 0;
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) {
      const i = (y * width + x) * 4;
      lum += luma(data[i], data[i + 1], data[i + 2]);
      red += data[i];
      sat += saturation(data[i], data[i + 1], data[i + 2]);
      n++;
    }
  }
  return n ? { meanLuma: lum / n, meanRed: red / n, meanSaturation: sat / n, pixels: n } : { meanLuma: 0, meanRed: 0, meanSaturation: 0, pixels: 0 };
}

/** Fraction of pixels that differ by more than `tol` in any channel. */
/** Fraction of pixels inside a normalised region that are bright and near-neutral (flame core). */
export function nearWhiteRatio(img, x0, y0, x1, y1, minLuma = 225, maxSat = 0.25) {
  const { width, height, data } = img;
  const px0 = Math.max(0, Math.floor(x0 * width));
  const px1 = Math.min(width, Math.ceil(x1 * width));
  const py0 = Math.max(0, Math.floor(y0 * height));
  const py1 = Math.min(height, Math.ceil(y1 * height));
  let hits = 0;
  let n = 0;
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      n++;
      if (luma(r, g, b) >= minLuma && saturation(r, g, b) <= maxSat) hits++;
    }
  }
  return n ? hits / n : 0;
}

/** Mean channel values of a normalised region (used for warm/bright shift comparisons). */
export function meanColorOfRegion(img, x0, y0, x1, y1) {
  return regionStats(img, x0, y0, x1, y1);
}

export function diffRatio(a, b, tol = 8) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const n = a.width * a.height;
  let diff = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (
      Math.abs(a.data[j] - b.data[j]) > tol ||
      Math.abs(a.data[j + 1] - b.data[j + 1]) > tol ||
      Math.abs(a.data[j + 2] - b.data[j + 2]) > tol
    ) diff++;
  }
  return diff / n;
}
