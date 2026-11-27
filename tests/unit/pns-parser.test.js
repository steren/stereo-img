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
import fs from 'node:fs';
import path from 'node:path';

import {
  parsePNS,
  parsePNGStereo,
  readSterChunk,
  calculateSubimageBounds,
  crc32,
} from '../../parsers/png-parser/png-parser.js';

// ============================================================================
// Synthetic PNG Fixture Builder
// ============================================================================

/** Builds a single PNG chunk: 4 bytes length, 4 bytes type, data, 4 bytes CRC32. */
export function pngChunk(type, data = new Uint8Array(0)) {
  const typeBytes = new Uint8Array(Array.from(type, c => c.charCodeAt(0)));
  const len = data.length;
  const chunk = new Uint8Array(8 + len + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, len, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  const crcPayload = new Uint8Array(4 + len);
  crcPayload.set(typeBytes, 0);
  crcPayload.set(data, 4);
  view.setUint32(8 + len, crc32(crcPayload), false);
  return chunk;
}

/**
 * Builds an authentic PNG stream containing IHDR, optional sTER, IDAT, and IEND.
 * @param {Object} [options]
 * @param {number} [options.width=16]
 * @param {number} [options.height=8]
 * @param {number} [options.mode=1] - 0: cross-fuse (right-left), 1: diverging-fuse (left-right)
 * @param {boolean} [options.includeSter=true]
 * @param {boolean} [options.sterAfterIdat=false]
 * @param {boolean} [options.corruptCrc=false]
 * @returns {Uint8Array}
 */
export function makePngSter({
  width = 16,
  height = 8,
  mode = 1,
  includeSter = true,
  sterAfterIdat = false,
  corruptCrc = false,
} = {}) {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: 13 bytes
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: Truecolor (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = pngChunk('IHDR', ihdrData);

  // sTER chunk: 1 byte payload
  let sterChunk = null;
  if (includeSter) {
    sterChunk = pngChunk('sTER', new Uint8Array([mode]));
    if (corruptCrc) {
      sterChunk[sterChunk.length - 1] ^= 0xff; // Invert last CRC byte
    }
  }

  // Minimal IDAT & IEND
  const idatChunk = pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]));
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const chunks = [signature, ihdrChunk];
  if (includeSter && !sterAfterIdat) chunks.push(sterChunk);
  chunks.push(idatChunk);
  if (includeSter && sterAfterIdat) chunks.push(sterChunk);
  chunks.push(iendChunk);

  return new Uint8Array(chunks.flatMap(c => Array.from(c)));
}

/** Helper to convert PNG bytes to a data URI. */
function toDataUrl(bytes) {
  return 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
}

// ============================================================================
// DOM Mocks for Node.js Test Environment
// ============================================================================

class FakeImage {
  constructor() {
    this.width = 16;
    this.height = 8;
    this._src = '';
    this.onload = null;
    this.onerror = null;
  }
  set src(v) {
    this._src = v;
    if (v) {
      if (v.startsWith('error') || v === 'corrupt') {
        setImmediate(() => this.onerror?.(new Error('Failed to load image')));
      } else {
        setImmediate(() => this.onload?.());
      }
    }
  }
  get src() {
    return this._src;
  }
}

class FakeImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

global.Image = FakeImage;
global.ImageData = FakeImageData;
global.document = {
  createElement: (tag) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: (x, y, w, h) => {
            const data = new Uint8ClampedArray(w * h * 4);
            return new FakeImageData(data, w, h);
          },
        }),
      };
    }
    return {};
  },
};

// ============================================================================
// 1. CRC32 Checksum Tests
// ============================================================================

test('crc32: correctly calculates standard PNG chunk CRC-32', () => {
  // sTER mode 0 payload: 'sTER\x00'
  const mode0 = new Uint8Array([0x73, 0x54, 0x45, 0x52, 0x00]);
  assert.equal(crc32(mode0), 0xc2e3850a);

  // sTER mode 1 payload: 'sTER\x01'
  const mode1 = new Uint8Array([0x73, 0x54, 0x45, 0x52, 0x01]);
  assert.equal(crc32(mode1), 0xb5e4b59c);

  // Empty payload
  assert.equal(crc32(new Uint8Array(0)), 0);
});

// ============================================================================
// 2. Adam7 Interlacing Subimage Bounds & Padding Calculation
// ============================================================================

test('calculateSubimageBounds: width 160 (divisible by 16) has zero padding', () => {
  const bounds = calculateSubimageBounds(160, 80);
  assert.equal(bounds.padding, 0);
  assert.equal(bounds.subWidth, 80);
  assert.deepStrictEqual(bounds.leftBounds, { x: 0, y: 0, width: 80, height: 80 });
  assert.deepStrictEqual(bounds.rightBounds, { x: 80, y: 0, width: 80, height: 80 });
});

test('calculateSubimageBounds: width 175 (odd width) has 1 pixel padding and right aligned to 8', () => {
  const bounds = calculateSubimageBounds(175, 100);
  // k = ceil(175 / 16) = 11, xRight = 8 * 11 = 88, subWidth = 175 - 88 = 87, padding = 88 - 87 = 1
  assert.equal(bounds.padding, 1);
  assert.equal(bounds.subWidth, 87);
  assert.equal(bounds.rightBounds.x % 8, 0); // Must be multiple of 8 per spec
  assert.deepStrictEqual(bounds.leftBounds, { x: 0, y: 0, width: 87, height: 100 });
  assert.deepStrictEqual(bounds.rightBounds, { x: 88, y: 0, width: 87, height: 100 });
});

test('calculateSubimageBounds: width 204 has 4 pixels padding and right aligned to 8', () => {
  const bounds = calculateSubimageBounds(204, 100);
  // k = ceil(204 / 16) = 13, xRight = 8 * 13 = 104, subWidth = 204 - 104 = 100, padding = 104 - 100 = 4
  assert.equal(bounds.padding, 4);
  assert.equal(bounds.subWidth, 100);
  assert.equal(bounds.rightBounds.x % 8, 0);
  assert.deepStrictEqual(bounds.leftBounds, { x: 0, y: 0, width: 100, height: 100 });
  assert.deepStrictEqual(bounds.rightBounds, { x: 104, y: 0, width: 100, height: 100 });
});

test('calculateSubimageBounds: width 32 (multiple of 16) splits exactly in half', () => {
  const bounds = calculateSubimageBounds(32, 16);
  assert.equal(bounds.padding, 0);
  assert.equal(bounds.subWidth, 16);
  assert.deepStrictEqual(bounds.leftBounds, { x: 0, y: 0, width: 16, height: 16 });
  assert.deepStrictEqual(bounds.rightBounds, { x: 16, y: 0, width: 16, height: 16 });
});

test('calculateSubimageBounds: degenerate small widths fall back safely to 50% split', () => {
  const bounds = calculateSubimageBounds(4, 2);
  assert.equal(bounds.padding, 0);
  assert.equal(bounds.subWidth, 2);
  assert.deepStrictEqual(bounds.leftBounds, { x: 0, y: 0, width: 2, height: 2 });
  assert.deepStrictEqual(bounds.rightBounds, { x: 2, y: 0, width: 2, height: 2 });
});

// ============================================================================
// 3. readSterChunk Binary Scanner Tests
// ============================================================================

test('readSterChunk: extracts Mode 1 (diverging-fuse) as left-right', () => {
  const bytes = makePngSter({ mode: 1 });
  const result = readSterChunk(bytes);
  assert.ok(result);
  assert.equal(result.hasSter, true);
  assert.equal(result.mode, 1);
  assert.equal(result.type, 'left-right');
});

test('readSterChunk: extracts Mode 0 (cross-fuse) as right-left', () => {
  const bytes = makePngSter({ mode: 0 });
  const result = readSterChunk(bytes);
  assert.ok(result);
  assert.equal(result.hasSter, true);
  assert.equal(result.mode, 0);
  assert.equal(result.type, 'right-left');
});

test('readSterChunk: falls back to left-right for unrecognized mode byte (e.g. 255)', () => {
  const bytes = makePngSter({ mode: 255 });
  const result = readSterChunk(bytes);
  assert.ok(result);
  assert.equal(result.mode, 255);
  assert.equal(result.type, 'left-right');
});

test('readSterChunk: ignores sTER chunk placed after IDAT per PNG specification', () => {
  const bytes = makePngSter({ includeSter: true, sterAfterIdat: true });
  const result = readSterChunk(bytes);
  assert.equal(result, null, 'sTER chunk appearing after IDAT must be ignored');
});

test('readSterChunk: returns null when sTER chunk is omitted', () => {
  const bytes = makePngSter({ includeSter: false });
  const result = readSterChunk(bytes);
  assert.equal(result, null);
});

test('readSterChunk: throws Error when sTER chunk has corrupted CRC-32 checksum', () => {
  const bytes = makePngSter({ corruptCrc: true });
  assert.throws(
    () => readSterChunk(bytes),
    /CRC-32 checksum mismatch/i
  );
});

test('readSterChunk: throws Error on non-PNG byte stream (invalid signature)', () => {
  const nonPng = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
  assert.throws(
    () => readSterChunk(nonPng),
    /invalid signature/i
  );
});

test('readSterChunk: throws Error on truncated PNG header', () => {
  const truncated = new Uint8Array([0x89, 0x50, 0x4e]);
  assert.throws(
    () => readSterChunk(truncated),
    /truncated header/i
  );
});

// ============================================================================
// 4. parsePNS & parsePNGStereo End-to-End Processing Tests
// ============================================================================

test('parsePNS: parses Mode 1 image and returns valid StereoData', async () => {
  const bytes = makePngSter({ width: 32, height: 16, mode: 1 });
  const data = await parsePNS(toDataUrl(bytes), { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
  assert.equal(typeof data.phiLength, 'number');
  assert.equal(typeof data.thetaLength, 'number');
  assert.equal(typeof data.thetaStart, 'number');
});

test('parsePNS: parses Mode 0 image and returns valid StereoData with right-left layout', async () => {
  const bytes = makePngSter({ width: 32, height: 16, mode: 0 });
  const data = await parsePNS(toDataUrl(bytes), { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
  assert.equal(typeof data.phiLength, 'number');
  assert.equal(typeof data.thetaLength, 'number');
});

test('parsePNS: falls back to right-left when sTER chunk is absent (.pns extension fallback)', async () => {
  const bytes = makePngSter({ includeSter: false });
  const data = await parsePNS('https://example.com/gallery/landscape.pns', { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
});

test('parsePNS: respects explicit options.type override', async () => {
  const bytes = makePngSter({ mode: 1 }); // Embedded as left-right
  const data = await parsePNS(toDataUrl(bytes), { bytes, type: 'right-left' });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
});

test('parsePNS: passes through custom angle and projection options', async () => {
  const bytes = makePngSter({ mode: 1 });
  const data = await parsePNS(toDataUrl(bytes), { bytes, angle: 180, projection: 'fisheye' });
  assert.equal(data.projection, 'fisheye');
  assert.equal(data.phiLength, Math.PI);
  assert.equal(data.thetaLength, Math.PI);
});

test('parsePNS: handles Adam7 padding when padding > 0', async () => {
  // width 175 has padding = 1
  const bytes = makePngSter({ width: 175, height: 100, mode: 1 });
  const data = await parsePNS(toDataUrl(bytes), { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
  assert.equal(typeof data.phiLength, 'number');
});

test('parsePNS: rejects corrupted CRC-32 sTER chunk', async () => {
  const bytes = makePngSter({ corruptCrc: true });
  await assert.rejects(
    async () => parsePNS(toDataUrl(bytes), { bytes }),
    /CRC-32 checksum mismatch/i
  );
});

test('parsePNS: rejects non-PNG files cleanly', async () => {
  const nonPng = new Uint8Array([0x01, 0x02, 0x03]);
  await assert.rejects(
    async () => parsePNS(toDataUrl(nonPng), { bytes: nonPng }),
    /Not a valid PNG/i
  );
});

test('parsePNS: aborts when AbortSignal is cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  const bytes = makePngSter();
  await assert.rejects(
    async () => parsePNS(toDataUrl(bytes), { bytes, signal: controller.signal }),
    (err) => err.name === 'AbortError' || controller.signal.aborted
  );
});

test('parsePNGStereo alias exports identically to parsePNS', () => {
  assert.equal(parsePNGStereo, parsePNS);
});

// ============================================================================
// 5. Authentic Asset Integration Test
// ============================================================================

test('Authentic asset: reads sTER chunk from examples/stereograph.sTER.png', () => {
  const assetPath = path.resolve('examples/stereograph.sTER.png');
  assert.ok(fs.existsSync(assetPath), 'examples/stereograph.sTER.png must exist');

  const fileBytes = new Uint8Array(fs.readFileSync(assetPath));
  assert.ok(fileBytes.length > 100000);

  const ster = readSterChunk(fileBytes);
  assert.ok(ster, 'Must find sTER chunk in authentic stereograph.sTER.png');
  assert.equal(ster.hasSter, true);
  assert.equal(ster.mode, 1, 'Authentic stereograph should be Mode 1 (diverging-fuse)');
  assert.equal(ster.type, 'left-right');
});
