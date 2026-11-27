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
import { readFileSync, existsSync } from 'node:fs';

import { parseHEIC, readHeic, invertDepthData } from '../../parsers/heic-parser/heic-parser.js';
import { readMpoIndex, readMpoDisparity, readStereoPair } from '../../parsers/mpo-parser/mpo-parser.js';
import { parseDepth, invertDisparityImage } from '../../parsers/depth-parser/depth-parser.js';
import { describesDepthMap, StereoImg } from '../../stereo-img.js';

// ============================================================================
// Synthetic Helpers for ISOBMFF and MPF
// ============================================================================

const text = v => new Uint8Array(Array.from(v, c => c.charCodeAt(0)));
const u16 = (...values) => new Uint8Array(values.flatMap(v => [(v >>> 8) & 255, v & 255]));
const u32 = (...values) => new Uint8Array(values.flatMap(v => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]));
const concat = (...parts) => new Uint8Array(parts.flatMap(p => Array.from(p instanceof Uint8Array ? p : new Uint8Array(p))));

function box(type, ...contents) {
  const content = concat(...contents);
  const size = 8 + content.length;
  return concat(u32(size), text(type), content);
}

function fullBox(type, version = 0, flags = 0, ...contents) {
  const versionFlags = new Uint8Array([version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]);
  return box(type, versionFlags, ...contents);
}

/**
 * Builds an authentic synthetic HEIC container containing primary image item and auxiliary depth/disparity items.
 */
function makeHeicPortraitDepth({
  primaryId = 1,
  auxId = 2,
  auxType = 'urn:com:apple:photo:2018:aux:disparity',
  includeMatte = false,
  includeGainMap = false,
  omitAux = false,
} = {}) {
  const ftyp = box('ftyp', text('heic'), u32(0), text('mif1'), text('heic'));
  const pitm = fullBox('pitm', 0, 0, u16(primaryId));

  if (omitAux) {
    return concat(ftyp, box('meta', u32(0), pitm));
  }

  // iref: Item Reference Box. auxl links auxId -> primaryId
  const auxl = box('auxl', u16(auxId), u16(1), u16(primaryId));
  const iref = fullBox('iref', 0, 0, auxl);

  // iprp: Item Properties Box
  const ispe = fullBox('ispe', 0, 0, u32(100, 100));
  const auxCText = concat(text(auxType), new Uint8Array([0]));
  const auxC = fullBox('auxC', 0, 0, auxCText);

  const ipcoChildren = [ispe, auxC];
  let matteIndex = 0;
  if (includeMatte) {
    const matteText = concat(text('urn:com:apple:photo:2020:aux:portraitmatte'), new Uint8Array([0]));
    ipcoChildren.push(fullBox('auxC', 0, 0, matteText));
    matteIndex = ipcoChildren.length; // 1-based index
  }
  let gainMapIndex = 0;
  if (includeGainMap) {
    const gainMapText = concat(text('urn:com:apple:photo:2020:aux:hdrgainmap'), new Uint8Array([0]));
    ipcoChildren.push(fullBox('auxC', 0, 0, gainMapText));
    gainMapIndex = ipcoChildren.length;
  }
  const ipco = box('ipco', ...ipcoChildren);

  // ipma: associations
  const entries = [
    // entry 1: primaryId -> prop 1 (ispe)
    u16(primaryId), new Uint8Array([1, 1]),
    // entry 2: auxId -> prop 2 (auxC disparity)
    u16(auxId), new Uint8Array([1, 2]),
  ];
  let entryCount = 2;
  if (includeMatte) {
    entryCount++;
    entries.push(u16(10), new Uint8Array([1, matteIndex])); // item 10 has matte
  }
  if (includeGainMap) {
    entryCount++;
    entries.push(u16(20), new Uint8Array([1, gainMapIndex])); // item 20 has gainmap
  }

  const ipma = fullBox('ipma', 0, 0, u32(entryCount), concat(...entries));
  const iprp = box('iprp', ipco, ipma);

  return concat(ftyp, box('meta', u32(0), pitm, iref, iprp));
}

const DISPARITY = 0x020002;
const PRIMARY = 0x030000;
const LARGE_THUMBNAIL = 0x010001;

function makeMinimalJpeg(payload = [0x01, 0x02]) {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x03, 0x00, ...payload, 0xff, 0xd9]);
}

function makeMpo(types, { littleEndian = true } = {}) {
  const others = types.slice(1).map((_, i) => makeMinimalJpeg([i]));
  const entriesOffset = 8 + 2 + 3 * 12 + 4;
  const index = new DataView(new ArrayBuffer(entriesOffset + 16 * types.length));
  index.setUint8(0, littleEndian ? 0x49 : 0x4d);
  index.setUint8(1, littleEndian ? 0x49 : 0x4d);
  index.setUint16(2, 42, littleEndian);
  index.setUint32(4, 8, littleEndian);
  index.setUint16(8, 3, littleEndian);

  const tags = [
    [0xb000, 7, 4, 0x30303130],
    [0xb001, 4, 1, types.length],
    [0xb002, 7, 16 * types.length, entriesOffset],
  ];
  tags.forEach(([tag, type, count, value], i) => {
    index.setUint16(10 + 12 * i, tag, littleEndian);
    index.setUint16(12 + 12 * i, type, littleEndian);
    index.setUint32(14 + 12 * i, count, littleEndian);
    index.setUint32(18 + 12 * i, value, littleEndian);
  });

  const segmentLength = 2 + 4 + index.byteLength;
  const first = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe2, segmentLength >> 8, segmentLength & 255, 0x4d, 0x50, 0x46, 0x00,
    ...new Uint8Array(index.buffer), 0xff, 0xdb, 0x00, 0x03, 0x00, 0xff, 0xd9,
  ]);
  const headerPosition = 10;

  let position = first.length;
  types.forEach((type, i) => {
    const entry = entriesOffset + 16 * i;
    const size = i === 0 ? first.length : others[i - 1].length;
    const offset = i === 0 ? 0 : position - headerPosition;
    index.setUint32(entry, (i === 0 ? 0x20000000 : 0) | type, littleEndian);
    index.setUint32(entry + 4, size, littleEndian);
    index.setUint32(entry + 8, offset, littleEndian);
    if (i > 0) position += size;
  });
  first.set(new Uint8Array(index.buffer), headerPosition);

  return new Uint8Array([...first, ...others.flatMap(image => [...image])]);
}

class FakeImage {
  constructor() {
    this.width = 100;
    this.height = 100;
    this._src = '';
    this._onload = null;
    this._onerror = null;
  }
  set src(v) {
    this._src = v;
    if (this._onload) setImmediate(this._onload);
  }
  get src() {
    return this._src;
  }
  set onload(fn) {
    this._onload = fn;
    if (this._src) setImmediate(fn);
  }
  get onload() {
    return this._onload;
  }
  set onerror(fn) {
    this._onerror = fn;
  }
  get onerror() {
    return this._onerror;
  }
}

// ============================================================================
// HEIC Auxiliary Disparity Tests
// ============================================================================

test('readHeic identifies auxiliary disparity item in Apple Portrait HEIC', () => {
  const bytes = makeHeicPortraitDepth({ primaryId: 1, auxId: 42, auxType: 'urn:com:apple:photo:2018:aux:disparity' });
  const result = readHeic(bytes);

  assert.equal(result.primary, 1);
  assert.equal(result.depth, 42);
  assert.equal(result.depthType, 'disparity');
  assert.equal(result.stereoPair, undefined);
});

test('readHeic supports urn:com:apple:photo:2018:aux:depth URN with metric depth polarity', () => {
  const bytes = makeHeicPortraitDepth({ primaryId: 3, auxId: 8, auxType: 'urn:com:apple:photo:2018:aux:depth' });
  const result = readHeic(bytes);

  assert.equal(result.primary, 3);
  assert.equal(result.depth, 8);
  assert.equal(result.depthType, 'depth');
  assert.equal(result.stereoPair, undefined);
});

test('readHeic supports urn:mpeg:mpegB:cicp:systems:auxiliary:depth ISO standard URN with metric depth polarity', () => {
  const bytes = makeHeicPortraitDepth({ primaryId: 10, auxId: 99, auxType: 'urn:mpeg:mpegB:cicp:systems:auxiliary:depth' });
  const result = readHeic(bytes);

  assert.equal(result.primary, 10);
  assert.equal(result.depth, 99);
  assert.equal(result.depthType, 'depth');
  assert.equal(result.stereoPair, undefined);
});

test('readHeic handles multiple auxiliary items and selects disparity while ignoring matte masks and gain maps', () => {
  const bytes = makeHeicPortraitDepth({
    primaryId: 1,
    auxId: 5,
    auxType: 'urn:com:apple:photo:2018:aux:disparity',
    includeMatte: true,
    includeGainMap: true,
  });
  const result = readHeic(bytes);

  assert.equal(result.primary, 1);
  assert.equal(result.depth, 5);
  assert.equal(result.stereoPair, undefined);
});

test('readHeic ignores non-depth auxiliary items when no depth item is present', () => {
  // Only portrait matte is present, no disparity/depth
  const bytes = makeHeicPortraitDepth({
    primaryId: 1,
    auxId: 5,
    auxType: 'urn:com:apple:photo:2020:aux:portraitmatte',
  });
  const result = readHeic(bytes);

  assert.equal(result.primary, 1);
  assert.equal(result.depth, undefined);
  assert.equal(result.stereoPair, undefined);
});

test('readHeic falls back to mono when no auxiliary depth item is present', () => {
  const bytes = makeHeicPortraitDepth({ primaryId: 7, omitAux: true });
  const result = readHeic(bytes);

  assert.equal(result.primary, 7);
  assert.equal(result.depth, undefined);
  assert.equal(result.stereoPair, undefined);
});

test('readHeic ignores hdrgainmap in authentic iphone-spatial.HEIC asset and extracts stereoPair', () => {
  if (existsSync('examples/iphone-spatial.HEIC')) {
    const bytes = new Uint8Array(readFileSync('examples/iphone-spatial.HEIC'));
    const result = readHeic(bytes);
    assert.ok(result, 'Must parse iphone-spatial.HEIC');
    assert.ok(result.stereoPair, 'Must detect stereoPair');
    assert.equal(result.stereoPair.length, 2);
    // Should NOT identify the HDR gain map as a disparity depth map
    assert.equal(result.depth, undefined, 'HDR gain map must not be treated as depth');
  }
});

// ============================================================================
// JPEG MPF Portrait Disparity Tests
// ============================================================================

test('readMpoDisparity extracts primary and disparity JPEG slices from MPF container', () => {
  const bytes = makeMpo([PRIMARY, DISPARITY]);
  const result = readMpoDisparity(bytes);

  assert.ok(result, 'readMpoDisparity must return an object');
  assert.ok(result.primary instanceof Uint8Array, 'primary must be Uint8Array');
  assert.ok(result.disparity instanceof Uint8Array, 'disparity must be Uint8Array');
  assert.ok(result.primary.length > 0);
  assert.ok(result.disparity.length > 0);
  // Verify JPEG SOI markers
  assert.equal(result.primary[0], 0xff);
  assert.equal(result.primary[1], 0xd8);
  assert.equal(result.disparity[0], 0xff);
  assert.equal(result.disparity[1], 0xd8);
});

test('discrimination: readStereoPair vs readMpoDisparity', () => {
  // 1. Stereo MPO: 2 DISPARITY views
  const stereoMpo = makeMpo([DISPARITY, DISPARITY]);
  const stereoViews = readStereoPair(stereoMpo);
  assert.equal(stereoViews.length, 2, 'Stereo MPO must yield 2 stereo views');

  // 2. Apple Portrait MPF: PRIMARY + DISPARITY
  const portraitMpo = makeMpo([PRIMARY, DISPARITY]);
  const portraitStereoViews = readStereoPair(portraitMpo);
  assert.equal(portraitStereoViews.length, 0, 'Apple Portrait must NOT be treated as stereo pair');
  const disparityObj = readMpoDisparity(portraitMpo);
  assert.ok(disparityObj, 'Apple Portrait must be detected by readMpoDisparity');
  assert.ok(disparityObj.disparity.length > 0);
});

test('readMpoDisparity returns undefined for files without secondary disparity image', () => {
  // Regular image with thumbnail only
  const thumbBytes = makeMpo([PRIMARY, LARGE_THUMBNAIL]);
  assert.equal(readMpoDisparity(thumbBytes), undefined);

  // Non-MPF data
  const plainBytes = makeMinimalJpeg([0xaa, 0xbb]);
  assert.equal(readMpoDisparity(plainBytes), undefined);
});

test('parseDepth extracts MPF disparity JPEG and satisfies StereoData contract', async () => {
  const OriginalImage = global.Image;
  global.Image = FakeImage;
  try {
    const bytes = makeMpo([PRIMARY, DISPARITY]);
    const url = 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');

    const result = await parseDepth(url);

    assert.ok(result, 'parseDepth must return result');
    assert.ok(result.depth instanceof FakeImage, 'result.depth must be an Image instance');
    assert.strictEqual(result.leftEye, result.rightEye, 'leftEye and rightEye must be identical (mono color base)');
    assert.equal(typeof result.phiLength, 'number');
    assert.ok(result.phiLength < Math.PI / 2, 'phiLength must be planar (< PI/2)');
    assert.equal(typeof result.thetaLength, 'number');
    assert.ok(result.thetaLength > 0);
    assert.equal(result.thetaStart, Math.PI / 2 - result.thetaLength / 2);
    assert.equal(result.projection, undefined, 'planar projection must be undefined');
  } finally {
    global.Image = OriginalImage;
  }
});

test('describesDepthMap detects MPF disparity JPEGs when bytes are provided', async () => {
  const mpfBytes = makeMpo([PRIMARY, DISPARITY]);
  assert.equal(await describesDepthMap({}, mpfBytes), true, 'Must detect MPF disparity');

  const stereoBytes = makeMpo([DISPARITY, DISPARITY]);
  // Stereo pair without disparity secondary entry offset > 0 (or primary baseline) is not depth map
  const plainBytes = makeMinimalJpeg();
  assert.equal(await describesDepthMap({}, plainBytes), false, 'Must not detect plain JPEG as depth map');
});

// ============================================================================
// Synthetic HEIC Fixture & Polarity / Fetch Reuse Tests
// ============================================================================

test('Synthetic fixture: readHeic parses in-memory HEIC auxiliary disparity container', () => {
  const bytes = makeHeicPortraitDepth({
    primaryId: 1,
    auxId: 2,
    auxType: 'urn:com:apple:photo:2018:aux:disparity',
    includeMatte: true,
    includeGainMap: true,
  });
  const info = readHeic(bytes);
  assert.ok(info, 'Must parse in-memory synthetic HEIC portrait fixture');
  assert.equal(info.primary, 1);
  assert.equal(info.depth, 2);
  assert.equal(info.depthType, 'disparity');
  assert.equal(info.stereoPair, undefined);
});

test('invertDepthData converts disparity grayscale values (255=near, 0=far) to metric depth (0=near, 255=far) while preserving alpha', () => {
  const imageData = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([
      255, 255, 255, 255, // near in disparity (255) -> near in metric depth (0)
      200, 100, 50, 128,  // arbitrary RGB + alpha 128
    ]),
  };
  invertDepthData(imageData);
  assert.deepStrictEqual(
    Array.from(imageData.data),
    [0, 0, 0, 255, 55, 155, 205, 128],
  );
});

test('parseDepth reuses pre-fetched options.bytes without redundant network fetch', async () => {
  const OriginalImage = global.Image;
  const OriginalFetch = global.fetch;
  let fetchCalls = 0;
  global.Image = FakeImage;
  global.fetch = async () => {
    fetchCalls++;
    throw new Error('fetch should not be called when options.bytes is provided');
  };
  try {
    const bytes = makeMpo([PRIMARY, DISPARITY]);
    const result = await parseDepth('https://example.invalid/portrait.jpg', { bytes });
    assert.equal(fetchCalls, 0, 'Must not call fetch when options.bytes is supplied');
    assert.ok(result.depth instanceof FakeImage);
    assert.strictEqual(result.leftEye, result.rightEye);
  } finally {
    global.Image = OriginalImage;
    global.fetch = OriginalFetch;
  }
});

// ============================================================================
// Synthetic MPF Edge-Case & Polarity Inversion Tests
// ============================================================================

test('readMpoDisparity skips leading LARGE_THUMBNAIL entries before DISPARITY', () => {
  const bytes = makeMpo([PRIMARY, LARGE_THUMBNAIL, DISPARITY]);
  const result = readMpoDisparity(bytes);

  assert.ok(result, 'readMpoDisparity must find DISPARITY after LARGE_THUMBNAIL');
  assert.deepStrictEqual(Array.from(result.disparity), Array.from(makeMinimalJpeg([1])));
});

test('readMpoDisparity and parseDepth support big-endian MPF headers', async () => {
  const bytes = makeMpo([PRIMARY, DISPARITY], { littleEndian: false });
  const disp = readMpoDisparity(bytes);
  assert.ok(disp, 'Must parse big-endian MPF disparity');
  assert.equal(await describesDepthMap({}, bytes), true);

  const OriginalImage = global.Image;
  global.Image = FakeImage;
  try {
    const url = 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
    const result = await parseDepth(url, { bytes });
    assert.ok(result.depth instanceof FakeImage);
    assert.strictEqual(result.leftEye, result.rightEye);
  } finally {
    global.Image = OriginalImage;
  }
});

test('parseHEIC inverts disparity auxiliary maps and preserves metric depth auxiliary maps', async () => {
  const OriginalFetch = global.fetch;
  const OriginalImageData = global.ImageData;
  if (typeof global.ImageData === 'undefined') {
    global.ImageData = class ImageData {
      constructor(width, height) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    };
  }

  function patchVisionProAux(urn) {
    const bytes = new Uint8Array(readFileSync('examples/vision-pro.HEIC'));
    // Replace grpl box type at offset 3451 with 'free' to disable stereoPair
    bytes.set([0x66, 0x72, 0x65, 0x65], 3455);
    // Replace prop[8] colr (offset 2341, size 548) with auxC of identical size
    bytes.set([0x61, 0x75, 0x78, 0x43], 2345);
    bytes.fill(0, 2349, 2341 + 548);
    for (let i = 0; i < urn.length; i++) {
      bytes[2353 + i] = urn.charCodeAt(i);
    }
    return bytes;
  }

  const disparityHeic = patchVisionProAux('urn:com:apple:photo:2018:aux:disparity');
  const metricDepthHeic = patchVisionProAux('urn:com:apple:photo:2018:aux:depth');

  try {
    global.fetch = async (url) => {
      const buf = url.includes('disparity') ? disparityHeic : metricDepthHeic;
      return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    };

    const dispResult = await parseHEIC('https://example.invalid/disparity.heic');
    const metricResult = await parseHEIC('https://example.invalid/depth.heic');

    // Item 52 decoded raw pixel 0 is [247, 245, 243, 255]
    assert.deepStrictEqual(Array.from(metricResult.depth.data.slice(0, 4)), [247, 245, 243, 255], 'Metric depth must NOT be inverted');
    assert.deepStrictEqual(Array.from(dispResult.depth.data.slice(0, 4)), [8, 10, 12, 255], 'Disparity must be inverted to metric depth');
  } finally {
    global.fetch = OriginalFetch;
    global.ImageData = OriginalImageData;
  }
});

test('invertDisparityImage and parseDepth invert MPF disparity when canvas DOM is present, but preserve Google Container depth', async () => {
  const OriginalImage = global.Image;
  const OriginalDocument = global.document;
  const OriginalFetch = global.fetch;

  class MockCanvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this._pixels = null;
    }
    getContext(type) {
      if (type !== '2d') return null;
      return {
        drawImage: () => {
          this._pixels = { data: new Uint8ClampedArray([200, 100, 50, 128]) };
        },
        getImageData: () => this._pixels,
        putImageData: (imageData) => {
          this._pixels = imageData;
        },
      };
    }
  }

  global.Image = FakeImage;
  global.document = {
    createElement: (tag) => (tag === 'canvas' ? new MockCanvas() : null),
  };

  try {
    // 1. Direct invertDisparityImage test
    const img = new FakeImage();
    img.naturalWidth = 1;
    img.naturalHeight = 1;
    const invertedCanvas = invertDisparityImage(img);
    assert.ok(invertedCanvas instanceof MockCanvas);
    assert.deepStrictEqual(Array.from(invertedCanvas._pixels.data), [55, 155, 205, 128]);

    // 2. MPF disparity photo via parseDepth -> returns inverted MockCanvas
    const mpfBytes = makeMpo([PRIMARY, DISPARITY]);
    const mpfResult = await parseDepth('https://example.invalid/mpf.jpg', { bytes: mpfBytes });
    assert.ok(mpfResult.depth instanceof MockCanvas, 'MPF disparity must be inverted onto canvas');
    assert.deepStrictEqual(Array.from(mpfResult.depth._pixels.data), [55, 155, 205, 128]);

    // 3. Google Camera Container Semantic="Depth" -> must NOT be inverted
    const depthPayload = makeMinimalJpeg([9]);
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:Container="http://ns.google.com/photos/1.0/container/"
    xmlns:Item="http://ns.google.com/photos/1.0/container/item/">
   <Container:Directory>
    <rdf:Seq>
     <rdf:li rdf:parseType="Resource">
      <Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0"/>
     </rdf:li>
     <rdf:li rdf:parseType="Resource">
      <Container:Item Item:Mime="image/jpeg" Item:Semantic="Depth" Item:Length="${depthPayload.length}"/>
     </rdf:li>
    </rdf:Seq>
   </Container:Directory>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
    const xmpContent = [...Buffer.from('http://ns.adobe.com/xap/1.0/\0' + xmp, 'latin1')];
    const xmpLen = xmpContent.length + 2;
    const xmpSeg = [0xff, 0xe1, xmpLen >> 8, xmpLen & 255, ...xmpContent];
    const primaryWithXmp = new Uint8Array([0xff, 0xd8, ...xmpSeg, 0x00, 0xff, 0xd9]);
    const containerBytes = new Uint8Array([...primaryWithXmp, ...depthPayload]);

    const containerResult = await parseDepth('https://example.invalid/container.jpg', { bytes: containerBytes });
    assert.ok(containerResult.depth instanceof FakeImage, 'Google Container Depth must NOT be inverted');
  } finally {
    global.Image = OriginalImage;
    global.document = OriginalDocument;
    global.fetch = OriginalFetch;
  }
});

// ============================================================================
// Reviewer 2 & Challenger 1/2 Hardening Tests
// ============================================================================

test('readHeic prefers auxC candidate whose auxl reference targets result.primary', () => {
  const ftyp = box('ftyp', text('heic'), u32(0), text('mif1'), text('heic'));
  const pitm = fullBox('pitm', 0, 0, u16(1));
  const iref = fullBox('iref', 0, 0,
    box('auxl', u16(5), u16(1), u16(99)),
    box('auxl', u16(6), u16(1), u16(1)),
  );
  const auxC = fullBox('auxC', 0, 0, concat(text('urn:com:apple:photo:2018:aux:disparity'), new Uint8Array([0])));
  const ipco = box('ipco', auxC);
  const ipma = fullBox('ipma', 0, 0, u32(2), concat(
    u16(5), new Uint8Array([1, 1]),
    u16(6), new Uint8Array([1, 1]),
  ));
  const iprp = box('iprp', ipco, ipma);
  const bytes = concat(ftyp, box('meta', u32(0), pitm, iref, iprp));

  const result = readHeic(bytes);
  assert.equal(result.primary, 1);
  assert.equal(result.depth, 6);
  assert.equal(result.depthType, 'disparity');
});

test('Challenger 1 E1-E5: readHeic and invertDepthData handle malformed inputs safely', () => {
  // E1: Non-Uint8Array inputs return undefined without throwing
  for (const bad of [null, undefined, [1, 2], 'ftypheic', 123]) {
    assert.equal(readHeic(bad), undefined);
  }

  // E2: >200 KB NUL-less auxC does not overflow call stack
  const ftyp = box('ftyp', text('heic'), u32(0), text('mif1'), text('heic'));
  const pitm = fullBox('pitm', 0, 0, u16(1));
  const hugeString = new Uint8Array(200 * 1024).fill(0x61); // 'a' without NUL
  const hugeAuxC = fullBox('auxC', 0, 0, hugeString);
  const iprpHuge = box('iprp', box('ipco', hugeAuxC));
  const hugeHeic = concat(ftyp, box('meta', u32(0), pitm, iprpHuge));
  assert.deepStrictEqual(readHeic(hugeHeic), { primary: 1, stereoPair: undefined });

  // E3: 0-byte pitm and 0-byte iref return valid structure instead of undefined
  const emptyPitm = box('pitm');
  const emptyIref = box('iref');
  const emptyBoxesHeic = concat(ftyp, box('meta', u32(0), emptyPitm, emptyIref));
  assert.deepStrictEqual(readHeic(emptyBoxesHeic), { primary: undefined, stereoPair: undefined });

  // E4: ipma-less portraitmatte + depth auxC does not pick portraitmatte via auxl fallback
  const matteAuxC = fullBox('auxC', 0, 0, concat(text('urn:com:apple:photo:2020:aux:portraitmatte'), new Uint8Array([0])));
  const depthAuxC = fullBox('auxC', 0, 0, concat(text('urn:com:apple:photo:2018:aux:depth'), new Uint8Array([0])));
  const irefE4 = fullBox('iref', 0, 0, box('auxl', u16(10), u16(1), u16(1)));
  const iprpE4 = box('iprp', box('ipco', matteAuxC, depthAuxC)); // no ipma
  const e4Heic = concat(ftyp, box('meta', u32(0), pitm, irefE4, iprpE4));
  const e4Result = readHeic(e4Heic);
  assert.equal(e4Result.primary, 1);
  assert.equal(e4Result.depth, undefined);

  // E5: invertDepthData handles null/invalid/non-multiple-of-4 inputs safely
  assert.equal(invertDepthData(null), null);
  assert.deepStrictEqual(invertDepthData({ data: 'abcd' }), { data: 'abcd' });
  const oddArray = { data: [10, 20] };
  invertDepthData(oddArray);
  assert.deepStrictEqual(oddArray.data, [10, 20]);
});

test('Challenger 2: parseDepth aborts when image loading hangs and explicit type="depth" reuses picture.bytes()', async () => {
  const OriginalImage = global.Image;
  const OriginalFetch = global.fetch;

  class HangingImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.src = '';
    }
  }

  global.Image = HangingImage;
  try {
    const controller = new AbortController();
    const promise = parseDepth('https://example.invalid/hang.jpg', { signal: controller.signal });
    setImmediate(() => controller.abort(new DOMException('Aborted', 'AbortError')));
    await assert.rejects(promise, (err) => err?.name === 'AbortError');
  } finally {
    global.Image = OriginalImage;
  }

  let fetchCalls = 0;
  global.Image = FakeImage;
  global.fetch = async () => {
    fetchCalls++;
    throw new Error('fetch should not be called by explicit type="depth"');
  };
  try {
    const mpfBytes = makeMpo([PRIMARY, DISPARITY]);
    const picture = {
      url: 'https://example.invalid/explicit-depth.jpg',
      objectURL: async () => 'blob:mock-explicit-depth',
      bytes: async () => mpfBytes,
    };
    const result = await StereoImg.prototype._parsePicture.call({}, picture, null, { type: 'depth', signal: undefined });
    assert.equal(fetchCalls, 0);
    assert.ok(result.depth instanceof FakeImage);
  } finally {
    global.Image = OriginalImage;
    global.fetch = OriginalFetch;
  }
});

test('readHeic detects urn:mpeg:hevc:2015:auxid:2 disparity SEI in real apple-portrait-pug.heic sample', () => {
  const samplePath = new URL('../../examples/apple-portrait-pug.heic', import.meta.url);
  assert.ok(existsSync(samplePath), 'examples/apple-portrait-pug.heic must exist');
  const bytes = new Uint8Array(readFileSync(samplePath));
  const result = readHeic(bytes);
  assert.equal(result.primary, 49);
  assert.equal(result.depth, 54);
  assert.equal(result.depthType, 'disparity');
  assert.equal(result.stereoPair, undefined);
});

test('readHeic distinguishes HEVC auxid:2 disparity SEI vs metric depth default', () => {
  const seiDisparitySubtype = new Uint8Array([
    0x00, 0x00, 0x00, 0x11, 0x00, 0x00, 0x00, 0x0d,
    0x4e, 0x01, 0xb1, 0x09, 0x35, 0x1f, 0x7b, 0xfc, 0x01, 0x0b, 0xc6, 0x20, 0x20,
  ]);
  const ftyp = box('ftyp', text('heic'), u32(0), text('mif1'), text('heic'));
  const pitm = fullBox('pitm', 0, 0, u16(1));
  const iref = fullBox('iref', 0, 0, box('auxl', u16(2), u16(1), u16(1)));
  const auxCDisp = fullBox('auxC', 0, 0, concat(text('urn:mpeg:hevc:2015:auxid:2'), new Uint8Array([0]), seiDisparitySubtype));
  const ipma = fullBox('ipma', 0, 0, u32(1), concat(u16(2), new Uint8Array([1, 1])));
  const heicDisp = concat(ftyp, box('meta', u32(0), pitm, iref, box('iprp', box('ipco', auxCDisp), ipma)));
  assert.equal(readHeic(heicDisp).depthType, 'disparity');

  const heicMetric = makeHeicPortraitDepth({ primaryId: 1, auxId: 2, auxType: 'urn:mpeg:hevc:2015:auxid:2' });
  assert.equal(readHeic(heicMetric).depthType, 'depth');
});

test('parseHEIC validates URL upfront before calling fetch', async () => {
  const OriginalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    return { ok: false, status: 404 };
  };
  try {
    for (const badUrl of [null, undefined, '', '   ', 123]) {
      await assert.rejects(
        () => parseHEIC(badUrl),
        (err) => err instanceof Error && /Invalid or missing URL/i.test(err.message)
      );
    }
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = OriginalFetch;
  }
});

test('Authentic asset: readMpoDisparity extracts disparity map and skips HDR gain map in examples/apple-portrait-mug.jpg', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const assetPath = path.resolve('examples/apple-portrait-mug.jpg');
  assert.ok(fs.existsSync(assetPath), 'examples/apple-portrait-mug.jpg must exist');
  const bytes = new Uint8Array(fs.readFileSync(assetPath));
  const result = readMpoDisparity(bytes);
  assert.ok(result, 'readMpoDisparity must detect Apple Portrait JPEG MPF disparity');
  assert.equal(result.depthType, 'disparity');
  assert.ok(result.primary.length > 1000000, 'Primary JPEG must be > 1MB');
  assert.ok(result.disparity.length > 10000 && result.disparity.length < 100000, 'Must extract the disparity map, not the HDR gain map');
  assert.equal(await describesDepthMap({}, bytes), true, 'describesDepthMap must auto-detect real iPhone Portrait JPEG');
});
