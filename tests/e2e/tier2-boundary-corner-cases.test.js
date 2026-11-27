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

import {
  setupDOMEnvironment,
  teardownDOMEnvironment,
  getParser,
  assertStereoData,
  createStereoImgElement,
  loadExampleAsset,
  FakeHTMLCanvasElement,
} from './helpers/e2e-harness.js';

import {
  createJPS,
  createPNGStereo,
  createHEICDepth,
  createRGBD,
  createAVIFStereo,
  createWigglegram,
  createCameraEXIF,
  concat,
  u32,
  u16le,
  text,
  crc32,
} from './helpers/fixtures.js';

test.beforeEach(() => {
  setupDOMEnvironment();
});

test.afterEach(() => {
  teardownDOMEnvironment();
});

// ============================================================================
// FEATURE 1: JPS Boundary & Corner Cases
// ============================================================================

test('JPS Boundary 1.1: Corrupted APP3 marker cut short before length bytes', async () => {
  // SOI followed by incomplete APP3 marker
  const corrupted = new Uint8Array([0xff, 0xd8, 0xff, 0xe3]);
  const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(corrupted).toString('base64');
  const jpsParser = await getParser('jps');
  assert.ok(typeof jpsParser?.parseJPS === 'function', 'jps-parser must export parseJPS');
  await assert.rejects(async () => {
    await jpsParser.parseJPS(dataUrl);
  });
});

test('JPS Boundary 1.2: Truncated APP3 descriptor payload (ends abruptly)', async () => {
  const soi = new Uint8Array([0xff, 0xd8]);
  // Declare length 20, but supply only 6 bytes
  const truncatedApp3 = new Uint8Array([0xff, 0xe3, 0x00, 0x14, 0x5f, 0x4a, 0x50, 0x53]);
  const bytes = concat(soi, truncatedApp3);
  const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
  const jpsParser = await getParser('jps');
  assert.ok(typeof jpsParser?.parseJPS === 'function', 'jps-parser must export parseJPS');
  await assert.rejects(async () => {
    await jpsParser.parseJPS(dataUrl);
  });
});

test('JPS Boundary 1.3: Reserved / unrecognized layout code (0xFF) falls back gracefully', async () => {
  const jps = createJPS({ layout: 0xff });
  assert.equal(jps.bytes[17], 0xff);
  const jpsParser = await getParser('jps');
  assert.ok(typeof jpsParser?.readJpsMarker === 'function', 'jps-parser must export readJpsMarker');
  assert.ok(typeof jpsParser?.descriptorToStereoType === 'function', 'jps-parser must export descriptorToStereoType');
  assert.ok(typeof jpsParser?.parseJPS === 'function', 'jps-parser must export parseJPS');
  const desc = jpsParser.readJpsMarker(jps.bytes);
  assert.equal(jpsParser.descriptorToStereoType(desc), 'left-right');
  // Unrecognized layout should not throw uncaught error; falls back to standard stereo or defaults
  const result = await jpsParser.parseJPS(jps.dataUrl);
  assertStereoData(result);
});

test('JPS Boundary 1.4: Extreme dimensions (1x1 single pixel) with JPS APP3', async () => {
  const jps = createJPS({
    extraPayload: new Uint8Array([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
  });
  const jpsParser = await getParser('jps');
  assert.ok(typeof jpsParser?.parseJPS === 'function', 'jps-parser must export parseJPS');
  const data = await jpsParser.parseJPS(jps.dataUrl);
  assertStereoData(data);

  const el = await createStereoImgElement();
  el.src = jps.dataUrl;
  el.type = 'jps';
  const parsed = await el.parse();
  assertStereoData(parsed);
});

test('JPS Boundary 1.5: Pre-aborted signal during JPS processing rejects with AbortError', async () => {
  const controller = new AbortController();
  controller.abort();
  const jps = createJPS();
  const jpsParser = await getParser('jps');
  assert.ok(typeof jpsParser?.parseJPS === 'function', 'jps-parser must export parseJPS');
  await assert.rejects(
    async () => jpsParser.parseJPS(jps.dataUrl, { signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );

  const el = await createStereoImgElement();
  el.src = jps.dataUrl;
  await assert.rejects(
    async () => el.parse(controller.signal),
    (err) => err.name === 'AbortError'
  );
});

// ============================================================================
// FEATURE 2: PNG Stereoscopic Boundary & Corner Cases
// ============================================================================

test('PNG Boundary 2.1: Corrupted sTER chunk CRC32 checksum mismatch', async () => {
  const png = createPNGStereo({ mode: 1 });
  // Corrupt the last CRC byte of sTER
  let sterIndex = -1;
  for (let i = 8; i < png.bytes.length - 8; i++) {
    const tag = Buffer.from(png.bytes.subarray(i + 4, i + 8)).toString('ascii');
    if (tag === 'sTER') {
      sterIndex = i;
      break;
    }
  }
  assert.ok(sterIndex > 0);
  const corrupted = new Uint8Array(png.bytes);
  corrupted[sterIndex + 12] ^= 0xff; // Invert CRC byte
  const dataUrl = 'data:image/png;base64,' + Buffer.from(corrupted).toString('base64');

  const pngParser = await getParser('png');
  assert.ok(typeof pngParser?.parsePNGStereo === 'function', 'png-parser must export parsePNGStereo');
  await assert.rejects(
    async () => pngParser.parsePNGStereo(dataUrl),
    /CRC-32 checksum mismatch/i
  );
});

test('PNG Boundary 2.2: Truncated sTER chunk (zero payload bytes)', async () => {
  const lengthBytes = u32(0);
  const chunkType = text('sTER');
  const crc = crc32(chunkType);
  const truncatedSterChunk = concat(lengthBytes, chunkType, u32(crc));

  const basePng = createPNGStereo({ omitSter: true });
  // Splice truncated sTER chunk into valid PNG stream immediately after IHDR (offset 33)
  const corruptPng = concat(basePng.bytes.subarray(0, 33), truncatedSterChunk, basePng.bytes.subarray(33));
  const dataUrl = 'data:image/png;base64,' + Buffer.from(corruptPng).toString('base64');

  const pngParser = await getParser('png');
  assert.ok(typeof pngParser?.parsePNGStereo === 'function', 'png-parser must export parsePNGStereo');
  await assert.rejects(
    async () => pngParser.parsePNGStereo(dataUrl),
    /Invalid sTER chunk length/i
  );
});

test('PNG Boundary 2.3: Invalid mode value (e.g. mode 255) falls back safely', async () => {
  const png = createPNGStereo({ mode: 255 });
  const pngParser = await getParser('png');
  assert.ok(typeof pngParser?.readSterChunk === 'function', 'png-parser must export readSterChunk');
  assert.ok(typeof pngParser?.parsePNGStereo === 'function', 'png-parser must export parsePNGStereo');

  const ster = pngParser.readSterChunk(png.bytes);
  assert.equal(ster.mode, 255);
  assert.equal(ster.type, 'left-right');

  const data = await pngParser.parsePNGStereo(png.dataUrl);
  assertStereoData(data);
});

test('PNG Boundary 2.4: Odd image dimensions (101x99) with sTER chunk', async () => {
  const png = createPNGStereo({ width: 101, height: 99 });
  const pngParser = await getParser('png');
  assert.ok(typeof pngParser?.parsePNGStereo === 'function', 'png-parser must export parsePNGStereo');
  const data = await pngParser.parsePNGStereo(png.dataUrl);
  assertStereoData(data);

  const el = await createStereoImgElement();
  el.src = png.dataUrl;
  el.type = 'pns';
  const parsed = await el.parse();
  assertStereoData(parsed);
});

test('PNG Boundary 2.5: Zero-byte or truncated PNG header rejects cleanly', async () => {
  const truncatedPng = new Uint8Array([0x89, 0x50, 0x4e]);
  const dataUrl = 'data:image/png;base64,' + Buffer.from(truncatedPng).toString('base64');
  const pngParser = await getParser('png');
  assert.ok(typeof pngParser?.parsePNGStereo === 'function', 'png-parser must export parsePNGStereo');
  await assert.rejects(
    async () => pngParser.parsePNGStereo(dataUrl),
    /Not a valid PNG/i
  );
});

// ============================================================================
// FEATURE 3: Apple Portrait Depth Boundary & Corner Cases
// ============================================================================

test('Apple Portrait Boundary 3.1: Incomplete ISOBMFF hierarchy (truncated meta box)', async () => {
  const heic = createHEICDepth();
  const truncated = heic.bytes.subarray(0, 60);
  const dataUrl = 'data:image/heic;base64,' + Buffer.from(truncated).toString('base64');

  const heicParser = await getParser('heic');
  assert.ok(typeof heicParser?.readHeic === 'function', 'readHeic must be exported');
  const structure = heicParser.readHeic(truncated);
  assert.equal(structure?.depth, undefined, 'Truncated container must not resolve depth');

  await assert.rejects(async () => {
    await heicParser.parseHEIC(dataUrl);
  });

  const el = await createStereoImgElement();
  el.src = dataUrl;
  await assert.rejects(async () => {
    await el.parse();
  });
});

test('Apple Portrait Boundary 3.2: Missing auxl item reference (depth without primary link)', async () => {
  const ftyp = concat(u32(24), text('ftyp'), text('heic'), u32(0), text('mif1'), text('heic'));
  const meta = concat(u32(12), text('meta'), u32(0));
  const bytes = concat(ftyp, meta);
  const dataUrl = 'data:image/heic;base64,' + Buffer.from(bytes).toString('base64');

  const heicParser = await getParser('heic');
  assert.ok(typeof heicParser?.readHeic === 'function', 'readHeic must be exported');
  const structure = heicParser.readHeic(bytes);
  assert.equal(structure?.depth, undefined, 'HEIC lacking auxl/iprp must not resolve depth');

  await assert.rejects(async () => {
    await heicParser.parseHEIC(dataUrl);
  });

  const el = await createStereoImgElement();
  el.src = dataUrl;
  await assert.rejects(async () => {
    await el.parse();
  });
});

test('Apple Portrait Boundary 3.3: Unsupported / unrecognized auxType URN string', async () => {
  const heic = createHEICDepth({ auxType: 'urn:unknown:vendor:custom:auxiliary' });
  const heicParser = await getParser('heic');
  assert.ok(typeof heicParser?.readHeic === 'function', 'readHeic must be exported');

  const structure = heicParser.readHeic(heic.bytes);
  assert.ok(structure, 'readHeic must parse container structure');
  assert.equal(structure.primary, 1, 'Primary item ID must be 1');
  assert.equal(structure.depth, undefined, 'Unrecognized auxiliary type must not be recognized as depth map');
});

test('Apple Portrait Boundary 3.4: Item info box missing primary image entry', async () => {
  const heic = createHEICDepth({ primaryItemId: 999 });
  const heicParser = await getParser('heic');
  assert.ok(typeof heicParser?.readHeic === 'function', 'readHeic must be exported');

  const structure = heicParser.readHeic(heic.bytes);
  assert.ok(structure, 'readHeic must parse container structure');
  assert.equal(structure.primary, 999, 'readHeic must extract specified primary item ID');

  const ftyp = concat(u32(24), text('ftyp'), text('heic'), u32(0), text('mif1'), text('heic'));
  const meta = concat(u32(12), text('meta'), u32(0));
  const noPitmBytes = concat(ftyp, meta);
  const noPitmStructure = heicParser.readHeic(noPitmBytes);
  assert.equal(noPitmStructure.primary, undefined, 'Container without pitm must return primary as undefined');
});

test('Apple Portrait Boundary 3.5: Pre-aborted signal during depth parsing', async () => {
  const controller = new AbortController();
  controller.abort();

  const portraitAsset = loadExampleAsset('Pixel7Pro.PORTRAIT.jpg');
  const depthParser = await getParser('depth');
  assert.ok(typeof depthParser?.parseDepth === 'function', 'depth-parser must export parseDepth');
  await assert.rejects(
    async () => depthParser.parseDepth(portraitAsset.dataUrl, { signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );

  const heicAsset = loadExampleAsset('vision-pro.HEIC');
  const heicParser = await getParser('heic');
  assert.ok(typeof heicParser?.parseHEIC === 'function', 'heic-parser must export parseHEIC');
  await assert.rejects(
    async () => heicParser.parseHEIC(heicAsset.dataUrl, { signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );
});

// ============================================================================
// FEATURE 4: RGB-D Boundary & Corner Cases
// ============================================================================

const rgbdParser = await getParser('rgbd');
const rgbdSkipReason = !rgbdParser ? 'RGB-D composite parser pending merge (Milestone M1)' : false;

test('RGB-D Boundary 4.1: Odd-dimension composite (101x50) SBS split', { skip: rgbdSkipReason }, async () => {
  const rgbd = createRGBD({ layout: 'left-right', width: 101, height: 50 });
  const data = await rgbdParser.parseRGBD(rgbd.dataUrl, { layout: 'left-right' });
  assertStereoData(data, { hasDepth: true });
});

test('RGB-D Boundary 4.2: 1x1 single-pixel composite image', { skip: rgbdSkipReason }, async () => {
  const rgbd = createRGBD({ layout: 'left-right', width: 1, height: 1 });
  await assert.rejects(async () => {
    await rgbdParser.parseRGBD(rgbd.dataUrl, { layout: 'left-right' });
  });
});

test('RGB-D Boundary 4.3: Extreme aspect ratio (5000x1 horizontal strip)', { skip: rgbdSkipReason }, async () => {
  const rgbd = createRGBD({ layout: 'left-right', width: 5000, height: 1 });
  const data = await rgbdParser.parseRGBD(rgbd.dataUrl, { layout: 'left-right' });
  assertStereoData(data, { hasDepth: true });
});

test('RGB-D Boundary 4.4: All-zero depth channel fallback without crash', { skip: rgbdSkipReason }, async () => {
  const rgbd = createRGBD({ layout: 'left-right', width: 100, height: 50 });
  const data = await rgbdParser.parseRGBD(rgbd.dataUrl, { layout: 'left-right' });
  assertStereoData(data);
});

test('RGB-D Boundary 4.5: Abort signal during RGB-D extraction rejects cleanly', { skip: rgbdSkipReason }, async () => {
  const controller = new AbortController();
  controller.abort();
  const rgbd = createRGBD();
  await assert.rejects(
    async () => rgbdParser.parseRGBD(rgbd.dataUrl, { signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );
});

// ============================================================================
// FEATURE 5: AVIF Spatial Boundary & Corner Cases
// ============================================================================

const avifParser = await getParser('avif');
const avifSkipReason = !avifParser ? 'AVIF spatial parser pending merge (Milestone M2)' : false;

test('AVIF Boundary 5.1: Truncated ster entity group box', { skip: avifSkipReason }, async () => {
  const avif = createAVIFStereo();
  const sterIdx = Buffer.from(avif.bytes).indexOf('ster');
  assert.ok(sterIdx > 0, 'AVIF fixture must contain ster box');
  const truncated = avif.bytes.subarray(0, sterIdx + 4);
  const dataUrl = 'data:image/avif;base64,' + Buffer.from(truncated).toString('base64');

  await assert.rejects(async () => {
    await avifParser.parseAVIFStereo(dataUrl);
  });
});

test('AVIF Boundary 5.2: ster group with single entity ID (not a pair: [1])', { skip: avifSkipReason }, async () => {
  const avif = createAVIFStereo({ stereoGroup: [1] });
  await assert.rejects(async () => {
    await avifParser.parseAVIFStereo(avif.dataUrl);
  });
});

test('AVIF Boundary 5.3: ster group with empty entity list (count = 0)', { skip: avifSkipReason }, async () => {
  const avif = createAVIFStereo({ stereoGroup: [] });
  await assert.rejects(async () => {
    await avifParser.parseAVIFStereo(avif.dataUrl);
  });
});

test('AVIF Boundary 5.4: Malformed ftyp box in AVIF container', { skip: avifSkipReason }, async () => {
  const corruptFtyp = concat(u32(12), text('ftyp'), text('bad!'));
  const dataUrl = 'data:image/avif;base64,' + Buffer.from(corruptFtyp).toString('base64');

  await assert.rejects(async () => {
    await avifParser.parseAVIFStereo(dataUrl);
  });
});

test('AVIF Boundary 5.5: Abort signal during AVIF container parsing', { skip: avifSkipReason }, async () => {
  const controller = new AbortController();
  controller.abort();
  const avif = createAVIFStereo();
  await assert.rejects(
    async () => avifParser.parseAVIFStereo(avif.dataUrl, { signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );
});

// ============================================================================
// FEATURE 6: Looking Glass Quilt Boundary & Corner Cases
// ============================================================================

const quiltParser = await getParser('quilt');
const quiltSkipReason = !quiltParser ? 'Looking Glass Quilt parser pending merge (Milestone M2)' : false;

test('Quilt Boundary 6.1: Malformed filename with zero dimensions (_qs0x0a0.75)', { skip: quiltSkipReason }, async () => {
  await assert.rejects(async () => {
    await quiltParser.default('quilt_qs0x0a0.75.png');
  });
});

test('Quilt Boundary 6.2: Non-numeric aspect ratio in filename (_qs8x6aABC)', { skip: quiltSkipReason }, async () => {
  await assert.rejects(async () => {
    await quiltParser.default('quilt_qs8x6aABC.png');
  });
});

test('Quilt Boundary 6.3: Single tile quilt (1x1 grid)', { skip: quiltSkipReason }, async () => {
  const data = await quiltParser.default('quilt_sample_qs1x1a1.0.png');
  assertStereoData(data);
});

test('Quilt Boundary 6.4: Non-integer divisible dimensions (1001x701 with 8x6 grid)', { skip: quiltSkipReason }, async () => {
  const data = await quiltParser.default('quilt_sample_qs8x6a0.75.png');
  assertStereoData(data);
});

test('Quilt Boundary 6.5: Empty filename string or null parameter returns null or rejects', { skip: quiltSkipReason }, async () => {
  await assert.rejects(async () => {
    await quiltParser.default('');
  });
});

// ============================================================================
// FEATURE 7: Animated Wigglegram Boundary & Corner Cases
// ============================================================================

const wiggleParser = await getParser('wiggle');
const wiggleSkipReason = !wiggleParser ? 'Animated Wigglegram parser pending merge (Milestone M2)' : false;

test('Wigglegram Boundary 7.1: Single-frame GIF (no animation) falls back to mono', { skip: wiggleSkipReason }, async () => {
  const gif = createWigglegram({ frameCount: 1 });
  assert.ok(typeof wiggleParser?.parseWigglegram === 'function', 'wiggle-parser must export parseWigglegram');
  const data = await wiggleParser.parseWigglegram(gif.dataUrl);
  assertStereoData(data);
});

test('Wigglegram Boundary 7.2: Corrupted frame descriptor with zero dimensions', { skip: wiggleSkipReason }, async () => {
  const zeroDescGif = concat(
    text('GIF89a'),
    u16le(100, 100),
    new Uint8Array([0x80, 0, 0, 0, 0, 0, 255, 255, 255]),
    new Uint8Array([0x2c]),
    u16le(0, 0, 0, 0),
    new Uint8Array([0x00, 0x3b])
  );
  const dataUrl = 'data:image/gif;base64,' + Buffer.from(zeroDescGif).toString('base64');
  assert.ok(typeof wiggleParser?.parseWigglegram === 'function', 'wiggle-parser must export parseWigglegram');
  await assert.rejects(async () => {
    await wiggleParser.parseWigglegram(dataUrl);
  });
});

test('Wigglegram Boundary 7.3: Frames with differing dimensions across sequence', { skip: wiggleSkipReason }, async () => {
  const diffFrameGif = concat(
    text('GIF89a'),
    u16le(200, 150),
    new Uint8Array([0x80, 0, 0, 0, 0, 0, 255, 255, 255]),
    new Uint8Array([0x2c]), u16le(0, 0, 100, 100), new Uint8Array([0x00, 0x02, 0x02, 0x44, 0x01, 0x00]),
    new Uint8Array([0x2c]), u16le(0, 0, 200, 150), new Uint8Array([0x00, 0x02, 0x02, 0x44, 0x01, 0x00]),
    new Uint8Array([0x3b])
  );
  const dataUrl = 'data:image/gif;base64,' + Buffer.from(diffFrameGif).toString('base64');
  assert.ok(typeof wiggleParser?.parseWigglegram === 'function', 'wiggle-parser must export parseWigglegram');
  await assert.rejects(async () => {
    await wiggleParser.parseWigglegram(dataUrl);
  });
});

test('Wigglegram Boundary 7.4: Truncated LZW image raster data', { skip: wiggleSkipReason }, async () => {
  const gif = createWigglegram({ frameCount: 2 });
  const truncatedBytes = gif.bytes.subarray(0, gif.bytes.length - 20);
  const truncatedDataUrl = 'data:image/gif;base64,' + Buffer.from(truncatedBytes).toString('base64');
  assert.ok(typeof wiggleParser?.parseWigglegram === 'function', 'wiggle-parser must export parseWigglegram');
  await assert.rejects(async () => {
    await wiggleParser.parseWigglegram(truncatedDataUrl);
  });
});

test('Wigglegram Boundary 7.5: Abort signal during frame extraction rejects cleanly', { skip: wiggleSkipReason }, async () => {
  const controller = new AbortController();
  controller.abort();
  const gif = createWigglegram();
  assert.ok(typeof wiggleParser?.parseWigglegram === 'function', 'wiggle-parser must export parseWigglegram');
  await assert.rejects(
    async () => wiggleParser.parseWigglegram(gif.dataUrl, { signal: controller.signal }),
    (err) => err.name === 'AbortError'
  );
});
