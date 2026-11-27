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

import parseAVIFStereoDefault, {
  parseAVIFStereo,
  readAvif,
  extractAvifItemBytes,
  patchAvifPrimaryItem,
  invertDepthData,
} from '../../parsers/avif-parser/avif-parser.js';

// ============================================================================
// Synthetic ISOBMFF Builders
// ============================================================================

const text = str => new Uint8Array(Array.from(str, c => c.charCodeAt(0)));
const u8 = (...vals) => new Uint8Array(vals);
const u16 = (...vals) => new Uint8Array(vals.flatMap(v => [(v >>> 8) & 255, v & 255]));
const u32 = (...vals) => new Uint8Array(vals.flatMap(v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]));
const concat = (...parts) => new Uint8Array(parts.flatMap(p => Array.from(p instanceof Uint8Array ? p : new Uint8Array(p))));

function box(type, ...contents) {
  const payload = concat(...contents);
  return concat(u32(8 + payload.length), text(type), payload);
}

function fullBox(type, version = 0, flags = 0, ...contents) {
  const vf = u8(version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255);
  return box(type, vf, ...contents);
}

function makeAvifContainer({
  major = 'avif',
  compatible = ['mif1', 'miaf', 'avif'],
  pitmVersion = 0,
  primary = 1,
  ster = null,
  items = [],
  locations = [],
  ilocVersion = 0,
  auxRefs = [],
  cdscRefs = [],
  dimgRefs = [],
  ipcoBoxes = [],
  ipmaEntries = [],
  ipmaVersion = 0,
  ipmaFlags = 0,
  idatPayload = null,
  mdatPayload = u8(0xaa, 0xbb, 0xcc, 0xdd),
} = {}) {
  const ftyp = box('ftyp', text(major), u32(0), ...compatible.map(text));
  const hdlr = fullBox('hdlr', 0, 0, u32(0), text('pict'), u32(0, 0, 0), text('AVIF\0'));
  const pitm = pitmVersion === 0
    ? fullBox('pitm', 0, 0, u16(primary))
    : fullBox('pitm', 1, 0, u32(primary));

  const metaChildren = [hdlr, pitm];

  if (items.length > 0) {
    const infeBoxes = items.map(it => {
      const ver = it.version ?? 2;
      const flags = it.flags ?? (it.hidden ? 1 : 0);
      const nameBytes = concat(text(it.name ?? ''), u8(0));
      if (ver === 3) {
        return fullBox('infe', 3, flags, u32(it.id), u16(0), text(it.type || 'av01'), nameBytes);
      }
      return fullBox('infe', 2, flags, u16(it.id), u16(0), text(it.type || 'av01'), nameBytes);
    });
    const iinfVersion = items.some(it => (it.version ?? 2) === 3) ? 1 : 0;
    const countBytes = iinfVersion === 0 ? u16(infeBoxes.length) : u32(infeBoxes.length);
    metaChildren.push(fullBox('iinf', iinfVersion, 0, countBytes, ...infeBoxes));
  }

  if (locations.length > 0) {
    const offsetSize = 4;
    const lengthSize = 4;
    const baseOffsetSize = 4;
    const indexSize = ilocVersion >= 1 ? 0 : 0;
    const byte4 = (offsetSize << 4) | lengthSize;
    const byte5 = (baseOffsetSize << 4) | indexSize;
    const countBytes = ilocVersion < 2 ? u16(locations.length) : u32(locations.length);
    const locParts = locations.map(loc => {
      const idBytes = ilocVersion < 2 ? u16(loc.id) : u32(loc.id);
      const methodBytes = ilocVersion >= 1 ? u16(loc.constructionMethod ?? 0) : new Uint8Array(0);
      const dataRefBytes = u16(loc.dataRefIndex ?? 0);
      const baseBytes = u32(loc.baseOffset ?? 0);
      const extCountBytes = u16(loc.extents.length);
      const extBytes = concat(...loc.extents.map(ext => concat(u32(ext.offset), u32(ext.length))));
      return concat(idBytes, methodBytes, dataRefBytes, baseBytes, extCountBytes, extBytes);
    });
    metaChildren.push(fullBox('iloc', ilocVersion, 0, u8(byte4, byte5), countBytes, ...locParts));
  }

  if (auxRefs.length > 0 || cdscRefs.length > 0 || dimgRefs.length > 0) {
    const useV1 = [...auxRefs, ...cdscRefs, ...dimgRefs].some(r => r.from > 0xffff || r.to.some(t => t > 0xffff));
    const encId = id => (useV1 ? u32(id) : u16(id));
    const refBoxes = [];
    for (const r of auxRefs) {
      refBoxes.push(box('auxl', encId(r.from), u16(r.to.length), ...r.to.map(encId)));
    }
    for (const r of cdscRefs) {
      refBoxes.push(box('cdsc', encId(r.from), u16(r.to.length), ...r.to.map(encId)));
    }
    for (const r of dimgRefs) {
      refBoxes.push(box('dimg', encId(r.from), u16(r.to.length), ...r.to.map(encId)));
    }
    metaChildren.push(fullBox('iref', useV1 ? 1 : 0, 0, ...refBoxes));
  }

  if (ipcoBoxes.length > 0 || ipmaEntries.length > 0) {
    const ipco = box('ipco', ...ipcoBoxes);
    const entryParts = ipmaEntries.map(e => {
      const idBytes = ipmaVersion === 0 ? u16(e.id) : u32(e.id);
      const propParts = e.props.map(idx => (ipmaFlags & 1 ? u16(idx) : u8(idx)));
      return concat(idBytes, u8(e.props.length), ...propParts);
    });
    const ipma = fullBox('ipma', ipmaVersion, ipmaFlags, u32(ipmaEntries.length), ...entryParts);
    metaChildren.push(box('iprp', ipco, ipma));
  }

  if (ster !== null) {
    const sterBox = box('ster', u32(0, 100, ster.length, ...ster));
    metaChildren.push(box('grpl', sterBox));
  }

  if (idatPayload) {
    metaChildren.push(box('idat', idatPayload));
  }

  const meta = fullBox('meta', 0, 0, ...metaChildren);
  const mdat = box('mdat', mdatPayload);
  return concat(ftyp, meta, mdat);
}

// ============================================================================
// Mock Browser Environment for Decoding Tests
// ============================================================================

function setupMockDOM(imageFactory) {
  const originals = {
    Image: global.Image,
    ImageData: global.ImageData,
    document: global.document,
    window: global.window,
    HTMLElement: global.HTMLElement,
    CSSStyleSheet: global.CSSStyleSheet,
    customElements: global.customElements,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };

  class MockImageData {
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
  }

  const createdBlobs = [];
  const revokedUrls = [];
  let blobCounter = 0;

  URL.createObjectURL = (blob) => {
    const url = `blob:mock/${++blobCounter}`;
    createdBlobs.push({ url, blob });
    return url;
  };
  URL.revokeObjectURL = (url) => {
    revokedUrls.push(url);
  };

  class MockImage {
    constructor() {
      this.width = 4;
      this.height = 2;
      this.onload = null;
      this.onerror = null;
      this._src = '';
      this._fill = [200, 100, 50, 255];
    }
    set src(val) {
      this._src = val;
      if (!val) return;
      if (imageFactory) {
        imageFactory(this, val, createdBlobs);
      }
      setImmediate(() => {
        if (this._src) this.onload?.();
      });
    }
    get src() {
      return this._src;
    }
  }

  global.ImageData = MockImageData;
  global.Image = MockImage;
  global.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') return {};
      const canvas = {
        width: 4,
        height: 2,
        _imageData: null,
        getContext: () => ({
          drawImage: (img) => {
            canvas.width = img.width;
            canvas.height = img.height;
            const data = new Uint8ClampedArray(img.width * img.height * 4);
            const fill = img._fill || [255, 255, 255, 255];
            for (let i = 0; i < data.length; i += 4) {
              data[i] = fill[0];
              data[i + 1] = fill[1];
              data[i + 2] = fill[2];
              data[i + 3] = fill[3];
            }
            canvas._imageData = new MockImageData(data, img.width, img.height);
          },
          getImageData: (x, y, w, h) => {
            if (canvas._imageData) return canvas._imageData;
            return new MockImageData(new Uint8ClampedArray(w * h * 4).fill(255), w, h);
          },
          putImageData: (imageData) => {
            canvas._imageData = imageData;
          },
          clearRect: () => {},
        }),
      };
      return canvas;
    },
  };

  return {
    createdBlobs,
    revokedUrls,
    MockImageData,
    restore: () => {
      global.Image = originals.Image;
      global.ImageData = originals.ImageData;
      global.document = originals.document;
      global.window = originals.window;
      global.HTMLElement = originals.HTMLElement;
      global.CSSStyleSheet = originals.CSSStyleSheet;
      global.customElements = originals.customElements;
      URL.createObjectURL = originals.createObjectURL;
      URL.revokeObjectURL = originals.revokeObjectURL;
    },
  };
}

// ============================================================================
// 1. Exports & Brand Detection (readAvif)
// ============================================================================

test('default export is aliased to parseAVIFStereo', () => {
  assert.equal(parseAVIFStereoDefault, parseAVIFStereo);
});

test('readAvif parses avif, avis, and mif1+avif brand combinations', () => {
  for (const [major, compatible] of [
    ['avif', ['mif1', 'miaf', 'avif']],
    ['avis', ['avif', 'mif1', 'msf1']],
    ['mif1', ['mif1', 'miaf', 'avif']],
    ['miaf', ['miaf', 'avif']],
  ]) {
    const bytes = makeAvifContainer({ major, compatible, primary: 1, ster: [1, 2] });
    const parsed = readAvif(bytes);
    assert.ok(parsed, `Expected readAvif to accept major=${major} compat=${compatible.join(',')}`);
    assert.equal(parsed.primary, 1);
    assert.deepEqual(parsed.stereoPair, [1, 2]);
    assert.equal(parsed.truncated, false);
    assert.equal(parsed.invalidSter, false);
  }
});

test('readAvif accepts brand-neutral mif1+miaf when av1C or av01 is present, and rejects HEIC', () => {
  const av1C = box('av1C', u8(0x81, 0x00, 0x00, 0x00));
  const miafAv1 = makeAvifContainer({
    major: 'mif1',
    compatible: ['mif1', 'miaf'],
    primary: 1,
    ster: [1, 2],
    ipcoBoxes: [av1C],
  });
  const parsed = readAvif(miafAv1);
  assert.ok(parsed);
  assert.deepEqual(parsed.stereoPair, [1, 2]);

  // HEIC brands must be rejected
  assert.equal(readAvif(makeAvifContainer({ major: 'heic', compatible: ['mif1', 'heic'], ster: [1, 2] })), undefined);
  assert.equal(readAvif(makeAvifContainer({ major: 'mif1', compatible: ['mif1', 'heic'], ster: [1, 2] })), undefined);
  assert.equal(readAvif(makeAvifContainer({ major: 'mif1', compatible: ['mif1'], ster: [1, 2] })), undefined);
});

test('readAvif parses pitm v0/v1, non-consecutive ster, and 64-bit box sizes', () => {
  const v0 = makeAvifContainer({ pitmVersion: 0, primary: 7, ster: [8, 7] });
  const r0 = readAvif(v0);
  assert.equal(r0.primary, 7);
  assert.equal(r0.primaryBox.itemIdSize, 2);
  assert.deepEqual(r0.stereoPair, [8, 7]);

  const v1 = makeAvifContainer({ pitmVersion: 1, primary: 0x00010002, ster: [0x00010002, 0x00010003] });
  const r1 = readAvif(v1);
  assert.equal(r1.primary, 0x00010002);
  assert.equal(r1.primaryBox.itemIdSize, 4);
  assert.deepEqual(r1.stereoPair, [0x00010002, 0x00010003]);

  // 64-bit extended size box for ftyp
  const ftypPayload = concat(text('avif'), u32(0), text('mif1'), text('avif'));
  const ftyp64 = concat(
    u32(1), text('ftyp'),
    u32(0, 16 + ftypPayload.length),
    ftypPayload,
  );
  const meta = fullBox('meta', 0, 0, fullBox('pitm', 0, 0, u16(5)), box('grpl', box('ster', u32(0, 1, 2, 5, 42))));
  const r64 = readAvif(concat(ftyp64, meta));
  assert.equal(r64.primary, 5);
  assert.deepEqual(r64.stereoPair, [5, 42]);
});

test('readAvif parses iinf/infe v2/v3, iloc v0/v1/v2, and auxiliary depth/disparity URNs', () => {
  const bytes = makeAvifContainer({
    primary: 1,
    items: [
      { id: 1, type: 'av01', name: 'Primary', hidden: false, version: 2 },
      { id: 2, type: 'av01', name: 'Depth', hidden: true, version: 2 },
      { id: 3, type: 'av01', name: 'Matte', hidden: true, version: 2 },
    ],
    auxRefs: [
      { from: 2, to: [1] },
      { from: 3, to: [1] },
    ],
    ipcoBoxes: [
      fullBox('ispe', 0, 0, u32(320, 240)),
      fullBox('auxC', 0, 0, text('urn:mpeg:mpegB:cicp:systems:auxiliary:depth\0')),
      fullBox('auxC', 0, 0, text('urn:com:apple:photo:2020:aux:portraitmatte\0')),
    ],
    ipmaEntries: [
      { id: 1, props: [1] },
      { id: 2, props: [1, 2] },
      { id: 3, props: [1, 3] },
    ],
  });
  const parsed = readAvif(bytes);
  assert.equal(parsed.depth, 2);
  assert.equal(parsed.depthType, 'depth');
  assert.equal(parsed.items.get(2).hidden, true);
  assert.equal(parsed.items.get(1).hidden, false);
  assert.deepEqual(parsed.dimensions.get(1), { width: 320, height: 240 });

  // Disparity URN with v3 infe and 2-byte ipma flags
  const dispBytes = makeAvifContainer({
    pitmVersion: 1,
    primary: 100,
    items: [
      { id: 100, type: 'av01', name: 'Color', hidden: false, version: 3 },
      { id: 200, type: 'av01', name: 'Disparity', hidden: true, version: 3 },
    ],
    auxRefs: [{ from: 200, to: [100] }],
    ipcoBoxes: [
      fullBox('auxC', 0, 0, text('urn:com:apple:photo:2018:aux:disparity\0')),
    ],
    ipmaVersion: 1,
    ipmaFlags: 1,
    ipmaEntries: [{ id: 200, props: [1] }],
  });
  const dispParsed = readAvif(dispBytes);
  assert.equal(dispParsed.depth, 200);
  assert.equal(dispParsed.depthType, 'disparity');
  assert.equal(dispParsed.items.get(200).type, 'av01');
  assert.equal(dispParsed.items.get(200).name, 'Disparity');
});

test('readAvif rejects non-AVIF inputs and flags truncated or invalid ster containers', () => {
  assert.equal(readAvif(null), undefined);
  assert.equal(readAvif(new Uint8Array(0)), undefined);
  assert.equal(readAvif(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16])), undefined);
  // Malformed ftyp (12 bytes, missing minor version)
  assert.equal(readAvif(concat(u32(12), text('ftyp'), text('avif'))), undefined);
  // Unaligned compatible brand bytes
  assert.equal(readAvif(concat(u32(18), text('ftyp'), text('avif'), u32(0), u8(1, 2))), undefined);

  // Truncated ster box
  const full = makeAvifContainer({ ster: [1, 2] });
  const sterPos = Buffer.from(full).indexOf('ster');
  const trunc = readAvif(full.subarray(0, sterPos + 4));
  assert.equal(trunc.truncated, true);

  // Single entity in ster
  const single = readAvif(makeAvifContainer({ ster: [1] }));
  assert.equal(single.stereoPair, undefined);
  assert.equal(single.invalidSter, true);

  // Empty ster
  const empty = readAvif(makeAvifContainer({ ster: [] }));
  assert.equal(empty.stereoPair, undefined);
  assert.equal(empty.invalidSter, true);
});

// ============================================================================
// 2. extractAvifItemBytes & patchAvifPrimaryItem
// ============================================================================

test('extractAvifItemBytes resolves multi-extent file_offset and idat_offset iloc entries', () => {
  const payloadA = text('LEFT_PART_1_');
  const payloadB = text('LEFT_PART_2');
  const idatData = text('0123456789IDAT_ITEM');
  const mdatPayload = concat(payloadA, text('PADDING'), payloadB);

  // Build container once to measure mdat offset
  const template = makeAvifContainer({
    primary: 1,
    locations: [
      { id: 1, constructionMethod: 0, baseOffset: 0, extents: [{ offset: 0, length: payloadA.length }, { offset: 0, length: payloadB.length }] },
      { id: 2, constructionMethod: 1, baseOffset: 10, extents: [{ offset: 0, length: 9 }] },
    ],
    ilocVersion: 1,
    idatPayload: idatData,
    mdatPayload,
  });
  const mdatStart = Buffer.from(template).indexOf('mdat') + 4;

  const bytes = makeAvifContainer({
    primary: 1,
    locations: [
      {
        id: 1,
        constructionMethod: 0,
        baseOffset: mdatStart,
        extents: [
          { offset: 0, length: payloadA.length },
          { offset: payloadA.length + 7, length: payloadB.length },
        ],
      },
      {
        id: 2,
        constructionMethod: 1,
        baseOffset: 10,
        extents: [{ offset: 0, length: 9 }],
      },
    ],
    ilocVersion: 1,
    idatPayload: idatData,
    mdatPayload,
  });

  // 2-arg and 3-arg signatures
  const item1 = extractAvifItemBytes(bytes, 1);
  assert.equal(Buffer.from(item1).toString('utf8'), 'LEFT_PART_1_LEFT_PART_2');

  const structure = readAvif(bytes);
  const item2 = extractAvifItemBytes(bytes, structure, 2);
  assert.equal(Buffer.from(item2).toString('utf8'), 'IDAT_ITEM');

  assert.throws(() => extractAvifItemBytes(bytes, structure, 999), /no iloc entry/);
});

test('patchAvifPrimaryItem rewrites pitm and clears infe hidden flag without mutating input', () => {
  const original = makeAvifContainer({
    primary: 1,
    ster: [1, 2],
    items: [
      { id: 1, type: 'av01', name: 'Left', hidden: false },
      { id: 2, type: 'av01', name: 'Right', hidden: true },
    ],
  });
  const snapshot = new Uint8Array(original);

  const patched = patchAvifPrimaryItem(original, 2);
  // Original untouched
  assert.deepEqual(original, snapshot);
  // Same byte length (in-place patch preserves iloc file_offsets)
  assert.equal(patched.length, original.length);

  const patchedStructure = readAvif(patched);
  assert.equal(patchedStructure.primary, 2);
  assert.equal(patchedStructure.items.get(2).hidden, false);
  assert.equal(patchedStructure.items.get(1).hidden, false);

  // Rejects > 16-bit target on pitm v0
  assert.throws(() => patchAvifPrimaryItem(original, 70000), /exceeds 16-bit pitm/);

  // Works on pitm v1 with 32-bit IDs
  const v1 = makeAvifContainer({
    pitmVersion: 1,
    primary: 10,
    ster: [10, 70000],
    items: [{ id: 70000, type: 'av01', version: 3, hidden: true }],
  });
  const v1Patched = patchAvifPrimaryItem(v1, 70000);
  const v1Struct = readAvif(v1Patched);
  assert.equal(v1Struct.primary, 70000);
  assert.equal(v1Struct.items.get(70000).hidden, false);
});

// ============================================================================
// 3. parseAVIFStereo Behavior, Eye Assignment, Depth Inversion, Angles, Abort
// ============================================================================

test('parseAVIFStereo decodes left primary directly and patches pitm + clears hidden flag for right eye', async () => {
  const bytes = makeAvifContainer({
    primary: 1,
    ster: [1, 2],
    items: [
      { id: 1, type: 'av01', hidden: false },
      { id: 2, type: 'av01', hidden: true },
    ],
  });
  const dataUrl = 'data:image/avif;base64,' + Buffer.from(bytes).toString('base64');

  const dom = setupMockDOM(async (img, src, blobs) => {
    if (src.startsWith('data:')) {
      img._fill = [10, 20, 30, 255]; // Left eye
    } else {
      const entry = blobs.find(b => b.url === src);
      const buf = new Uint8Array(await entry.blob.arrayBuffer());
      const struct = readAvif(buf);
      assert.equal(struct.primary, 2);
      assert.equal(struct.items.get(2).hidden, false);
      img._fill = [40, 50, 60, 255]; // Right eye
    }
  });

  try {
    const result = await parseAVIFStereo(dataUrl);
    assert.equal(result.leftEye.data[0], 10);
    assert.equal(result.rightEye.data[0], 40);
    assert.equal(dom.createdBlobs.length, 1);
    assert.deepEqual(dom.revokedUrls, [dom.createdBlobs[0].url]);
    assert.ok(result.phiLength > 0);
    assert.ok(result.thetaLength > 0);
    assert.ok(Math.abs(result.thetaStart - (Math.PI / 2 - result.thetaLength / 2)) < 1e-6);
  } finally {
    dom.restore();
  }
});

test('parseAVIFStereo handles ster when primary is the right eye (e.g. ster=[8, 7], primary=7)', async () => {
  const bytes = makeAvifContainer({
    primary: 7,
    ster: [8, 7],
  });
  const dataUrl = 'data:image/avif;base64,' + Buffer.from(bytes).toString('base64');

  const dom = setupMockDOM((img, src) => {
    // blob url for left (id 8), dataUrl for right (id 7)
    img._fill = src.startsWith('blob:') ? [11, 22, 33, 255] : [77, 88, 99, 255];
  });

  try {
    const result = await parseAVIFStereo(dataUrl);
    assert.equal(result.leftEye.data[0], 11);
    assert.equal(result.rightEye.data[0], 77);
    assert.equal(dom.createdBlobs.length, 1);
    assert.equal(dom.revokedUrls.length, 1);
  } finally {
    dom.restore();
  }
});

test('parseAVIFStereo supports auxiliary metric depth (un-inverted) and disparity (inverted)', async () => {
  const metricBytes = makeAvifContainer({
    primary: 1,
    items: [
      { id: 1, type: 'av01', hidden: false },
      { id: 2, type: 'av01', hidden: true },
    ],
    auxRefs: [{ from: 2, to: [1] }],
    ipcoBoxes: [fullBox('auxC', 0, 0, text('urn:mpeg:mpegB:cicp:systems:auxiliary:depth\0'))],
    ipmaEntries: [{ id: 2, props: [1] }],
  });

  const disparityBytes = makeAvifContainer({
    primary: 1,
    items: [
      { id: 1, type: 'av01', hidden: false },
      { id: 2, type: 'av01', hidden: true },
    ],
    auxRefs: [{ from: 2, to: [1] }],
    ipcoBoxes: [fullBox('auxC', 0, 0, text('urn:com:apple:photo:2018:aux:disparity\0'))],
    ipmaEntries: [{ id: 2, props: [1] }],
  });

  const dom = setupMockDOM((img, src) => {
    img._fill = src.startsWith('blob:') ? [60, 60, 60, 255] : [120, 120, 120, 255];
  });

  try {
    const metricResult = await parseAVIFStereo('data:image/avif;base64,AA', { bytes: metricBytes });
    assert.equal(metricResult.leftEye, metricResult.rightEye);
    assert.ok(metricResult.depth);
    // Metric depth preserved: 60
    assert.equal(metricResult.depth._imageData.data[0], 60);

    const dispResult = await parseAVIFStereo('data:image/avif;base64,AA', { bytes: disparityBytes });
    assert.ok(dispResult.depth);
    // Disparity inverted: 255 - 60 = 195, alpha preserved = 255
    assert.equal(dispResult.depth._imageData.data[0], 195);
    assert.equal(dispResult.depth._imageData.data[3], 255);
  } finally {
    dom.restore();
  }
});

test('invertDepthData inverts RGB channels and preserves alpha', () => {
  const imgData = { width: 1, height: 1, data: new Uint8ClampedArray([0, 100, 255, 128]) };
  invertDepthData(imgData);
  assert.deepEqual(Array.from(imgData.data), [255, 155, 0, 128]);
});

test('parseAVIFStereo honors angle and fisheye projection options', async () => {
  const bytes = makeAvifContainer({ primary: 1, ster: [1, 2] });
  const dom = setupMockDOM();
  try {
    const fisheye = await parseAVIFStereo('data:image/avif;base64,AA', { bytes, projection: 'fisheye' });
    assert.equal(fisheye.projection, 'fisheye');
    assert.ok(Math.abs(fisheye.phiLength - Math.PI) < 1e-6);

    const angle90 = await parseAVIFStereo('data:image/avif;base64,AA', { bytes, angle: 90 });
    assert.equal(angle90.projection, undefined);
    assert.ok(Math.abs(angle90.phiLength - Math.PI / 2) < 1e-6);
  } finally {
    dom.restore();
  }
});

test('parseAVIFStereo rejects invalid/mono/truncated inputs and aborts cleanly', async () => {
  const dom = setupMockDOM();
  try {
    await assert.rejects(() => parseAVIFStereo('data:image/avif;base64,AA', {
      bytes: makeAvifContainer({ primary: 1, ster: null }),
    }), /stereo pair|depth map/);

    await assert.rejects(() => parseAVIFStereo('data:image/avif;base64,AA', {
      bytes: makeAvifContainer({ primary: 1, ster: [1] }),
    }), /Invalid AVIF stereo group \(ster\)/);

    // Truncated container with valid ster [1, 2] must reject (kills mutation M4)
    const validForTrunc = makeAvifContainer({
      primary: 1,
      ster: [1, 2],
      mdatPayload: u8(1, 2, 3, 4, 5, 6, 7, 8),
    });
    const truncatedMdat = validForTrunc.subarray(0, validForTrunc.length - 2);
    assert.deepEqual(readAvif(truncatedMdat).stereoPair, [1, 2]);
    assert.equal(readAvif(truncatedMdat).truncated, true);
    await assert.rejects(() => parseAVIFStereo('data:image/avif;base64,AA', {
      bytes: truncatedMdat,
    }), /Truncated AVIF container/);

    await assert.rejects(() => parseAVIFStereo('data:image/avif;base64,AA', {
      bytes: concat(u32(12), text('ftyp'), text('bad!')),
    }), /Not an AVIF file/);

    const valid = makeAvifContainer({ primary: 1, ster: [1, 2] });
    await assert.rejects(
      () => parseAVIFStereo('data:image/avif;base64,AA', { bytes: valid, signal: AbortSignal.abort() }),
      err => err.name === 'AbortError',
    );

    // Abort mid-decode revokes created Blob URL
    const controller = new AbortController();
    const pending = parseAVIFStereo('data:image/avif;base64,AA', { bytes: valid, signal: controller.signal });
    setTimeout(() => controller.abort(), 0);
    await assert.rejects(() => pending, err => err.name === 'AbortError');
  } finally {
    dom.restore();
  }
});

// ============================================================================
// 4. stereo-img.js Routing & Brand Ordering
// ============================================================================

test('stereo-img.js routes explicit type="avif", type="avif-spatial", and auto-detects mif1+avif before HEIC', async () => {
  const dom = setupMockDOM();
  global.HTMLElement = class {
    constructor() {
      this._attrs = new Map();
      this.shadowRoot = { adoptedStyleSheets: [] };
    }
    attachShadow() { return this.shadowRoot; }
    getAttribute(k) { return this._attrs.get(k) ?? null; }
  };
  global.CSSStyleSheet = class { replaceSync() {} };
  global.window = global;
  global.customElements = { define: () => {} };

  const { isAvif, StereoImg } = await import('../../stereo-img.js');

  try {
    const mif1AvifStereo = makeAvifContainer({
      major: 'mif1',
      compatible: ['mif1', 'miaf', 'avif'],
      primary: 1,
      ster: [1, 2],
    });
    const mif1AvifMono = makeAvifContainer({
      major: 'mif1',
      compatible: ['mif1', 'miaf', 'avif'],
      primary: 1,
      ster: null,
    });
    const heicBytes = makeAvifContainer({
      major: 'heic',
      compatible: ['mif1', 'heic'],
      primary: 1,
      ster: [1, 2],
    });

    assert.equal(isAvif(mif1AvifStereo), true);
    assert.equal(isAvif(makeAvifContainer({ major: 'avis', compatible: ['avis', 'avif'] })), true);
    assert.equal(isAvif(heicBytes), false);
    assert.equal(isAvif(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), false);

    const el = new StereoImg();
    el._isStereo = async () => false;

    const makePicture = (bytes, url = 'https://example.com/photo.avif') => ({
      url,
      objectURL: async () => 'data:image/avif;base64,' + Buffer.from(bytes).toString('base64'),
      bytes: async () => bytes,
    });

    // Auto-detect mif1+avif+ster -> parseAVIFStereo (never misrouted to libheif)
    const autoStereo = await el._parsePicture(makePicture(mif1AvifStereo), null, {});
    assert.ok(autoStereo.leftEye);
    assert.ok(autoStereo.rightEye);

    // Explicit type="avif" and type="avif-spatial"
    const explicitAvif = await el._parsePicture(makePicture(mif1AvifStereo), null, { type: 'avif' });
    assert.ok(explicitAvif.leftEye);
    const explicitSpatial = await el._parsePicture(makePicture(mif1AvifStereo), null, { type: 'avif-spatial' });
    assert.ok(explicitSpatial.leftEye);

    // Mono mif1+avif falls through to parseMono without throwing in libheif
    const monoRes = await el._parsePicture(makePicture(mif1AvifMono), null, {});
    assert.ok(monoRes.leftEye);
    assert.equal(monoRes.leftEye, monoRes.rightEye);

    // Oversized/truncated ftyp and unaligned ftyp must be rejected by isAvif
    const oversizedFtyp = concat(u32(1000), text('ftyp'), text('avif'), u32(0), text('mif1'));
    assert.equal(isAvif(oversizedFtyp), false);
    assert.equal(readAvif(oversizedFtyp), undefined);
    const unalignedFtyp = concat(u32(18), text('ftyp'), text('avif'), u32(0), u8(1, 2));
    assert.equal(isAvif(unalignedFtyp), false);

    // Brand-neutral mif1+miaf+av1C routes to parseAVIFStereo without libheif
    const brandNeutralAv1 = makeAvifContainer({
      major: 'mif1',
      compatible: ['mif1', 'miaf'],
      primary: 1,
      ster: [1, 2],
      ipcoBoxes: [box('av1C', u8(0x81, 0x00, 0x00, 0x00))],
    });
    const brandNeutralRes = await el._parsePicture(makePicture(brandNeutralAv1), null, {});
    assert.ok(brandNeutralRes.leftEye);
    assert.ok(brandNeutralRes.rightEye);
  } finally {
    dom.restore();
  }
});

// ============================================================================
// 5. Security, Entity Validation, and Robustness Edge Cases
// ============================================================================

test('readAvif, patchAvifPrimaryItem, and parseAVIFStereo reject invalid ster entity IDs and missing iinf items', async () => {
  const dom = setupMockDOM();
  try {
    // 3+ entities in ster
    const threeEntities = makeAvifContainer({ primary: 1, ster: [1, 2, 3] });
    const parsedThree = readAvif(threeEntities);
    assert.equal(parsedThree.invalidSter, true);
    assert.equal(parsedThree.stereoPair, undefined);
    await assert.rejects(() => parseAVIFStereo('data:image/avif;base64,AA', { bytes: threeEntities }), /Invalid AVIF stereo group/);

    // Entity ID 0 in ster
    const zeroLeft = makeAvifContainer({ primary: 1, ster: [0, 1] });
    assert.equal(readAvif(zeroLeft).invalidSter, true);
    assert.equal(readAvif(zeroLeft).stereoPair, undefined);
    await assert.rejects(() => parseAVIFStereo('data:image/avif;base64,AA', { bytes: zeroLeft }), /Invalid AVIF stereo group/);

    const zeroRight = makeAvifContainer({ primary: 1, ster: [1, 0] });
    assert.equal(readAvif(zeroRight).invalidSter, true);
    await assert.rejects(() => parseAVIFStereo('data:image/avif;base64,AA', { bytes: zeroRight }), /Invalid AVIF stereo group/);

    // Duplicate entity ID [1, 1]
    const dupIds = makeAvifContainer({ primary: 1, ster: [1, 1] });
    assert.equal(readAvif(dupIds).invalidSter, true);
    assert.equal(readAvif(dupIds).stereoPair, undefined);
    await assert.rejects(() => parseAVIFStereo('data:image/avif;base64,AA', { bytes: dupIds }), /Invalid AVIF stereo group/);

    // Non-existent item ID in ster when iinf is present
    const missingSterItem = makeAvifContainer({
      primary: 1,
      ster: [1, 999],
      items: [
        { id: 1, type: 'av01', hidden: false },
        { id: 2, type: 'av01', hidden: true },
      ],
    });
    await assert.rejects(
      () => parseAVIFStereo('data:image/avif;base64,AA', { bytes: missingSterItem }),
      /do not exist in iinf/,
    );
    assert.throws(() => patchAvifPrimaryItem(missingSterItem, 0), /Invalid target item ID/);
    assert.throws(() => patchAvifPrimaryItem(missingSterItem, 999), /does not exist in AVIF iinf/);

    // Non-existent depth item ID when iinf is present
    const missingDepthItem = makeAvifContainer({
      primary: 1,
      items: [
        { id: 1, type: 'av01', hidden: false },
        { id: 2, type: 'av01', hidden: false },
      ],
      auxRefs: [{ from: 999, to: [1] }],
      ipcoBoxes: [fullBox('auxC', 0, 0, text('urn:mpeg:mpegB:cicp:systems:auxiliary:depth\0'))],
      ipmaEntries: [{ id: 999, props: [1] }],
    });
    await assert.rejects(
      () => parseAVIFStereo('data:image/avif;base64,AA', { bytes: missingDepthItem }),
      /does not exist in iinf/,
    );
  } finally {
    dom.restore();
  }
});

test('readAvif mitigates iloc 0-byte-extent DoS without stalling or OOM', async () => {
  // Craft iloc v0 with offsetSize=0, lengthSize=0, baseOffsetSize=0, itemCount=200, extentCount=65535
  const entries = [];
  for (let i = 1; i <= 200; i++) {
    entries.push(u16(i, 0, 65535));
  }
  const evilIloc = fullBox('iloc', 0, 0, u8(0x00, 0x00), u16(200), ...entries);
  const ftyp = box('ftyp', text('avif'), u32(0), text('mif1'), text('avif'));
  const pitm = fullBox('pitm', 0, 0, u16(1));
  const sterBox = box('ster', u32(0, 100, 2, 1, 2));
  const meta = fullBox('meta', 0, 0, pitm, box('grpl', sterBox), evilIloc);
  const evilBytes = concat(ftyp, meta);

  const startMs = performance.now();
  const parsed = readAvif(evilBytes);
  const elapsedMs = performance.now() - startMs;

  assert.ok(parsed);
  assert.equal(parsed.truncated, true);
  assert.ok(elapsedMs < 50, `Expected fast abort on 0-byte-extent DoS, took ${elapsedMs}ms`);

  const dom = setupMockDOM();
  try {
    await assert.rejects(
      () => parseAVIFStereo('data:image/avif;base64,AA', { bytes: evilBytes }),
      /Truncated AVIF container/,
    );
  } finally {
    dom.restore();
  }

  // Single 0-byte extent (offsetSize=0, lengthSize=0, extentCount=1) remains valid
  const singleExtentIloc = fullBox('iloc', 0, 0, u8(0x00, 0x00), u16(1), u16(1, 0, 1));
  const okMeta = fullBox('meta', 0, 0, pitm, box('grpl', sterBox), singleExtentIloc);
  const okParsed = readAvif(concat(ftyp, okMeta));
  assert.equal(okParsed.truncated, false);
  assert.equal(okParsed.locations.get(1).extents.length, 1);
});

test('readAvif excludes primary and stereo eye IDs from self-referential or eye-colliding auxiliary depth', () => {
  // Self-referential auxl 1->1 with auxC on item 1 (via ipma)
  const selfRefIpma = makeAvifContainer({
    primary: 1,
    items: [{ id: 1, type: 'av01', hidden: false }],
    auxRefs: [{ from: 1, to: [1] }],
    ipcoBoxes: [fullBox('auxC', 0, 0, text('urn:mpeg:mpegB:cicp:systems:auxiliary:depth\0'))],
    ipmaEntries: [{ id: 1, props: [1] }],
  });
  assert.equal(readAvif(selfRefIpma).depth, undefined);

  // Self-referential auxl 1->1 in ipco-only fallback (no ipma entries)
  const selfRefFallback = makeAvifContainer({
    primary: 1,
    items: [{ id: 1, type: 'av01', hidden: false }],
    auxRefs: [{ from: 1, to: [1] }],
    ipcoBoxes: [fullBox('auxC', 0, 0, text('urn:mpeg:mpegB:cicp:systems:auxiliary:depth\0'))],
  });
  assert.equal(readAvif(selfRefFallback).depth, undefined);

  // Stereo eye 2 colliding with auxl 2->1
  const eyeCollision = makeAvifContainer({
    primary: 1,
    ster: [1, 2],
    items: [
      { id: 1, type: 'av01', hidden: false },
      { id: 2, type: 'av01', hidden: true },
    ],
    auxRefs: [{ from: 2, to: [1] }],
    ipcoBoxes: [fullBox('auxC', 0, 0, text('urn:com:apple:photo:2018:aux:disparity\0'))],
    ipmaEntries: [{ id: 2, props: [1] }],
  });
  assert.equal(readAvif(eyeCollision).depth, undefined);
});

test('parseAVIFStereo rejects 0x0 decoded image dimensions and attaches onload/onerror before setting src', async () => {
  const bytes = makeAvifContainer({ primary: 1, ster: [1, 2] });

  // 0x0 decoded image dimensions must throw rather than producing NaN angles
  const zeroDom = setupMockDOM((img) => {
    img.width = 0;
    img.height = 0;
  });
  try {
    await assert.rejects(
      () => parseAVIFStereo('data:image/avif;base64,AA', { bytes }),
      /invalid dimensions/i,
    );
  } finally {
    zeroDom.restore();
  }

  // Verify onload is already attached when image.src is assigned (handles synchronous onload)
  const syncDom = setupMockDOM();
  const OrigImage = global.Image;
  let hadHandlersBeforeSrc = true;
  global.Image = class extends OrigImage {
    set src(val) {
      if (val) {
        if (typeof this.onload !== 'function' || typeof this.onerror !== 'function') {
          hadHandlersBeforeSrc = false;
        }
        this._src = val;
        this.onload?.();
        return;
      }
      this._src = val;
    }
  };
  try {
    const res = await parseAVIFStereo('data:image/avif;base64,AA', { bytes });
    assert.equal(hadHandlersBeforeSrc, true);
    assert.ok(Number.isFinite(res.phiLength));
    assert.ok(Number.isFinite(res.thetaStart));
    assert.ok(Number.isFinite(res.thetaLength));
  } finally {
    syncDom.restore();
  }
});

test('parseAVIFStereo validates URL upfront and normalizes non-Error image.onerror events', async () => {
  const savedFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    return { ok: false, status: 404 };
  };
  try {
    for (const badUrl of [null, undefined, '', '   ', 123]) {
      await assert.rejects(
        () => parseAVIFStereo(badUrl),
        (err) => err instanceof Error && /Invalid or missing URL/i.test(err.message)
      );
    }
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = savedFetch;
  }

  const dom = setupMockDOM();
  global.Image = class EventErrorImage {
    set src(val) {
      if (val) {
        setImmediate(() => this.onerror?.({ type: 'error' }));
      }
    }
  };
  try {
    const bytes = makeAvifContainer({ primary: 1, ster: [1, 2] });
    await assert.rejects(
      () => parseAVIFStereo('data:image/avif;base64,AA', { bytes }),
      (err) => err instanceof Error && /Failed to load image/i.test(err.message)
    );
  } finally {
    dom.restore();
  }
});
