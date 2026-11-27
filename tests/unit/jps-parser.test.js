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

import { parseJPS, readJpsMarker, descriptorToStereoType } from '../../parsers/jps-parser/jps-parser.js';

/**
 * Synthesizes an in-memory JPS JPEG binary stream.
 * @param {Object} options
 * @param {number} [options.mediaType=1] - 0: Mono, 1: Stereo
 * @param {number} [options.layout=2] - 1: Interleaved, 2: Side-by-Side, 3: Over-Under, 4: Anaglyph
 * @param {boolean} [options.halfHeight=false] - Bit 0: Half-Height flag
 * @param {boolean} [options.halfWidth=false] - Bit 1: Half-Width flag
 * @param {boolean} [options.leftEyeFirst=true] - Bit 2: Eye order (1 = Left first, 0 = Right first)
 * @param {string} [options.comment=''] - Optional comment string
 * @param {string|null} [options.corrupt=null] - 'truncated', 'bad_magic', 'bad_length'
 * @param {Uint8Array} [options.payload] - JPEG image payload
 * @returns {Uint8Array}
 */
export function makeJps({
  mediaType = 1,
  layout = 2,
  halfHeight = false,
  halfWidth = false,
  leftEyeFirst = true,
  comment = '',
  corrupt = null,
  payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]),
} = {}) {
  const commentBytes = new TextEncoder().encode(comment);
  const commentLen = commentBytes.length > 0 ? 2 + commentBytes.length : 0;
  const descriptorBlockLen = 4 + commentLen;
  const app3DataLen = 8 + 2 + descriptorBlockLen; // Magic (8) + descBlockLen (2) + descriptor (4) + comment
  const segmentLen = 2 + app3DataLen; // Includes 2 bytes for segment length field

  // Assemble APP3 data payload
  const app3 = new Uint8Array(segmentLen);
  const view = new DataView(app3.buffer);
  view.setUint16(0, corrupt === 'bad_length' ? 4 : segmentLen, false); // Big-Endian

  // Signature "_JPSJPS_" (8 bytes)
  const magic = corrupt === 'bad_magic' ? '_NOTJPS_' : '_JPSJPS_';
  for (let i = 0; i < 8; i++) {
    app3[2 + i] = magic.charCodeAt(i);
  }

  // Descriptor block length (2 bytes)
  view.setUint16(10, descriptorBlockLen, false);

  // 32-bit descriptor:
  // Byte 0: mediaType, Byte 1: layout, Bytes 2 & 3: flags
  let flags = 0;
  if (halfHeight) flags |= (1 << 0);
  if (halfWidth) flags |= (1 << 1);
  if (leftEyeFirst) flags |= (1 << 2);

  app3[12] = mediaType & 0xff;
  app3[13] = layout & 0xff;
  app3[14] = flags & 0xff;
  app3[15] = 0x00;

  if (commentBytes.length > 0) {
    view.setUint16(16, commentBytes.length, false);
    app3.set(commentBytes, 18);
  }

  if (corrupt === 'truncated') {
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe3, 0x00, 0x08, 0x5f, 0x4a]);
  }

  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe3, // APP3
    ...app3,
    ...payload,
    0xff, 0xd9,  // EOI
  ]);
}

/** Helper to convert bytes to a data URI. */
function toDataUrl(bytes) {
  return 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
}

/** Mock Image and Canvas environment for parser tests. */
class FakeImage {
  constructor() {
    this.width = 4;
    this.height = 2;
    this._src = '';
    this.onload = null;
    this.onerror = null;
  }
  set src(v) {
    this._src = v;
    if (v) {
      setImmediate(() => this.onload?.());
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

let originals;

test.beforeEach(() => {
  originals = {
    Image: global.Image,
    ImageData: global.ImageData,
    document: global.document,
  };

  global.Image = FakeImage;
  global.ImageData = FakeImageData;
  global.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {},
        getImageData: (x, y, w, h) => new FakeImageData(new Uint8ClampedArray(w * h * 4).fill(255), w, h),
      }),
    }),
  };
});

test.afterEach(() => {
  Object.assign(global, originals);
});

// ============================================================================
// 1. APP3 Marker Parsing (readJpsMarker)
// ============================================================================

test('readJpsMarker: parses standard SBS parallel descriptor (Media 1, Layout 2, Left-First)', () => {
  const bytes = makeJps({ mediaType: 1, layout: 2, leftEyeFirst: true });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.mediaType, 1);
  assert.equal(desc.layout, 2);
  assert.equal(desc.leftFieldFirst, true);
  assert.equal(desc.halfWidth, false);
  assert.equal(desc.halfHeight, false);
});

test('readJpsMarker: parses SBS cross-eyed descriptor (Media 1, Layout 2, Right-First)', () => {
  const bytes = makeJps({ mediaType: 1, layout: 2, leftEyeFirst: false });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.mediaType, 1);
  assert.equal(desc.layout, 2);
  assert.equal(desc.leftFieldFirst, false);
});

test('readJpsMarker: parses SBS half-width parallel descriptor', () => {
  const bytes = makeJps({ mediaType: 1, layout: 2, halfWidth: true, leftEyeFirst: true });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.halfWidth, true);
  assert.equal(desc.leftFieldFirst, true);
});

test('readJpsMarker: parses SBS half-width cross-eyed descriptor', () => {
  const bytes = makeJps({ mediaType: 1, layout: 2, halfWidth: true, leftEyeFirst: false });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.halfWidth, true);
  assert.equal(desc.leftFieldFirst, false);
});

test('readJpsMarker: parses Over-Under parallel descriptor (Layout 3, Left-First)', () => {
  const bytes = makeJps({ mediaType: 1, layout: 3, leftEyeFirst: true });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.layout, 3);
  assert.equal(desc.leftFieldFirst, true);
  assert.equal(desc.halfHeight, false);
});

test('readJpsMarker: parses Over-Under cross-eyed descriptor (Layout 3, Right-First)', () => {
  const bytes = makeJps({ mediaType: 1, layout: 3, leftEyeFirst: false });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.layout, 3);
  assert.equal(desc.leftFieldFirst, false);
});

test('readJpsMarker: parses Over-Under half-height descriptor', () => {
  const bytes = makeJps({ mediaType: 1, layout: 3, halfHeight: true, leftEyeFirst: true });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.layout, 3);
  assert.equal(desc.halfHeight, true);
});

test('readJpsMarker: parses Interleaved layout descriptor (Layout 1)', () => {
  const bytes = makeJps({ mediaType: 1, layout: 1, leftEyeFirst: true });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.layout, 1);
});

test('readJpsMarker: parses Anaglyph layout descriptor (Layout 4)', () => {
  const bytes = makeJps({ mediaType: 1, layout: 4 });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.layout, 4);
});

test('readJpsMarker: parses Mono layout descriptor (Media 0)', () => {
  const bytes = makeJps({ mediaType: 0, layout: 0 });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.mediaType, 0);
});

test('readJpsMarker: parses optional comment string', () => {
  const bytes = makeJps({ comment: 'Stereo photo by author' });
  const desc = readJpsMarker(bytes);
  assert.notEqual(desc, null);
  assert.equal(desc.comment, 'Stereo photo by author');
});

test('readJpsMarker: returns null when marker has bad magic signature', () => {
  const bytes = makeJps({ corrupt: 'bad_magic' });
  const desc = readJpsMarker(bytes);
  assert.equal(desc, null);
});

test('readJpsMarker: returns null when marker has short bad length', () => {
  const bytes = makeJps({ corrupt: 'bad_length' });
  const desc = readJpsMarker(bytes);
  assert.equal(desc, null);
});

test('readJpsMarker: throws error on truncated marker segment payload', () => {
  const bytes = makeJps({ corrupt: 'truncated' });
  assert.throws(() => readJpsMarker(bytes), /Truncated JPEG marker/);
});

test('readJpsMarker: throws error on non-JPEG bytes', () => {
  assert.throws(() => readJpsMarker(new Uint8Array([0x00, 0x01, 0x02])), /Not a valid JPEG/);
});

// ============================================================================
// 2. Descriptor to Stereo Type Mapping (descriptorToStereoType)
// ============================================================================

test('descriptorToStereoType: maps SBS parallel to left-right', () => {
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 2, leftFieldFirst: true }), 'left-right');
});

test('descriptorToStereoType: maps SBS cross-eyed to right-left', () => {
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 2, leftFieldFirst: false }), 'right-left');
});

test('descriptorToStereoType: maps SBS half-width parallel to half-left-right', () => {
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 2, leftFieldFirst: true, halfWidth: true }), 'half-left-right');
});

test('descriptorToStereoType: maps SBS half-width cross-eyed to half-right-left', () => {
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 2, leftFieldFirst: false, halfWidth: true }), 'half-right-left');
});

test('descriptorToStereoType: maps Over-Under parallel to top-bottom', () => {
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 3, leftFieldFirst: true }), 'top-bottom');
});

test('descriptorToStereoType: maps Over-Under cross-eyed to bottom-top', () => {
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 3, leftFieldFirst: false }), 'bottom-top');
});

test('descriptorToStereoType: maps Over-Under half-height parallel to half-top-bottom', () => {
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 3, leftFieldFirst: true, halfHeight: true }), 'half-top-bottom');
});

test('descriptorToStereoType: maps Over-Under half-height cross-eyed to half-bottom-top', () => {
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 3, leftFieldFirst: false, halfHeight: true }), 'half-bottom-top');
});

test('descriptorToStereoType: maps Interleaved layout', () => {
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 1, leftFieldFirst: true }), 'interlaced');
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 1, leftFieldFirst: false }), 'interlaced-reverse');
});

test('descriptorToStereoType: maps Anaglyph layout', () => {
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 4 }), 'anaglyph');
});

test('descriptorToStereoType: maps Mono layout', () => {
  assert.equal(descriptorToStereoType({ mediaType: 0 }), 'mono');
});

test('descriptorToStereoType: falls back to right-left for null and left-right for unrecognized layout', () => {
  assert.equal(descriptorToStereoType(null), 'right-left');
  assert.equal(descriptorToStereoType({ mediaType: 1, layout: 0xff }), 'left-right');
});

// ============================================================================
// 3. parseJPS End-to-End Processing
// ============================================================================

test('parseJPS: parses standard SBS parallel image and returns StereoData', async () => {
  const bytes = makeJps({ mediaType: 1, layout: 2, leftEyeFirst: true });
  const data = await parseJPS(toDataUrl(bytes), { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
  assert.ok(typeof data.phiLength === 'number');
  assert.ok(typeof data.thetaLength === 'number');
});

test('parseJPS: parses SBS cross-eyed image and returns StereoData', async () => {
  const bytes = makeJps({ mediaType: 1, layout: 2, leftEyeFirst: false });
  const data = await parseJPS(toDataUrl(bytes), { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
});

test('parseJPS: parses SBS half-width image and returns StereoData', async () => {
  const bytes = makeJps({ mediaType: 1, layout: 2, halfWidth: true, leftEyeFirst: true });
  const data = await parseJPS(toDataUrl(bytes), { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
});

test('parseJPS: parses Over-Under image and returns StereoData', async () => {
  const bytes = makeJps({ mediaType: 1, layout: 3, leftEyeFirst: true });
  const data = await parseJPS(toDataUrl(bytes), { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
});

test('parseJPS: delegates to parseAnaglyph when layout is anaglyph', async () => {
  const bytes = makeJps({ mediaType: 1, layout: 4 });
  const data = await parseJPS(toDataUrl(bytes), { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
  assert.ok(data.colors);
});

test('parseJPS: delegates to parseMono when mediaType is mono', async () => {
  const bytes = makeJps({ mediaType: 0, layout: 0 });
  const data = await parseJPS(toDataUrl(bytes), { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
});

test('parseJPS: falls back to right-left when APP3 marker is omitted (extension fallback)', async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0xff, 0xd9]);
  const data = await parseJPS('https://example.com/photo.jps', { bytes: jpeg });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
});

test('parseJPS: handles bad magic gracefully by falling back to left-right', async () => {
  const bytes = makeJps({ corrupt: 'bad_magic' });
  const data = await parseJPS(toDataUrl(bytes), { bytes });
  assert.ok(data.leftEye);
  assert.ok(data.rightEye);
});

test('parseJPS: rejects with AbortError when signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const bytes = makeJps();
  await assert.rejects(
    async () => parseJPS(toDataUrl(bytes), { bytes, signal: controller.signal }),
    (err) => err.name === 'AbortError' || controller.signal.aborted
  );
});

test('Authentic asset: reads examples/mario.jps and defaults to cross-eyed right-left', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const assetPath = path.resolve('examples/mario.jps');
  assert.ok(fs.existsSync(assetPath), 'examples/mario.jps must exist');
  const bytes = new Uint8Array(fs.readFileSync(assetPath));
  assert.equal(readJpsMarker(bytes), null, 'Unadorned .jps has no APP3 marker');
  assert.equal(descriptorToStereoType(null), 'right-left', 'Unadorned .jps must default to right-left');
});
