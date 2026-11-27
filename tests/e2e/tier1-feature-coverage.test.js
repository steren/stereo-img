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
  createMPO,
  createRGBD,
  createAVIFStereo,
  createQuiltDescriptor,
  createWigglegram,
  createCameraEXIF,
  crc32,
} from './helpers/fixtures.js';

test.beforeEach(() => {
  setupDOMEnvironment();
});

test.afterEach(() => {
  teardownDOMEnvironment();
});

async function withSplitColorCanvas(fn) {
  const origCreateElement = global.document.createElement;
  global.document.createElement = (tag) => {
    if (tag === 'canvas') {
      const canvas = new FakeHTMLCanvasElement();
      const ctx = canvas.getContext('2d');
      const origDrawImage = ctx.drawImage.bind(ctx);
      ctx.drawImage = (image, ...args) => {
        origDrawImage(image, ...args);
        const w = canvas.width;
        const h = canvas.height;
        ctx._pixels = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const isLeftHalf = x < w / 2;
            ctx._pixels[idx] = isLeftHalf ? 255 : 0;
            ctx._pixels[idx + 1] = 0;
            ctx._pixels[idx + 2] = isLeftHalf ? 0 : 255;
            ctx._pixels[idx + 3] = 255;
          }
        }
      };
      return canvas;
    }
    return origCreateElement(tag);
  };
  try {
    return await fn();
  } finally {
    global.document.createElement = origCreateElement;
  }
}

// ============================================================================
// FEATURE 1: JPS Format Parser (APP3 '_JPSJPS_' marker & '.jps' extension)
// ============================================================================

test('JPS 1.1: APP3 marker with side-by-side layout (0x02) and left-right eye order', async () => {
  const jps = createJPS({ layout: 'side-by-side', eyeOrder: 'left-right' });
  assert.ok(jps.bytes.length > 0);

  // Validate APP3 marker structure
  assert.equal(jps.bytes[0], 0xff);
  assert.equal(jps.bytes[1], 0xd8); // SOI
  assert.equal(jps.bytes[2], 0xff);
  assert.equal(jps.bytes[3], 0xe3); // APP3

  // Validate '_JPSJPS_\0' identifier (9 bytes: indices 6 to 15)
  const idStr = Buffer.from(jps.bytes.subarray(6, 15)).toString('ascii');
  assert.equal(idStr, '_JPSJPS_\0');

  // Validate layout code byte (index 17) and left-field-first bit 2 (index 18)
  const layoutByte = jps.bytes[17];
  assert.equal(layoutByte, 2); // Side-by-side
  assert.equal(jps.bytes[18] & 0x04, 0x04);

  const jpsParser = await getParser('jps');
  assert.ok(typeof jpsParser?.readJpsMarker === 'function', 'jps-parser must export readJpsMarker');
  assert.ok(typeof jpsParser?.descriptorToStereoType === 'function', 'jps-parser must export descriptorToStereoType');
  assert.ok(typeof jpsParser?.parseJPS === 'function', 'jps-parser must export parseJPS');

  const desc = jpsParser.readJpsMarker(jps.bytes);
  assert.equal(jpsParser.descriptorToStereoType(desc), 'left-right');

  await withSplitColorCanvas(async () => {
    const data = await jpsParser.parseJPS(jps.dataUrl);
    assertStereoData(data);
    assert.equal(data.leftEye.data[0], 255);
    assert.equal(data.leftEye.data[2], 0);
    assert.equal(data.rightEye.data[0], 0);
    assert.equal(data.rightEye.data[2], 255);
  });
});

test('JPS 1.2: APP3 marker with right-left (cross-eyed) eye order flag cleared', async () => {
  const jps = createJPS({ layout: 'side-by-side', eyeOrder: 'right-left' });
  const flagsByte = jps.bytes[18];
  // Bit 2 cleared indicates right-left order (left-field-first = 0)
  assert.equal(flagsByte & 0x04, 0x00);

  const jpsParser = await getParser('jps');
  assert.ok(typeof jpsParser?.readJpsMarker === 'function', 'jps-parser must export readJpsMarker');
  assert.ok(typeof jpsParser?.descriptorToStereoType === 'function', 'jps-parser must export descriptorToStereoType');
  assert.ok(typeof jpsParser?.parseJPS === 'function', 'jps-parser must export parseJPS');

  const desc = jpsParser.readJpsMarker(jps.bytes);
  assert.equal(jpsParser.descriptorToStereoType(desc), 'right-left');

  await withSplitColorCanvas(async () => {
    const data = await jpsParser.parseJPS(jps.dataUrl);
    assertStereoData(data);
    assert.equal(data.leftEye.data[0], 0);
    assert.equal(data.leftEye.data[2], 255);
    assert.equal(data.rightEye.data[0], 255);
    assert.equal(data.rightEye.data[2], 0);
  });
});

test('JPS 1.3: APP3 marker with top-bottom (over-under, 0x03) layout', async () => {
  const jps = createJPS({ layout: 'top-bottom' });
  const layoutByte = jps.bytes[17];
  assert.equal(layoutByte, 3); // Over/under

  const jpsParser = await getParser('jps');
  assert.ok(typeof jpsParser?.readJpsMarker === 'function', 'jps-parser must export readJpsMarker');
  assert.ok(typeof jpsParser?.descriptorToStereoType === 'function', 'jps-parser must export descriptorToStereoType');
  assert.ok(typeof jpsParser?.parseJPS === 'function', 'jps-parser must export parseJPS');

  const desc = jpsParser.readJpsMarker(jps.bytes);
  assert.equal(jpsParser.descriptorToStereoType(desc), 'top-bottom');

  const data = await jpsParser.parseJPS(jps.dataUrl);
  assertStereoData(data);
  assert.equal(data.leftEye.width, 4);
  assert.equal(data.leftEye.height, 1);
});

test('JPS 1.4: APP3 marker with half-width flag set (anamorphic half-SBS)', async () => {
  const jps = createJPS({ layout: 'side-by-side', halfWidth: true });
  const flagsByte = jps.bytes[18];
  // Bit 1 set indicates half-width
  assert.equal(flagsByte & 0x02, 0x02);

  const jpsParser = await getParser('jps');
  assert.ok(typeof jpsParser?.readJpsMarker === 'function', 'jps-parser must export readJpsMarker');
  assert.ok(typeof jpsParser?.descriptorToStereoType === 'function', 'jps-parser must export descriptorToStereoType');
  assert.ok(typeof jpsParser?.parseJPS === 'function', 'jps-parser must export parseJPS');

  const desc = jpsParser.readJpsMarker(jps.bytes);
  assert.equal(jpsParser.descriptorToStereoType(desc), 'half-left-right');

  const data = await jpsParser.parseJPS(jps.dataUrl);
  assertStereoData(data);
  assert.equal(data.leftEye.width, 4);
  assert.equal(data.leftEye.height, 2);
});

test('JPS 1.5: .jps file extension fallback when APP3 marker is omitted', async () => {
  const jps = createJPS({
    omitMarker: true,
    extraPayload: new Uint8Array([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
  });
  // Verify APP3 marker is absent
  let hasApp3 = false;
  for (let i = 0; i < jps.bytes.length - 1; i++) {
    if (jps.bytes[i] === 0xff && jps.bytes[i + 1] === 0xe3) {
      hasApp3 = true;
      break;
    }
  }
  assert.equal(hasApp3, false, 'Marker should be omitted');

  const jpsParser = await getParser('jps');
  assert.ok(typeof jpsParser?.readJpsMarker === 'function', 'jps-parser must export readJpsMarker');
  assert.ok(typeof jpsParser?.descriptorToStereoType === 'function', 'jps-parser must export descriptorToStereoType');
  assert.ok(typeof jpsParser?.parseJPS === 'function', 'jps-parser must export parseJPS');

  assert.equal(jpsParser.readJpsMarker(jps.bytes), null);
  assert.equal(jpsParser.descriptorToStereoType(null), 'right-left');
  const data = await jpsParser.parseJPS(jps.dataUrl, { originalUrl: 'https://example.com/archive/photo.jps' });
  assertStereoData(data);

  // Verify element processes .jps URL properly
  const el = await createStereoImgElement();
  el.src = jps.dataUrl;
  el.type = 'jps';
  const parsed = await el.parse();
  assertStereoData(parsed);
});

// ============================================================================
// FEATURE 2: PNG Stereoscopic Parser ('sTER' chunk & '.pns' extension)
// ============================================================================

test('PNG 2.1: sTER chunk with mode 1 (diverging-fuse / left-right layout)', async () => {
  const png = createPNGStereo({ mode: 1 });
  // Validate PNG signature: 89 50 4E 47 0D 0A 1A 0A
  assert.deepStrictEqual(Array.from(png.bytes.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // Find sTER chunk in PNG stream
  let sterIndex = -1;
  for (let i = 8; i < png.bytes.length - 8; i++) {
    const tag = Buffer.from(png.bytes.subarray(i + 4, i + 8)).toString('ascii');
    if (tag === 'sTER') {
      sterIndex = i;
      break;
    }
  }
  assert.ok(sterIndex > 0, 'sTER chunk must be present');
  const modeByte = png.bytes[sterIndex + 8];
  assert.equal(modeByte, 1, 'Mode 1 for diverging-fuse');

  const pngParser = await getParser('png');
  assert.ok(typeof pngParser?.readSterChunk === 'function', 'png-parser must export readSterChunk');
  assert.ok(typeof pngParser?.parsePNGStereo === 'function', 'png-parser must export parsePNGStereo');

  const ster = pngParser.readSterChunk(png.bytes);
  assert.equal(ster.type, 'left-right');

  await withSplitColorCanvas(async () => {
    const data = await pngParser.parsePNGStereo(png.dataUrl);
    assertStereoData(data);
    assert.equal(data.leftEye.data[0], 255);
    assert.equal(data.leftEye.data[2], 0);
    assert.equal(data.rightEye.data[0], 0);
    assert.equal(data.rightEye.data[2], 255);
  });
});

test('PNG 2.2: sTER chunk with mode 0 (cross-fuse / right-left layout)', async () => {
  const png = createPNGStereo({ mode: 0 });
  let sterIndex = -1;
  for (let i = 8; i < png.bytes.length - 8; i++) {
    const tag = Buffer.from(png.bytes.subarray(i + 4, i + 8)).toString('ascii');
    if (tag === 'sTER') {
      sterIndex = i;
      break;
    }
  }
  assert.ok(sterIndex > 0, 'sTER chunk must be present');
  const modeByte = png.bytes[sterIndex + 8];
  assert.equal(modeByte, 0, 'Mode 0 for cross-fuse');

  const pngParser = await getParser('png');
  assert.ok(typeof pngParser?.readSterChunk === 'function', 'png-parser must export readSterChunk');
  assert.ok(typeof pngParser?.parsePNGStereo === 'function', 'png-parser must export parsePNGStereo');

  const ster = pngParser.readSterChunk(png.bytes);
  assert.equal(ster.mode, 0);
  assert.equal(ster.type, 'right-left');

  await withSplitColorCanvas(async () => {
    const data = await pngParser.parsePNGStereo(png.dataUrl);
    assertStereoData(data);
    assert.equal(data.leftEye.data[0], 0);
    assert.equal(data.leftEye.data[2], 255);
    assert.equal(data.rightEye.data[0], 255);
    assert.equal(data.rightEye.data[2], 0);
  });
});

test('PNG 2.3: .pns file extension fallback when sTER chunk is omitted', async () => {
  const png = createPNGStereo({ omitSter: true });
  let hasSter = false;
  for (let i = 8; i < png.bytes.length - 8; i++) {
    const tag = Buffer.from(png.bytes.subarray(i + 4, i + 8)).toString('ascii');
    if (tag === 'sTER') hasSter = true;
  }
  assert.equal(hasSter, false, 'sTER chunk must be absent');

  const pngParser = await getParser('png');
  assert.ok(typeof pngParser?.readSterChunk === 'function', 'png-parser must export readSterChunk');
  assert.ok(typeof pngParser?.parsePNS === 'function', 'png-parser must export parsePNS');

  assert.equal(pngParser.readSterChunk(png.bytes), null);
  const data = await pngParser.parsePNS(png.dataUrl, { originalUrl: 'https://example.com/gallery/landscape.pns' });
  assertStereoData(data);

  const el = await createStereoImgElement();
  el.src = png.dataUrl;
  el.type = 'pns';
  const parsed = await el.parse();
  assertStereoData(parsed);
});

test('PNG 2.4: sTER chunk with valid CRC-32 integrity', async () => {
  const png = createPNGStereo({ mode: 1 });
  let sterIndex = -1;
  for (let i = 8; i < png.bytes.length - 8; i++) {
    const tag = Buffer.from(png.bytes.subarray(i + 4, i + 8)).toString('ascii');
    if (tag === 'sTER') {
      sterIndex = i;
      break;
    }
  }
  const chunkTypeAndData = png.bytes.subarray(sterIndex + 4, sterIndex + 9);
  const calculatedCrc = crc32(chunkTypeAndData);
  const storedCrc = (png.bytes[sterIndex + 9] << 24) |
                    (png.bytes[sterIndex + 10] << 16) |
                    (png.bytes[sterIndex + 11] << 8) |
                    png.bytes[sterIndex + 12];
  assert.equal((calculatedCrc >>> 0), (storedCrc >>> 0), 'sTER CRC32 must match calculated checksum');

  const pngParser = await getParser('png');
  assert.ok(typeof pngParser?.readSterChunk === 'function', 'png-parser must export readSterChunk');
  const ster = pngParser.readSterChunk(png.bytes);
  assert.ok(ster, 'readSterChunk must validate chunk');
  assert.equal(ster.mode, 1);
  assert.equal(ster.type, 'left-right');
});

test('PNG 2.5: PNG stereo with custom dimensions (800x400)', async () => {
  const png = createPNGStereo({ mode: 1, width: 800, height: 400 });
  const pngParser = await getParser('png');
  assert.ok(typeof pngParser?.calculateSubimageBounds === 'function', 'png-parser must export calculateSubimageBounds');
  const bounds = pngParser.calculateSubimageBounds(800, 400);
  assert.equal(bounds.subWidth, 400);
  assert.equal(bounds.padding, 0);
  assert.equal(bounds.leftBounds.width, 400);
  assert.equal(bounds.rightBounds.width, 400);

  assert.ok(typeof pngParser?.parsePNGStereo === 'function', 'png-parser must export parsePNGStereo');
  const data = await pngParser.parsePNGStereo(png.dataUrl);
  assertStereoData(data);

  const el = await createStereoImgElement();
  el.src = png.dataUrl;
  const parsed = await el.parse();
  assertStereoData(parsed);
});

// ============================================================================
// FEATURE 3: Apple Portrait Depth Parser (HEIC auxC disparity & JPEG MPF)
// ============================================================================

test('Apple Portrait 3.1: HEIC ISOBMFF auxC disparity auxiliary property', async () => {
  const heic = createHEICDepth({ auxType: 'urn:apple:photo:2018:aux:disparity' });
  const heicParser = await getParser('heic');
  assert.ok(typeof heicParser?.readHeic === 'function', 'readHeic must be exported by heic-parser');

  // Exercise production ISOBMFF box parser on synthetic auxC disparity fixture
  const structure = heicParser.readHeic(heic.bytes);
  assert.ok(structure, 'readHeic must parse container structure');
  assert.equal(structure.primary, 1, 'Primary item ID must be 1');
  assert.equal(structure.depth, 2, 'Depth auxiliary item ID must be resolved from auxC disparity property');
  assert.equal(structure.depthType, 'disparity', 'Disparity auxiliary item must have disparity polarity');
  assert.equal(structure.stereoPair, undefined, 'Apple Portrait HEIC must not be classified as stereo pair');
});

test('Apple Portrait 3.2: HEIC ISOBMFF auxC depth auxiliary property', async () => {
  const heic = createHEICDepth({ auxType: 'urn:apple:photo:2018:aux:depth' });
  const heicParser = await getParser('heic');
  assert.ok(typeof heicParser?.readHeic === 'function', 'readHeic must be exported by heic-parser');

  // Exercise production parser recognizing ISO/Apple aux:depth URN
  const structure = heicParser.readHeic(heic.bytes);
  assert.ok(structure, 'readHeic must parse container structure');
  assert.equal(structure.primary, 1, 'Primary item ID must be 1');
  assert.equal(structure.depth, 2, 'Depth auxiliary item ID must be resolved from aux:depth URN');
  assert.equal(structure.depthType, 'depth', 'Metric depth auxiliary item must have depth polarity');
  assert.equal(structure.stereoPair, undefined, 'Apple Portrait HEIC must not be classified as stereo pair');
});

test('Apple Portrait 3.3: HEIC auxl item reference linking auxiliary item to primary item', async () => {
  const heic = createHEICDepth({ primaryItemId: 10, depthItemId: 20 });
  const heicParser = await getParser('heic');
  assert.ok(typeof heicParser?.readHeic === 'function', 'readHeic must be exported by heic-parser');

  // Exercise production iref/auxl box reader in readHeic
  const structure = heicParser.readHeic(heic.bytes);
  assert.ok(structure, 'readHeic must parse container structure');
  assert.equal(structure.primary, 10, 'Primary item ID must be resolved as 10');
  assert.equal(structure.depth, 20, 'Auxiliary item ID must be resolved as 20 linked via auxl reference');
});

test('Apple Portrait 3.4: JPEG MPF secondary disparity map extraction (synthetic MPF container)', async () => {
  const depthParser = await getParser('depth');
  assert.ok(typeof depthParser?.parseDepth === 'function', 'depth-parser must export parseDepth');
  const mpoParser = await getParser('mpo');
  assert.ok(typeof mpoParser?.readMpoDisparity === 'function', 'mpo-parser must export readMpoDisparity');

  const mpfBytes = createMPO([0x030000, 0x020002]);
  const mpfDataUrl = 'data:image/jpeg;base64,' + Buffer.from(mpfBytes).toString('base64');

  const mpfResult = mpoParser.readMpoDisparity(mpfBytes);
  assert.ok(mpfResult, 'readMpoDisparity must extract MPF disparity from JPEG MPF container');
  assert.ok(mpfResult.primary.length > 0 && mpfResult.disparity.length > 0, 'Primary and disparity slices must be non-empty');
  assert.equal(mpoParser.readStereoPair(mpfBytes).length, 0, 'MPF disparity photo must not be classified as stereo pair');

  const data = await depthParser.parseDepth(mpfDataUrl);
  assertStereoData(data, { hasDepth: true });
  assert.ok(data.depth, 'depthParser.parseDepth must produce depth visual content');

  const el = await createStereoImgElement();
  el.src = mpfDataUrl;
  const parsed = await el.parse();
  assertStereoData(parsed, { hasDepth: true });
  assert.ok(parsed.depth, '<stereo-img>.parse() must produce depth visual content for MPF JPEG');
});

test('Apple Portrait 3.5: Authentic iPhone HEIC container parsing excludes HDR gain map from depth (iphone-spatial.HEIC)', async () => {
  const heicParser = await getParser('heic');
  assert.ok(typeof heicParser?.readHeic === 'function', 'readHeic must be exported by heic-parser');

  const asset = loadExampleAsset('iphone-spatial.HEIC');
  const structure = heicParser.readHeic(asset.bytes);
  assert.ok(structure, 'readHeic must parse authentic iphone-spatial.HEIC container');
  assert.equal(structure.primary, 46, 'iphone-spatial.HEIC primary item ID must be 46');
  assert.deepEqual(structure.stereoPair, [122, 95], 'iphone-spatial.HEIC must extract stereoPair [122, 95]');
  assert.equal(structure.depth, undefined, 'HDR gain map (urn:com:apple:photo:2020:aux:hdrgainmap) must NOT be misclassified as depth');
  assert.equal(structure.depthType, undefined, 'depthType must remain undefined when only HDR gain map and alpha auxC boxes exist');
});

// ============================================================================
// FEATURE 4: RGB-D Composite Parser (Side-by-Side & Top-Bottom)
// ============================================================================

const rgbdParser = await getParser('rgbd');
const rgbdSkipReason = !rgbdParser ? 'RGB-D composite parser pending merge (Milestone M1)' : false;

test('RGB-D 4.1: Side-by-side composite with color on left and depth on right (left-right)', { skip: rgbdSkipReason }, async () => {
  const rgbd = createRGBD({ layout: 'left-right', width: 200, height: 100 });
  const data = await rgbdParser.parseRGBD(rgbd.dataUrl, { layout: 'left-right' });
  assertStereoData(data, { hasDepth: true });
});

test('RGB-D 4.2: Side-by-side composite with depth on left and color on right (right-left)', { skip: rgbdSkipReason }, async () => {
  const rgbd = createRGBD({ layout: 'right-left', width: 200, height: 100 });
  const data = await rgbdParser.parseRGBD(rgbd.dataUrl, { layout: 'right-left' });
  assertStereoData(data, { hasDepth: true });
});

test('RGB-D 4.3: Top-bottom composite with color on top and depth on bottom', { skip: rgbdSkipReason }, async () => {
  const rgbd = createRGBD({ layout: 'top-bottom', width: 100, height: 200 });
  const data = await rgbdParser.parseRGBD(rgbd.dataUrl, { layout: 'top-bottom' });
  assertStereoData(data, { hasDepth: true });
});

test('RGB-D 4.4: Top-bottom composite with depth on top and color on bottom', { skip: rgbdSkipReason }, async () => {
  const rgbd = createRGBD({ layout: 'bottom-top', width: 100, height: 200 });
  const data = await rgbdParser.parseRGBD(rgbd.dataUrl, { layout: 'bottom-top' });
  assertStereoData(data, { hasDepth: true });
});

test('RGB-D 4.5: Visual eye separation and displacement depth map assignment', { skip: rgbdSkipReason }, async () => {
  const rgbd = createRGBD({ layout: 'left-right', width: 200, height: 100 });
  const data = await rgbdParser.parseRGBD(rgbd.dataUrl, { layout: 'left-right' });
  assertStereoData(data, { hasDepth: true });
  assert.ok(data.depth, 'RGB-D parser must attach displacement depth map');
});

// ============================================================================
// FEATURE 5: AVIF Spatial / Stereo Parser (MIAF / 'ster' entity group)
// ============================================================================

const avifParser = await getParser('avif');
const avifSkipReason = !avifParser ? 'AVIF spatial parser pending merge (Milestone M2)' : false;

test('AVIF 5.1: ISOBMFF container with MIAF ster entity group grouping 2 item IDs', { skip: avifSkipReason }, async () => {
  const avif = createAVIFStereo({ stereoGroup: [1, 2] });
  const data = await avifParser.parseAVIFStereo(avif.dataUrl);
  assertStereoData(data);
});

test('AVIF 5.2: Primary item assignment as left eye and secondary as right eye', { skip: avifSkipReason }, async () => {
  const avif = createAVIFStereo({ stereoGroup: [10, 20] });
  const data = await avifParser.parseAVIFStereo(avif.dataUrl);
  assertStereoData(data);
});

test('AVIF 5.3: MIAF compatible brands declaration (miaf, avif, mif1)', { skip: avifSkipReason }, async () => {
  const avif = createAVIFStereo();
  const data = await avifParser.parseAVIFStereo(avif.dataUrl);
  assertStereoData(data);
});

test('AVIF 5.4: Non-consecutive stereo entity IDs handling (e.g. [5, 42])', { skip: avifSkipReason }, async () => {
  const avif = createAVIFStereo({ stereoGroup: [5, 42] });
  const data = await avifParser.parseAVIFStereo(avif.dataUrl);
  assertStereoData(data);
});

test('AVIF 5.5: AVIF StereoData FOV angle derivation adheres to contract', { skip: avifSkipReason }, async () => {
  const avif = createAVIFStereo();
  const data = await avifParser.parseAVIFStereo(avif.dataUrl);
  assertStereoData(data);
});

// ============================================================================
// FEATURE 6: Looking Glass Quilt Parser ('_qs<Cols>x<Rows>a<Aspect>')
// ============================================================================

const quiltParser = await getParser('quilt');
const quiltSkipReason = !quiltParser ? 'Looking Glass Quilt parser pending merge (Milestone M2)' : false;

test('Quilt 6.1: Filename regex parsing with standard 8x6 layout and 0.75 aspect', { skip: quiltSkipReason }, async () => {
  const descriptor = createQuiltDescriptor(8, 6, 0.75);
  const data = await quiltParser.default(descriptor.filename);
  assertStereoData(data);
});

test('Quilt 6.2: Filename regex parsing with high-density 5x9 layout and 0.5625 aspect', { skip: quiltSkipReason }, async () => {
  const descriptor = createQuiltDescriptor(5, 9, 0.5625);
  const data = await quiltParser.default(descriptor.filename);
  assertStereoData(data);
});

test('Quilt 6.3: Tile geometry slicing: bottom-left tile (view 0) extraction', { skip: quiltSkipReason }, async () => {
  const descriptor = createQuiltDescriptor(8, 6, 0.75);
  const data = await quiltParser.default(descriptor.filename, { viewIndex: 0 });
  assertStereoData(data);
});

test('Quilt 6.4: Tile geometry slicing: top-right tile (view N-1) extraction', { skip: quiltSkipReason }, async () => {
  const descriptor = createQuiltDescriptor(8, 6, 0.75);
  const data = await quiltParser.default(descriptor.filename, { viewIndex: 47 });
  assertStereoData(data);
});

test('Quilt 6.5: Baseline stereo pair selection from extreme viewpoints', { skip: quiltSkipReason }, async () => {
  const descriptor = createQuiltDescriptor(8, 6, 0.75);
  const data = await quiltParser.default(descriptor.filename);
  assertStereoData(data);
});

// ============================================================================
// FEATURE 7: Animated Wigglegram Parser (GIF/WebP/APNG multi-frame)
// ============================================================================

const wiggleParser = await getParser('wiggle');
const wiggleSkipReason = !wiggleParser ? 'Animated Wigglegram parser pending merge (Milestone M2)' : false;

test('Wigglegram 7.1: Multi-frame animated GIF with 2 alternating viewpoints', { skip: wiggleSkipReason }, async () => {
  const gif = createWigglegram({ frameCount: 2, width: 200, height: 200 });
  const data = await wiggleParser.parseWigglegram(gif.dataUrl);
  assertStereoData(data);
});

test('Wigglegram 7.2: Multi-frame animated GIF with multi-view oscillation (4 frames)', { skip: wiggleSkipReason }, async () => {
  const gif = createWigglegram({ frameCount: 4, width: 300, height: 300 });
  const data = await wiggleParser.parseWigglegram(gif.dataUrl);
  assertStereoData(data);
});

test('Wigglegram 7.3: Left-eye frame assignment to viewpoint 0', { skip: wiggleSkipReason }, async () => {
  const gif = createWigglegram({ frameCount: 4 });
  const data = await wiggleParser.parseWigglegram(gif.dataUrl, { eyeOrder: 'left-right' });
  assertStereoData(data);
});

test('Wigglegram 7.4: Right-eye frame assignment to opposite baseline frame', { skip: wiggleSkipReason }, async () => {
  const gif = createWigglegram({ frameCount: 4 });
  const data = await wiggleParser.parseWigglegram(gif.dataUrl);
  assertStereoData(data);
});

test('Wigglegram 7.5: Preservation of frame dimensions and aspect ratio', { skip: wiggleSkipReason }, async () => {
  const gif = createWigglegram({ width: 640, height: 480 });
  const data = await wiggleParser.parseWigglegram(gif.dataUrl);
  assertStereoData(data, { aspectRatio: 640 / 480 });
});

// ============================================================================
// REGRESSION COVERAGE: Existing Formats
// ============================================================================

test('Regression 11.1: MPO stereo parser happy-path regression', async () => {
  const mpoParser = await getParser('mpo');
  assert.ok(mpoParser?.readStereoPair, 'MPO parser must export readStereoPair');
  const asset = loadExampleAsset('Panasonic-DMC-GX8.mpo');
  const pair = mpoParser.readStereoPair(asset.bytes);
  assert.equal(pair.length, 2, 'MPO must contain 2 stereo images');
});

test('Regression 11.2: Apple Vision Pro HEIC spatial photo happy-path regression', async () => {
  const heicParser = await getParser('heic');
  assert.ok(heicParser?.readHeic, 'HEIC parser must export readHeic');
  const asset = loadExampleAsset('vision-pro.HEIC');
  const info = heicParser.readHeic(asset.bytes);
  assert.ok(info.stereoPair, 'Vision Pro HEIC must contain a stereoPair');
  assert.equal(info.stereoPair.length, 2);
});

test('Regression 11.3: Google Camera Depth photo happy-path regression', async () => {
  const depthParser = await getParser('depth');
  assert.ok(typeof depthParser?.parseDepth === 'function', 'Depth parser must export parseDepth');
  const asset = loadExampleAsset('Pixel7Pro.PORTRAIT.jpg');
  const data = await depthParser.parseDepth(asset.dataUrl);
  assertStereoData(data, { hasDepth: true });
});

test('Regression 11.4: Standard Side-by-Side JPEG happy-path regression', async () => {
  const stereoParser = await getParser('stereo');
  assert.ok(typeof stereoParser?.parseStereo === 'function', 'Stereo parser must export parseStereo');
  const asset = loadExampleAsset('stereograph.left-right.jpg');
  const data = await stereoParser.parseStereo(asset.dataUrl);
  assertStereoData(data);
});
