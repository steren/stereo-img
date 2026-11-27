// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import test from 'node:test';
import assert from 'node:assert/strict';

import parseWigglegramDefault, {
  parseWigglegram,
  detectAnimationFormat,
  isAnimatedWigglegram,
  readGifFrames,
  readWebPAnimation,
  readApng,
  selectExtremeFrames,
  decodeDataUrlBytes,
} from '../../parsers/wiggle-parser/wiggle-parser.js';
if (typeof globalThis.HTMLElement === 'undefined') {
  globalThis.HTMLElement = class {};
}

const { mayBeAnimatedWigglegram, StereoImg } = await import('../../stereo-img.js');

// ============================================================================
// Self-Contained Binary & Mock DOM Helpers
// ============================================================================

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const u32 = (...values) =>
  new Uint8Array(values.flatMap(v => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]));

const u16le = (...values) =>
  new Uint8Array(values.flatMap(v => [v & 255, (v >>> 8) & 255]));

const text = (str) =>
  new Uint8Array(Array.from(str, c => c.charCodeAt(0)));

const concat = (...parts) => {
  const arrays = parts.map(p => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
};

function createTestPNG({ width = 8, height = 4, sterMode = null } = {}) {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk('IHDR', concat(u32(width, height), new Uint8Array([8, 2, 0, 0, 0])));
  const ster = sterMode === null ? new Uint8Array(0) : pngChunk('sTER', new Uint8Array([sterMode & 0xff]));
  const idat = pngChunk('IDAT', new Uint8Array([0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01]));
  const iend = pngChunk('IEND', new Uint8Array(0));
  return concat(sig, ihdr, ster, idat, iend);
}

function withMockMonoDOM(fn) {
  const saved = {
    Image: global.Image,
    ImageData: global.ImageData,
    document: global.document,
  };
  global.ImageData = class MockImageData {
    constructor(dataOrWidth, widthOrHeight, height) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height;
      }
    }
  };
  global.Image = class MockImage {
    constructor() {
      this.width = 4;
      this.height = 4;
    }
    set src(val) {
      this._src = val;
      queueMicrotask(() => this.onload?.());
    }
    get src() {
      return this._src;
    }
  };
  global.document = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        const canvas = { width: 4, height: 4 };
        canvas.getContext = () => ({
          drawImage: () => {},
          clearRect: () => {},
          getImageData: (x, y, w, h) => new global.ImageData(w, h),
        });
        return canvas;
      }
      return {};
    },
  };
  return Promise.resolve().then(fn).finally(() => {
    global.Image = saved.Image;
    global.ImageData = saved.ImageData;
    global.document = saved.document;
  });
}

// ============================================================================
// Genuine GIF LZW Encoder & Container Builders for Tests
// ============================================================================

function encodeGifLzw(indices, minCodeSize = 2) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  const bytes = [];
  let bitBuf = 0;
  let bitCount = 0;

  const emitCode = (code, size) => {
    bitBuf |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      bytes.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dict = new Map();

  emitCode(clearCode, codeSize);
  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const ch = indices[i];
    const key = prefix + ',' + ch;
    if (dict.has(key)) {
      prefix = key;
    } else {
      const code = prefix.includes(',') ? dict.get(prefix) : Number(prefix);
      emitCode(code, codeSize);
      if (nextCode < 4096) {
        dict.set(key, nextCode++);
        if (nextCode - 1 === (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        emitCode(clearCode, codeSize);
        dict = new Map();
        codeSize = minCodeSize + 1;
        nextCode = eoiCode + 1;
      }
      prefix = String(ch);
    }
  }
  const lastCode = prefix.includes(',') ? dict.get(prefix) : Number(prefix);
  emitCode(lastCode, codeSize);
  emitCode(eoiCode, codeSize);
  if (bitCount > 0) {
    bytes.push(bitBuf & 0xff);
  }

  // Pack into GIF sub-blocks (max 255 bytes each) + 0x00 terminator
  const out = [minCodeSize];
  for (let pos = 0; pos < bytes.length; pos += 255) {
    const slice = bytes.slice(pos, Math.min(pos + 255, bytes.length));
    out.push(slice.length, ...slice);
  }
  out.push(0x00);
  return new Uint8Array(out);
}

function buildGif({
  version = 'GIF89a',
  width = 4,
  height = 4,
  gct = [
    255, 0, 0,    // 0: Red
    0, 255, 0,    // 1: Green
    0, 0, 255,    // 2: Blue
    255, 255, 0,  // 3: Yellow
  ],
  frames = [],
  comment = null,
}) {
  const gctColors = gct.length / 3;
  const gctPow = Math.max(0, Math.ceil(Math.log2(gctColors)) - 1);
  const gctPacked = 0x80 | (gctPow & 0x07);
  const gctPadded = new Uint8Array((1 << (gctPow + 1)) * 3);
  gctPadded.set(gct);

  const parts = [
    text(version),
    u16le(width, height),
    new Uint8Array([gctPacked, 0, 0]),
    gctPadded,
  ];

  if (comment) {
    const cBytes = text(comment);
    parts.push(new Uint8Array([0x21, 0xfe, cBytes.length]), cBytes, new Uint8Array([0x00]));
  }

  if (version === 'GIF89a' && frames.length > 1) {
    parts.push(
      new Uint8Array([0x21, 0xff, 0x0b]),
      text('NETSCAPE2.0'),
      new Uint8Array([0x03, 0x01, 0x00, 0x00, 0x00])
    );
  }

  for (const frame of frames) {
    const fw = frame.width ?? width;
    const fh = frame.height ?? height;
    const left = frame.left ?? 0;
    const top = frame.top ?? 0;
    const disposal = frame.disposal ?? 0;
    const transparentIndex = frame.transparentIndex;
    const hasTransparent = transparentIndex !== undefined && transparentIndex !== null;
    const delayCs = frame.delayCs ?? 10;

    if (version === 'GIF89a' && frame.gce !== false) {
      const gcePacked = ((disposal & 0x07) << 2) | (hasTransparent ? 0x01 : 0x00);
      parts.push(new Uint8Array([
        0x21, 0xf9, 0x04, gcePacked,
        delayCs & 0xff, (delayCs >> 8) & 0xff,
        hasTransparent ? transparentIndex : 0,
        0x00,
      ]));
    }

    let descPacked = frame.interlaced ? 0x40 : 0x00;
    let lctBuf = new Uint8Array(0);
    if (frame.lct) {
      const lctColors = frame.lct.length / 3;
      const lctPow = Math.max(0, Math.ceil(Math.log2(lctColors)) - 1);
      descPacked |= 0x80 | (lctPow & 0x07);
      lctBuf = new Uint8Array((1 << (lctPow + 1)) * 3);
      lctBuf.set(frame.lct);
    }

    parts.push(
      new Uint8Array([0x2c]),
      u16le(left, top, fw, fh),
      new Uint8Array([descPacked]),
      lctBuf,
      encodeGifLzw(frame.indices, frame.minCodeSize ?? 2)
    );
  }

  parts.push(new Uint8Array([0x3b]));
  return concat(...parts);
}

// ============================================================================
// Genuine zlib-compressed APNG Builder for Tests
// ============================================================================

async function zlibCompress(data) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const writeDone = writer.write(data).catch(() => {});
  const closeDone = writer.close().catch(() => {});
  try {
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } finally {
    await Promise.allSettled([writeDone, closeDone]);
  }
}

function pngChunk(type, data) {
  const typeBytes = text(type);
  const crc = crc32(concat(typeBytes, data));
  return concat(u32(data.length), typeBytes, data, u32(crc));
}

function filterScanlines(rgbaOrSamples, width, height, bpp, filterModePerRow) {
  const stride = width * bpp;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const mode = typeof filterModePerRow === 'function' ? filterModePerRow(y) : (filterModePerRow ?? 0);
    const outRow = y * (1 + stride);
    const inRow = y * stride;
    const prevRow = (y - 1) * stride;
    raw[outRow] = mode;
    for (let x = 0; x < stride; x++) {
      const cur = rgbaOrSamples[inRow + x];
      const a = x >= bpp ? rgbaOrSamples[inRow + x - bpp] : 0;
      const b = y > 0 ? rgbaOrSamples[prevRow + x] : 0;
      const c = (y > 0 && x >= bpp) ? rgbaOrSamples[prevRow + x - bpp] : 0;
      let val;
      if (mode === 0) val = cur;
      else if (mode === 1) val = (cur - a) & 0xff;
      else if (mode === 2) val = (cur - b) & 0xff;
      else if (mode === 3) val = (cur - ((a + b) >> 1)) & 0xff;
      else if (mode === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        val = (cur - pr) & 0xff;
      }
      raw[outRow + 1 + x] = val;
    }
  }
  return raw;
}

async function buildApng({
  width = 4,
  height = 4,
  colorType = 6,
  bitDepth = 8,
  plte = null,
  trns = null,
  numPlays = 0,
  defaultStaticFrame = null,
  frames = [],
}) {
  const bppMap = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const bpp = bppMap[colorType];
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk('IHDR', concat(u32(width, height), new Uint8Array([bitDepth, colorType, 0, 0, 0])));
  const parts = [sig, ihdr];

  if (plte) parts.push(pngChunk('PLTE', plte));
  if (trns) parts.push(pngChunk('tRNS', trns));

  parts.push(pngChunk('acTL', u32(frames.length, numPlays)));

  let seq = 0;
  if (defaultStaticFrame) {
    const raw = filterScanlines(defaultStaticFrame, width, height, bpp, 0);
    const compressed = await zlibCompress(raw);
    parts.push(pngChunk('IDAT', compressed));
  }

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const fw = f.width ?? width;
    const fh = f.height ?? height;
    const fx = f.xOffset ?? 0;
    const fy = f.yOffset ?? 0;
    const fctlData = concat(
      u32(seq++, fw, fh, fx, fy),
      new Uint8Array([
        ((f.delayNum ?? 10) >> 8) & 0xff, (f.delayNum ?? 10) & 0xff,
        ((f.delayDen ?? 100) >> 8) & 0xff, (f.delayDen ?? 100) & 0xff,
        f.disposeOp ?? 0,
        f.blendOp ?? 0,
      ])
    );
    parts.push(pngChunk('fcTL', fctlData));

    const raw = filterScanlines(f.pixels, fw, fh, bpp, f.filterMode ?? 0);
    const compressed = await zlibCompress(raw);
    if (i === 0 && !defaultStaticFrame) {
      parts.push(pngChunk('IDAT', compressed));
    } else {
      parts.push(pngChunk('fdAT', concat(u32(seq++), compressed)));
    }
  }

  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return concat(...parts);
}

// ============================================================================
// Animated WebP RIFF Builder for Tests
// ============================================================================

function riffChunk(id, payload) {
  const pad = payload.length & 1;
  const out = new Uint8Array(8 + payload.length + pad);
  out.set(text(id), 0);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

function u24le(val) {
  return new Uint8Array([val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff]);
}

function buildAnimatedWebPClean({
  width = 16,
  height = 12,
  loopCount = 0,
  frames = [
    { x: 0, y: 0, width: 16, height: 12, durationMs: 100, dispose: false, doNotBlend: true, hasAlpha: false },
    { x: 0, y: 0, width: 16, height: 12, durationMs: 100, dispose: false, doNotBlend: true, hasAlpha: false },
  ],
} = {}) {
  const vp8xFlags = 0x02 | (frames.some(f => f.hasAlpha) ? 0x10 : 0x00);
  const vp8x = riffChunk('VP8X', concat(new Uint8Array([vp8xFlags, 0, 0, 0]), u24le(width - 1), u24le(height - 1)));
  const anim = riffChunk('ANIM', concat(new Uint8Array([0, 0, 0, 0]), u16le(loopCount)));

  const anmfChunks = frames.map((f, idx) => {
    const flags = (f.dispose ? 0x01 : 0x00) | (f.doNotBlend ? 0x02 : 0x00);
    const fw = f.width ?? width;
    const fh = f.height ?? height;
    const header = concat(
      u24le((f.x ?? 0) >> 1),
      u24le((f.y ?? 0) >> 1),
      u24le(fw - 1),
      u24le(fh - 1),
      u24le(f.durationMs ?? 100),
      new Uint8Array([flags])
    );
    const subChunks = [];
    if (f.hasAlpha) {
      subChunks.push(riffChunk('ALPH', new Uint8Array([0x00, idx & 0xff, 0x01])));
      subChunks.push(riffChunk('VP8 ', new Uint8Array([0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, fw & 0xff, (fw >> 8) & 0x3f, fh & 0xff, (fh >> 8) & 0x3f])));
    } else {
      const bits = ((fw - 1) & 0x3fff) | (((fh - 1) & 0x3fff) << 14);
      subChunks.push(riffChunk('VP8L', new Uint8Array([0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff, idx & 0xff])));
    }
    return riffChunk('ANMF', concat(header, ...subChunks));
  });

  const body = concat(vp8x, anim, ...anmfChunks);
  const riffSize = new Uint8Array(4);
  new DataView(riffSize.buffer).setUint32(0, 4 + body.length, true);
  return concat(text('RIFF'), riffSize, text('WEBP'), body);
}

// ============================================================================
// Tests: Exports & Format Detection
// ============================================================================

test('exports default parseWigglegram and all named helper functions', () => {
  assert.equal(parseWigglegramDefault, parseWigglegram);
  assert.equal(typeof detectAnimationFormat, 'function');
  assert.equal(typeof isAnimatedWigglegram, 'function');
  assert.equal(typeof readGifFrames, 'function');
  assert.equal(typeof readWebPAnimation, 'function');
  assert.equal(typeof readApng, 'function');
  assert.equal(typeof selectExtremeFrames, 'function');
});

test('detectAnimationFormat, isAnimatedWigglegram, and mayBeAnimatedWigglegram distinguish static vs animated containers', async () => {
  const gif1 = buildGif({ frames: [{ indices: [0, 1, 2, 3] }] });
  const gif2 = buildGif({
    version: 'GIF87a',
    frames: [
      { indices: [0, 0, 0, 0], gce: false },
      { indices: [1, 1, 1, 1], gce: false },
    ],
  });
  // 1-frame GIF containing 0x2C inside a comment block must NOT be misidentified as 2 frames
  const gif1WithCommaComment = buildGif({
    comment: 'hello,world,,,',
    frames: [{ indices: [0, 1, 2, 3] }],
  });

  assert.equal(detectAnimationFormat(gif1), 'gif');
  assert.equal(isAnimatedWigglegram(gif1), false);
  assert.equal(mayBeAnimatedWigglegram(gif1), false);

  assert.equal(isAnimatedWigglegram(gif1WithCommaComment), false);
  assert.equal(mayBeAnimatedWigglegram(gif1WithCommaComment), false);

  assert.equal(detectAnimationFormat(gif2), 'gif');
  assert.equal(isAnimatedWigglegram(gif2), true);
  assert.equal(mayBeAnimatedWigglegram(gif2), true);

  // Static PNG and sTER PNG must NOT be detected as APNG
  const staticPng = createTestPNG({ width: 8, height: 4 });
  const sterPng = createTestPNG({ width: 8, height: 4, sterMode: 1 });
  assert.equal(detectAnimationFormat(staticPng), null);
  assert.equal(isAnimatedWigglegram(staticPng), false);
  assert.equal(mayBeAnimatedWigglegram(staticPng), false);
  assert.equal(mayBeAnimatedWigglegram(sterPng), false);

  // 1-frame APNG vs 2-frame APNG
  const apng1 = await buildApng({
    width: 2,
    height: 2,
    frames: [{ pixels: new Uint8Array(16).fill(255) }],
  });
  const apng2 = await buildApng({
    width: 2,
    height: 2,
    frames: [
      { pixels: new Uint8Array(16).fill(255) },
      { pixels: new Uint8Array(16).fill(128) },
    ],
  });
  assert.equal(detectAnimationFormat(apng1), 'apng');
  assert.equal(isAnimatedWigglegram(apng1), false);
  assert.equal(mayBeAnimatedWigglegram(apng1), false);

  assert.equal(detectAnimationFormat(apng2), 'apng');
  assert.equal(isAnimatedWigglegram(apng2), true);
  assert.equal(mayBeAnimatedWigglegram(apng2), true);

  // Static WebP vs Animated WebP
  const vp8lChunk = riffChunk('VP8L', new Uint8Array([0x2f, 0x03, 0x00, 0x00, 0x00, 0x00]));
  const staticWebpSize = new Uint8Array(4);
  new DataView(staticWebpSize.buffer).setUint32(0, 4 + vp8lChunk.length, true);
  const staticWebp = concat(text('RIFF'), staticWebpSize, text('WEBP'), vp8lChunk);
  const animWebp = buildAnimatedWebPClean();

  assert.equal(detectAnimationFormat(staticWebp), 'webp');
  assert.equal(isAnimatedWigglegram(staticWebp), false);
  assert.equal(mayBeAnimatedWigglegram(staticWebp), false);

  assert.equal(detectAnimationFormat(animWebp), 'webp');
  assert.equal(isAnimatedWigglegram(animWebp), true);
  assert.equal(mayBeAnimatedWigglegram(animWebp), true);

  // Garbage / null / truncated
  assert.equal(detectAnimationFormat(new Uint8Array([1, 2, 3])), null);
  assert.equal(isAnimatedWigglegram(null), false);
  assert.equal(mayBeAnimatedWigglegram(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), false);
});

// ============================================================================
// Tests: Pure-JS GIF89a LZW Decoding, Interlacing, Transparency, Disposal
// ============================================================================

test('readGifFrames decodes multi-color LZW frames, LCT, and interlaced scanlines accurately', () => {
  // 4x8 image (8 rows triggers all 4 GIF interlace passes: 0, 4, 2, 6, 1, 3, 5, 7)
  const width = 4;
  const height = 8;
  const frame0Rows = [];
  for (let y = 0; y < height; y++) {
    const color = y % 4;
    frame0Rows.push(color, color, color, color);
  }
  // Reorder rows into GIF interlace pass order: [0, 4, 2, 6, 1, 3, 5, 7]
  const passOrder = [0, 4, 2, 6, 1, 3, 5, 7];
  const interlacedIndices = [];
  for (const row of passOrder) {
    interlacedIndices.push(...frame0Rows.slice(row * width, (row + 1) * width));
  }

  // Frame 1 uses Local Color Table: [10,20,30], [40,50,60], [70,80,90], [100,110,120]
  const frame1Indices = new Array(width * height).fill(2);

  const gifBytes = buildGif({
    width,
    height,
    frames: [
      { indices: interlacedIndices, interlaced: true, delayCs: 15 },
      {
        indices: frame1Indices,
        lct: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
        delayCs: 25,
      },
    ],
  });

  const decoded = readGifFrames(gifBytes);
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 8);
  assert.equal(decoded.frames.length, 2);
  assert.equal(decoded.frames[0].delayMs, 150);
  assert.equal(decoded.frames[1].delayMs, 250);

  // Verify de-interlaced rows in Frame 0: row 0=Red, row 1=Green, row 2=Blue, row 3=Yellow
  const d0 = decoded.frames[0].data;
  assert.deepEqual(Array.from(d0.subarray(0, 4)), [255, 0, 0, 255]); // y=0
  assert.deepEqual(Array.from(d0.subarray(1 * width * 4, 1 * width * 4 + 4)), [0, 255, 0, 255]); // y=1
  assert.deepEqual(Array.from(d0.subarray(2 * width * 4, 2 * width * 4 + 4)), [0, 0, 255, 255]); // y=2
  assert.deepEqual(Array.from(d0.subarray(3 * width * 4, 3 * width * 4 + 4)), [255, 255, 0, 255]); // y=3

  // Verify LCT color index 2 in Frame 1 -> [70, 80, 90, 255]
  const d1 = decoded.frames[1].data;
  assert.deepEqual(Array.from(d1.subarray(0, 4)), [70, 80, 90, 255]);
});

test('readGifFrames applies GIF89a transparency and disposal methods 1, 2, and 3', () => {
  // 2x2 canvas, 4 frames testing keep (1), background clear (2), and previous restore (3)
  const gif = buildGif({
    width: 2,
    height: 2,
    frames: [
      // Frame 0: all Red (0), disposal=1 (keep)
      { indices: [0, 0, 0, 0], disposal: 1 },
      // Frame 1: Green (1) at pixel 0, transparent (3) elsewhere, disposal=3 (restore to previous = Frame 0)
      { indices: [1, 3, 3, 3], transparentIndex: 3, disposal: 3 },
      // Frame 2: Blue (2) at pixel 3, transparent (3) elsewhere, disposal=2 (clear to transparent)
      { indices: [3, 3, 3, 2], transparentIndex: 3, disposal: 2 },
      // Frame 3: Yellow (3) at pixel 0, transparent (0) elsewhere -> pixels 1..3 were cleared by disposal=2
      { indices: [3, 0, 0, 0], transparentIndex: 0, disposal: 1 },
    ],
  });

  const { frames } = readGifFrames(gif);
  assert.equal(frames.length, 4);

  // Frame 1: pixel 0 is Green, pixels 1..3 remain Red from Frame 0
  assert.deepEqual(Array.from(frames[1].data.subarray(0, 8)), [0, 255, 0, 255, 255, 0, 0, 255]);

  // Frame 2: after Frame 1 disposal=3 restored Frame 0, pixel 0 is Red again and pixel 3 is Blue
  assert.deepEqual(Array.from(frames[2].data.subarray(0, 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(frames[2].data.subarray(12, 16)), [0, 0, 255, 255]);

  // Frame 3: after Frame 2 disposal=2 cleared the 2x2 canvas, pixel 0 is Yellow and pixels 1..3 are transparent [0,0,0,0]
  assert.deepEqual(Array.from(frames[3].data.subarray(0, 4)), [255, 255, 0, 255]);
  assert.deepEqual(Array.from(frames[3].data.subarray(4, 8)), [0, 0, 0, 0]);
});

test('readGifFrames and parseWigglegram reject invalid dimensions, mismatched frames, and truncated LZW', async () => {
  // Zero logical screen dimension
  const zeroScreen = buildGif({ width: 0, height: 10, frames: [{ indices: [0] }] });
  assert.throws(() => readGifFrames(zeroScreen), /Invalid GIF logical screen dimensions/);

  // Truncated LZW sub-block (missing 0x00 block terminator and 0x3B trailer)
  const valid = buildGif({ width: 4, height: 4, frames: [{ indices: new Array(16).fill(0) }, { indices: new Array(16).fill(1) }] });
  const truncated = valid.subarray(0, valid.length - 4);
  await assert.rejects(() => parseWigglegram('data:image/gif;base64,unused', { bytes: truncated }));

  // Corrupted LZW minimum code size (> 8)
  const badMinCode = new Uint8Array(valid);
  const firstDescIdx = badMinCode.indexOf(0x2c);
  badMinCode[firstDescIdx + 10] = 9;
  assert.throws(() => readGifFrames(badMinCode), /Invalid GIF LZW minimum code size/);
});

// ============================================================================
// Tests: Pure-JS APNG Parser & DecompressionStream('deflate') Unfiltering
// ============================================================================

test('readApng decodes fcTL-before-IDAT APNG across all 5 PNG scanline filters and blend/dispose ops', async () => {
  // 4x5 RGBA image exercising filters 0 (None), 1 (Sub), 2 (Up), 3 (Average), 4 (Paeth)
  const width = 4;
  const height = 5;
  const frame0 = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      frame0[idx] = (x * 40 + y * 20) & 0xff;
      frame0[idx + 1] = (100 + x * 15) & 0xff;
      frame0[idx + 2] = (200 - y * 25) & 0xff;
      frame0[idx + 3] = 255;
    }
  }

  // Frame 1: 2x2 sub-rectangle at (1, 1) with semi-transparent red blended OVER frame0 (blendOp=1)
  const frame1 = new Uint8Array([
    255, 0, 0, 128,   255, 0, 0, 128,
    255, 0, 0, 128,   255, 0, 0, 128,
  ]);

  const apngBytes = await buildApng({
    width,
    height,
    colorType: 6,
    frames: [
      { pixels: frame0, filterMode: (y) => y % 5, disposeOp: 0, blendOp: 0, delayNum: 1, delayDen: 10 },
      { pixels: frame1, width: 2, height: 2, xOffset: 1, yOffset: 1, filterMode: 4, disposeOp: 1, blendOp: 1, delayNum: 2, delayDen: 10 },
    ],
  });

  const decoded = await readApng(apngBytes);
  assert.equal(decoded.format, 'apng');
  assert.equal(decoded.isAnimated, true);
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 5);
  assert.equal(decoded.frames.length, 2);
  assert.equal(decoded.frames[0].delayMs, 100);
  assert.equal(decoded.frames[1].delayMs, 200);

  // Frame 0 must match original uncompressed RGBA byte-for-byte
  assert.deepEqual(Array.from(decoded.frames[0].data), Array.from(frame0));

  // Frame 1: pixel (0,0) untouched, pixel (1,1) alpha-blended with semi-transparent red
  assert.deepEqual(Array.from(decoded.frames[1].data.subarray(0, 4)), Array.from(frame0.subarray(0, 4)));
  const p11 = (1 * width + 1) * 4;
  assert.ok(decoded.frames[1].data[p11] > frame0[p11], 'Red channel must increase after semi-transparent red blend');
  assert.equal(decoded.frames[1].data[p11 + 3], 255);

  // parseWigglegram on APNG data URL returns valid StereoData
  const dataUrl = 'data:image/png;base64,' + Buffer.from(apngBytes).toString('base64');
  const stereo = await parseWigglegram(dataUrl);
  assert.equal(stereo.leftEye.width, 4);
  assert.equal(stereo.leftEye.height, 5);
  assert.deepEqual(Array.from(stereo.leftEye.data), Array.from(frame0));
  assert.deepEqual(Array.from(stereo.rightEye.data), Array.from(decoded.frames[1].data));
});

test('readApng supports IDAT-before-fcTL (static fallback + fdAT frames) and indexed PLTE+tRNS', async () => {
  const plte = new Uint8Array([
    10, 20, 30,   // 0
    200, 100, 50, // 1
  ]);
  const trns = new Uint8Array([255, 255]);
  const apngBytes = await buildApng({
    width: 2,
    height: 2,
    colorType: 3,
    plte,
    trns,
    defaultStaticFrame: new Uint8Array([0, 0, 0, 0]),
    frames: [
      { pixels: new Uint8Array([0, 1, 0, 1]), disposeOp: 0, blendOp: 0 },
      { pixels: new Uint8Array([1, 0, 1, 0]), disposeOp: 0, blendOp: 0 },
    ],
  });

  const decoded = await readApng(apngBytes);
  assert.equal(decoded.frames.length, 2);
  // Frame 0 pixel (0,0)=color 0, pixel (1,0)=color 1
  assert.deepEqual(Array.from(decoded.frames[0].data.subarray(0, 8)), [10, 20, 30, 255, 200, 100, 50, 255]);
  // Frame 1 pixel (0,0)=color 1, pixel (1,0)=color 0
  assert.deepEqual(Array.from(decoded.frames[1].data.subarray(0, 8)), [200, 100, 50, 255, 10, 20, 30, 255]);
});

test('readApng rejects truncated APNGs and supports ImageDecoder fallback for interlaced APNGs', async () => {
  const validApng = await buildApng({
    width: 2,
    height: 2,
    frames: [
      { pixels: new Uint8Array(16).fill(10) },
      { pixels: new Uint8Array(16).fill(20) },
    ],
  });
  await assert.rejects(() => readApng(validApng.subarray(0, validApng.length - 12)), /Truncated/);

  // Interlaced APNG triggers ImageDecoder path when available
  const interlacedApng = new Uint8Array(validApng);
  // IHDR interlace byte is at offset 8 (sig) + 8 (chunk hdr) + 12 = 28
  interlacedApng[28] = 1;

  const origDecoder = global.ImageDecoder;
  let closedDecoder = false;
  let closedFrames = 0;
  global.ImageDecoder = class MockApngDecoder {
    static async isTypeSupported(mime) {
      return mime === 'image/png';
    }
    constructor() {
      this.tracks = {
        ready: Promise.resolve(),
        selectedTrack: { frameCount: 2 },
      };
    }
    async decode({ frameIndex }) {
      const fillVal = frameIndex === 0 ? 40 : 210;
      return {
        image: {
          copyTo: async (dest) => dest.fill(fillVal),
          close: () => { closedFrames++; },
        },
      };
    }
    close() {
      closedDecoder = true;
    }
  };

  try {
    const decoded = await readApng(interlacedApng);
    assert.equal(decoded.frames.length, 2);
    assert.equal(decoded.frames[0].data[0], 40);
    assert.equal(decoded.frames[1].data[0], 210);
    assert.equal(closedDecoder, true);
    assert.equal(closedFrames, 2);
  } finally {
    global.ImageDecoder = origDecoder;
  }
});

// ============================================================================
// Tests: Pure-JS Animated WebP RIFF/VP8X/ANIM/ANMF & Fallbacks
// ============================================================================

test('readWebPAnimation parses VP8X/ANIM/ANMF, repackages single-frame WebPs, and uses ImageDecoder when available', async () => {
  const webpBytes = buildAnimatedWebPClean({
    width: 24,
    height: 16,
    loopCount: 3,
    frames: [
      { x: 0, y: 0, width: 24, height: 16, durationMs: 80, dispose: true, doNotBlend: true, hasAlpha: true },
      { x: 4, y: 2, width: 12, height: 10, durationMs: 120, dispose: false, doNotBlend: false, hasAlpha: false },
    ],
  });

  // 1. Pure Node path (without ImageDecoder or DOM)
  const structural = await readWebPAnimation(webpBytes);
  assert.equal(structural.format, 'webp');
  assert.equal(structural.width, 24);
  assert.equal(structural.height, 16);
  assert.equal(structural.loopCount, 3);
  assert.equal(structural.isAnimated, true);
  assert.equal(structural.frames.length, 2);
  assert.equal(structural.frames[0].delayMs, 80);
  assert.equal(structural.frames[1].left, 4);
  assert.equal(structural.frames[1].top, 2);

  // Verify repackaged Frame 0 is a valid standalone RIFF WEBP with VP8X alpha flag + ALPH + VP8
  const f0Bytes = structural.frames[0].frameBytes;
  assert.equal(String.fromCharCode(...f0Bytes.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...f0Bytes.subarray(8, 12)), 'WEBP');
  assert.equal(String.fromCharCode(...f0Bytes.subarray(12, 16)), 'VP8X');
  assert.equal(f0Bytes[20], 0x10);

  // 2. Mock ImageDecoder path
  const origDecoder = global.ImageDecoder;
  global.ImageDecoder = class MockWebPDecoder {
    static async isTypeSupported(mime) {
      return mime === 'image/webp';
    }
    constructor() {
      this.tracks = {
        ready: Promise.resolve(),
        selectedTrack: { frameCount: 2 },
      };
    }
    async decode({ frameIndex }) {
      const val = frameIndex === 0 ? 15 : 240;
      return {
        image: {
          copyTo: async (dest) => dest.fill(val),
          close: () => {},
        },
      };
    }
    close() {}
  };

  try {
    const stereo = await parseWigglegram('https://example.com/anim.webp', { bytes: webpBytes });
    assert.equal(stereo.leftEye.width, 24);
    assert.equal(stereo.leftEye.height, 16);
    assert.equal(stereo.leftEye.data[0], 15);
    assert.equal(stereo.rightEye.data[0], 240);
  } finally {
    global.ImageDecoder = origDecoder;
  }
});

test('readWebPAnimation rejects truncated/malformed RIFF/ANMF chunks', async () => {
  const valid = buildAnimatedWebPClean();
  await assert.rejects(() => readWebPAnimation(valid.subarray(0, valid.length - 6)), /Truncated/);
  await assert.rejects(() => readWebPAnimation(text('NOTWEBP12345')), /Invalid WebP RIFF/);
});

// ============================================================================
// Tests: selectExtremeFrames (Linear, Ping-Pong, Eye Order, Overrides)
// ============================================================================

test('selectExtremeFrames handles 1-frame mono, 2-frame, linear sweep, ping-pong loops, and eyeOrder', () => {
  const makeFrame = (r) => ({
    width: 4,
    height: 4,
    data: new Uint8ClampedArray(64).fill(r),
  });

  // 1 frame -> mono [0, 0]
  const s1 = selectExtremeFrames([makeFrame(10)]);
  assert.equal(s1.leftIndex, 0);
  assert.equal(s1.rightIndex, 0);
  assert.equal(s1.isAnimated, false);

  // 2 frames -> [0, 1]
  const s2 = selectExtremeFrames([makeFrame(10), makeFrame(200)]);
  assert.equal(s2.leftIndex, 0);
  assert.equal(s2.rightIndex, 1);

  // 4-frame linear sweep (0 -> 80 -> 160 -> 240) -> [0, 3]
  const linear4 = [makeFrame(0), makeFrame(80), makeFrame(160), makeFrame(240)];
  const sLin = selectExtremeFrames(linear4);
  assert.equal(sLin.leftIndex, 0);
  assert.equal(sLin.rightIndex, 3);

  // 6-frame ping-pong (0 -> 80 -> 160 -> 240 -> 160 -> 80) -> [0, 3]
  const pingPong6 = [
    makeFrame(0), makeFrame(80), makeFrame(160),
    makeFrame(240), makeFrame(160), makeFrame(80),
  ];
  const sPP6 = selectExtremeFrames(pingPong6);
  assert.equal(sPP6.leftIndex, 0);
  assert.equal(sPP6.rightIndex, 3);

  // 5-frame odd ping-pong (0 -> 120 -> 240 -> 120 -> 0) -> [0, 2]
  const pingPong5 = [makeFrame(0), makeFrame(120), makeFrame(240), makeFrame(120), makeFrame(0)];
  const sPP5 = selectExtremeFrames(pingPong5);
  assert.equal(sPP5.leftIndex, 0);
  assert.equal(sPP5.rightIndex, 2);

  // eyeOrder: 'right-left' or type: 'wiggle-right-left' swaps left and right
  const sRev = selectExtremeFrames(pingPong6, { eyeOrder: 'right-left' });
  assert.equal(sRev.leftIndex, 3);
  assert.equal(sRev.rightIndex, 0);

  const sTypeRev = selectExtremeFrames(linear4, { type: 'wiggle-right-left' });
  assert.equal(sTypeRev.leftIndex, 3);
  assert.equal(sTypeRev.rightIndex, 0);

  // Explicit frame overrides + out-of-range check
  const sExplicit = selectExtremeFrames(linear4, { leftFrame: 1, rightFrame: 2 });
  assert.equal(sExplicit.leftIndex, 1);
  assert.equal(sExplicit.rightIndex, 2);
  assert.throws(() => selectExtremeFrames(linear4, { rightFrame: 9 }), RangeError);
});

// ============================================================================
// Tests: Hardened Data URLs, FOV Angles, and AbortSignal
// ============================================================================

test('parseWigglegram handles uppercase/whitespace DATA URLs, FOV angle overrides, and AbortSignal', async () => {
  const gif = buildGif({
    width: 20,
    height: 10,
    frames: [
      { indices: new Array(200).fill(0) },
      { indices: new Array(200).fill(2) },
    ],
  });
  const b64 = Buffer.from(gif).toString('base64');
  const messyDataUrl = `  DATA:image/gif;charset=utf-8;BASE64, ${b64.slice(0, 12)}\n${b64.slice(12)} `;

  const decoded = decodeDataUrlBytes(messyDataUrl);
  assert.deepEqual(decoded, gif);

  const stereo180 = await parseWigglegram(messyDataUrl, { angle: 180 });
  assert.ok(Math.abs(stereo180.phiLength - Math.PI) < 1e-6);
  assert.ok(Math.abs(stereo180.thetaLength - Math.PI) < 1e-6);

  const stereoFisheye = await parseWigglegram(messyDataUrl, { projection: 'fisheye' });
  assert.equal(stereoFisheye.projection, 'fisheye');
  assert.ok(Math.abs(stereoFisheye.phiLength - Math.PI) < 1e-6);

  // Pre-aborted signal rejects with AbortError
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => parseWigglegram(messyDataUrl, { signal: ac.signal }),
    (err) => err.name === 'AbortError'
  );
});

// ============================================================================
// Tests: <stereo-img> Explicit & Auto-Detection Routing
// ============================================================================

test('<stereo-img> routes explicit wiggle types and auto-detects animated wigglegrams without hijacking static images', async () => {
  const gifAnim = buildGif({
    width: 4,
    height: 4,
    frames: [
      { indices: new Array(16).fill(0) }, // Red
      { indices: new Array(16).fill(2) }, // Blue
    ],
  });
  const gifStatic = buildGif({
    width: 4,
    height: 4,
    frames: [{ indices: new Array(16).fill(1) }],
  });
  const apngAnim = await buildApng({
    width: 2,
    height: 2,
    frames: [
      { pixels: new Uint8Array(16).fill(50) },
      { pixels: new Uint8Array(16).fill(220) },
    ],
  });
  const sterPng = createTestPNG({ width: 8, height: 4, sterMode: 0 });

  const makeFakePicture = (url, bytes) => ({
    url,
    objectURL: async () => url,
    bytes: async () => bytes,
    release: () => {},
  });

  // 1. Auto-detection of 2-frame GIF
  const autoGif = await StereoImg.prototype._parsePicture.call(
    {},
    makeFakePicture('https://example.com/wiggle.gif', gifAnim),
    null,
    {}
  );
  assert.deepEqual(Array.from(autoGif.leftEye.data.subarray(0, 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(autoGif.rightEye.data.subarray(0, 4)), [0, 0, 255, 255]);

  // 2. Explicit type="wiggle-right-left" swaps eyes
  const explicitRev = await StereoImg.prototype._parsePicture.call(
    {},
    makeFakePicture('https://example.com/wiggle.gif', gifAnim),
    null,
    { type: 'wiggle-right-left' }
  );
  assert.deepEqual(Array.from(explicitRev.leftEye.data.subarray(0, 4)), [0, 0, 255, 255]);
  assert.deepEqual(Array.from(explicitRev.rightEye.data.subarray(0, 4)), [255, 0, 0, 255]);

  // 3. Auto-detection of 2-frame APNG
  const autoApng = await StereoImg.prototype._parsePicture.call(
    {},
    makeFakePicture('https://example.com/wiggle.png', apngAnim),
    null,
    {}
  );
  assert.equal(autoApng.leftEye.data[0], 50);
  assert.equal(autoApng.rightEye.data[0], 220);

  // 4. Static 1-frame GIF is NOT hijacked by wiggle-parser (falls through to _isStereo -> parseMono)
  assert.equal(mayBeAnimatedWigglegram(gifStatic), false);
  let checkedIsStereo = false;
  const fakeStereoImg = {
    _isStereo: async () => {
      checkedIsStereo = true;
      return false;
    },
  };
  await withMockMonoDOM(async () => {
    const staticFallthrough = await StereoImg.prototype._parsePicture.call(
      fakeStereoImg,
      makeFakePicture('https://example.com/static.gif', gifStatic),
      null,
      {}
    );
    assert.equal(checkedIsStereo, true, 'Static 1-frame GIF must fall through to _isStereo / parseMono');
    assert.ok(staticFallthrough.leftEye && staticFallthrough.rightEye);
    assert.deepEqual(staticFallthrough.leftEye, staticFallthrough.rightEye);
  });

  // 5. PNG with sTER chunk is NOT hijacked by wiggle-parser
  assert.equal(mayBeAnimatedWigglegram(sterPng), false);
});

// ============================================================================
// Tests: Iteration 2 Hardening (Deflate Errors, APNG seq/acTL, Abort, 3-Frame)
// ============================================================================

test('readApng and parseWigglegram reject corrupted APNG deflate data with zero unhandled rejections', async () => {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk('IHDR', concat(u32(2, 2), new Uint8Array([8, 6, 0, 0, 0])));
  const actl = pngChunk('acTL', u32(1, 0));
  const fctl = pngChunk('fcTL', concat(u32(0, 2, 2, 0, 0), new Uint8Array([0, 10, 0, 100, 0, 0])));
  const badIdat = pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0xff, 0xff, 0x00, 0x11, 0x22, 0x33]));
  const iend = pngChunk('IEND', new Uint8Array(0));
  const corruptApng = concat(sig, ihdr, actl, fctl, badIdat, iend);

  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await assert.rejects(() => readApng(corruptApng));
    await assert.rejects(() => parseWigglegram('data:image/png;base64,unused', { bytes: corruptApng }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(unhandled.length, 0, `Expected 0 unhandled rejections, got ${unhandled.length}`);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('readApng validates monotonic fcTL/fdAT sequence numbers and missing acTL edge cases', async () => {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk('IHDR', concat(u32(2, 2), new Uint8Array([8, 6, 0, 0, 0])));
  const iend = pngChunk('IEND', new Uint8Array(0));

  const validPixels = new Uint8Array(16).fill(180);
  const rawScanlines = filterScanlines(validPixels, 2, 2, 4, 0);
  const compressed = await zlibCompress(rawScanlines);

  const makeFctl = (seq) =>
    pngChunk('fcTL', concat(u32(seq, 2, 2, 0, 0), new Uint8Array([0, 10, 0, 100, 0, 0])));

  // 1. fcTL starting at wrong sequence number (5 instead of 0)
  const badFctlStart = concat(
    sig, ihdr, pngChunk('acTL', u32(1, 0)), makeFctl(5), pngChunk('IDAT', compressed), iend
  );
  await assert.rejects(() => readApng(badFctlStart), /fcTL sequence_number: expected 0, got 5/);

  // 2. fdAT with non-monotonic sequence number (999 instead of 2)
  const badFdatSeq = concat(
    sig, ihdr, pngChunk('acTL', u32(2, 0)),
    makeFctl(0), pngChunk('IDAT', compressed),
    makeFctl(1), pngChunk('fdAT', concat(u32(999), compressed)),
    iend
  );
  await assert.rejects(() => readApng(badFdatSeq), /fdAT sequence_number: expected 2, got 999/);

  // 3. Missing acTL with fcTL + IDAT decodes as 1-frame static PNG (no spurious empty 2nd frame)
  const fctlNoActl = concat(sig, ihdr, makeFctl(0), pngChunk('IDAT', compressed), iend);
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const decoded = await readApng(fctlNoActl);
    assert.equal(decoded.isAnimated, false);
    assert.equal(decoded.frames.length, 1);
    assert.deepEqual(Array.from(decoded.frames[0].data), Array.from(validPixels));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(unhandled.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }

  // 4. fdAT without acTL must be explicitly rejected
  const fdatNoActl = concat(
    sig, ihdr,
    makeFctl(0), pngChunk('IDAT', compressed),
    makeFctl(1), pngChunk('fdAT', concat(u32(2), compressed)),
    iend
  );
  await assert.rejects(() => readApng(fdatNoActl), /fdAT chunk encountered without acTL/);

  // 5. Orphan fcTL after IDAT without acTL must be rejected cleanly
  const orphanFctlNoActl = concat(sig, ihdr, pngChunk('IDAT', compressed), makeFctl(0), iend);
  await assert.rejects(() => readApng(orphanFctlNoActl), /missing image data/);
});

test('readApng and readWebPAnimation check AbortSignal after ImageDecoder final-frame decode', async () => {
  const validApng = await buildApng({
    width: 2,
    height: 2,
    frames: [
      { pixels: new Uint8Array(16).fill(10) },
      { pixels: new Uint8Array(16).fill(20) },
    ],
  });
  const interlacedApng = new Uint8Array(validApng);
  interlacedApng[28] = 1; // interlace=1 -> ImageDecoder path

  const animWebp = buildAnimatedWebPClean();
  const origDecoder = global.ImageDecoder;

  for (const [label, runDecode] of [
    ['apng', (signal) => readApng(interlacedApng, { signal })],
    ['webp', (signal) => readWebPAnimation(animWebp, { signal })],
  ]) {
    const controller = new AbortController();
    let closedFrames = 0;
    let closedDecoder = false;

    global.ImageDecoder = class AbortOnLastFrameDecoder {
      static async isTypeSupported() {
        return true;
      }
      constructor() {
        this.tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 2 } };
      }
      async decode({ frameIndex }) {
        if (frameIndex === 1) {
          controller.abort();
        }
        return {
          image: {
            copyTo: async (dest) => dest.fill(frameIndex),
            close: () => { closedFrames++; },
          },
        };
      }
      close() {
        closedDecoder = true;
      }
    };

    try {
      await assert.rejects(
        () => runDecode(controller.signal),
        (err) => err.name === 'AbortError',
        `${label} ImageDecoder must abort when signal aborts on final frame`
      );
      assert.equal(closedFrames, 2, `${label} must close decoded VideoFrames on abort`);
      assert.equal(closedDecoder, true, `${label} must close ImageDecoder on abort`);
    } finally {
      global.ImageDecoder = origDecoder;
    }
  }
});

test('selectExtremeFrames detects 3-frame [A, B, A] ping-pong and aligns WebP 1-frame / chunk-order bounds', async () => {
  const makeFrame = (r) => ({
    width: 4,
    height: 4,
    data: new Uint8ClampedArray(64).fill(r),
  });

  // 3-frame [A, B, A] ping-pong -> [0, 1]
  const pp3 = selectExtremeFrames([makeFrame(10), makeFrame(240), makeFrame(10)]);
  assert.equal(pp3.leftIndex, 0);
  assert.equal(pp3.rightIndex, 1);

  // 3-frame [L, M, R] linear sweep -> [0, 2]
  const lin3 = selectExtremeFrames([makeFrame(10), makeFrame(125), makeFrame(240)]);
  assert.equal(lin3.leftIndex, 0);
  assert.equal(lin3.rightIndex, 2);

  // 1-frame WebP with VP8X animation flag + ANIM + 1 ANMF -> both isAnimatedWigglegram & mayBeAnimatedWigglegram return false
  const singleFrameAnimWebp = buildAnimatedWebPClean({
    width: 16,
    height: 12,
    frames: [{ x: 0, y: 0, width: 16, height: 12 }],
  });
  assert.equal(isAnimatedWigglegram(singleFrameAnimWebp), false);
  assert.equal(mayBeAnimatedWigglegram(singleFrameAnimWebp), false);

  // WebP with ANMF placed BEFORE VP8X whose bounds exceed VP8X canvas -> rejected post-loop
  const anmfBad = (() => {
    const header = concat(
      u24le(0), u24le(0), u24le(19), u24le(11), u24le(100), new Uint8Array([0x02])
    ); // 20x12
    const bits = (19 & 0x3fff) | ((11 & 0x3fff) << 14);
    const vp8l = riffChunk('VP8L', new Uint8Array([0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff, 0x00]));
    return riffChunk('ANMF', concat(header, vp8l));
  })();
  const vp8xSmall = riffChunk('VP8X', concat(new Uint8Array([0x02, 0, 0, 0]), u24le(15), u24le(11))); // 16x12
  const outOfOrderBody = concat(anmfBad, vp8xSmall);
  const riffSize = new Uint8Array(4);
  new DataView(riffSize.buffer).setUint32(0, 4 + outOfOrderBody.length, true);
  const badOrderWebp = concat(text('RIFF'), riffSize, text('WEBP'), outOfOrderBody);
  await assert.rejects(() => readWebPAnimation(badOrderWebp), /exceed canvas dimensions/);
});

// ============================================================================
// Tests: Iteration 3 Turnaround & Subtle-Parallax Frame Selection
// ============================================================================

test('selectExtremeFrames handles 5-frame [0, 1, 2, 3, 2] turnaround and 3-frame subtle-parallax [A, B, A]', async () => {
  const makeFrame = (v) => ({
    width: 4,
    height: 4,
    data: new Uint8ClampedArray(64).fill(v),
  });

  // 1. 5-frame asymmetric ping-pong [0, 1, 2, 3, 2] -> selects (0, 3)
  const pp5Asym = selectExtremeFrames([
    makeFrame(0),
    makeFrame(80),
    makeFrame(160),
    makeFrame(240),
    makeFrame(160),
  ]);
  assert.equal(pp5Asym.leftIndex, 0);
  assert.equal(pp5Asym.rightIndex, 3);

  // Also verify 5-frame symmetric [0, 120, 240, 120, 0] -> (0, 2),
  // 5-frame linear [0, 1, 2, 3, 4] -> (0, 4),
  // 4-frame ping-pong [0, 1, 2, 1] -> (0, 2),
  // and 4-frame linear [0, 1, 2, 3] -> (0, 3)
  const pp5Sym = selectExtremeFrames([makeFrame(0), makeFrame(120), makeFrame(240), makeFrame(120), makeFrame(0)]);
  assert.deepEqual([pp5Sym.leftIndex, pp5Sym.rightIndex], [0, 2]);

  const lin5 = selectExtremeFrames([makeFrame(0), makeFrame(1), makeFrame(2), makeFrame(3), makeFrame(4)]);
  assert.deepEqual([lin5.leftIndex, lin5.rightIndex], [0, 4]);

  const pp4 = selectExtremeFrames([makeFrame(0), makeFrame(1), makeFrame(2), makeFrame(1)]);
  assert.deepEqual([pp4.leftIndex, pp4.rightIndex], [0, 2]);

  const lin4 = selectExtremeFrames([makeFrame(0), makeFrame(1), makeFrame(2), makeFrame(3)]);
  assert.deepEqual([lin4.leftIndex, lin4.rightIndex], [0, 3]);

  // End-to-end parseWigglegram on 5-frame [0, 80, 160, 240, 160] GIF -> leftEye=0, rightEye=240
  const gif5 = buildGif({
    width: 4,
    height: 4,
    gct: [
      0, 0, 0,
      80, 80, 80,
      160, 160, 160,
      240, 240, 240,
    ],
    frames: [
      { indices: new Array(16).fill(0) },
      { indices: new Array(16).fill(1) },
      { indices: new Array(16).fill(2) },
      { indices: new Array(16).fill(3) },
      { indices: new Array(16).fill(2) },
    ],
  });
  const parsed5 = await parseWigglegram('data:image/gif;base64,unused', { bytes: gif5 });
  assert.equal(parsed5.leftEye.data[0], 0);
  assert.equal(parsed5.rightEye.data[0], 240);

  // 2. 3-frame subtle parallax [A, B, A] (15% foreground region delta, midDiff ~0.012) -> selects (0, 1)
  const makeSubtleFrame = (fgVal) => {
    const data = new Uint8ClampedArray(10 * 10 * 4).fill(128);
    for (let i = 0; i < 60; i++) {
      data[i] = fgVal;
    }
    return { width: 10, height: 10, data };
  };
  const subtleSeq = [makeSubtleFrame(100), makeSubtleFrame(120), makeSubtleFrame(100)];
  const subtleSel = selectExtremeFrames(subtleSeq);
  assert.equal(subtleSel.leftIndex, 0);
  assert.equal(subtleSel.rightIndex, 1);

  // 3. 3-frame subtle parallax with eyeOrder: 'right-left' -> selects (1, 0)
  const subtleRev = selectExtremeFrames(subtleSeq, { eyeOrder: 'right-left' });
  assert.equal(subtleRev.leftIndex, 1);
  assert.equal(subtleRev.rightIndex, 0);
});
