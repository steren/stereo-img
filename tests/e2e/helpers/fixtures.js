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

/**
 * Standard IEEE 802.3 32-bit Cyclic Redundancy Check (CRC-32) implementation.
 * Used for verifying and constructing PNG chunks.
 *
 * @param {Uint8Array|Buffer} buffer
 * @returns {number} Unsigned 32-bit CRC
 */
export function crc32(buffer) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Helper to encode unsigned 32-bit integers in big endian.
 */
export const u32 = (...values) =>
  new Uint8Array(values.flatMap(v => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]));

/**
 * Helper to encode unsigned 16-bit integers in big endian.
 */
export const u16 = (...values) =>
  new Uint8Array(values.flatMap(v => [(v >>> 8) & 255, v & 255]));

/**
 * Helper to encode unsigned 16-bit integers in little endian.
 */
export const u16le = (...values) =>
  new Uint8Array(values.flatMap(v => [v & 255, (v >>> 8) & 255]));

/**
 * Helper to encode ASCII string bytes.
 */
export const text = (str) =>
  new Uint8Array(Array.from(str, c => c.charCodeAt(0)));

/**
 * Concatenate multiple byte arrays into a single Uint8Array.
 */
export const concat = (...parts) =>
  new Uint8Array(parts.flatMap(p => Array.from(p instanceof Uint8Array ? p : new Uint8Array(p))));

/**
 * Construct an ISOBMFF / MP4 box: [4-byte size][4-byte type][payload].
 *
 * @param {string} type - 4-character box type
 * @param {...(Uint8Array|Array<number>)} contents - box payload
 * @returns {Uint8Array}
 */
export function box(type, ...contents) {
  const payload = concat(...contents);
  const size = 8 + payload.length;
  return concat(u32(size), text(type), payload);
}

/**
 * Construct an ISOBMFF FullBox: [4-byte size][4-byte type][1-byte version][3-byte flags][payload].
 *
 * @param {string} type - 4-character box type
 * @param {number} version - box version (usually 0)
 * @param {number} flags - 24-bit flags (usually 0)
 * @param {...(Uint8Array|Array<number>)} contents - box payload
 * @returns {Uint8Array}
 */
export function fullBox(type, version = 0, flags = 0, ...contents) {
  const versionFlags = new Uint8Array([version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]);
  return box(type, versionFlags, ...contents);
}

/**
 * Construct a minimal JPEG binary buffer.
 *
 * @param {Array<number>|Uint8Array} [payload] - Optional middle payload bytes
 * @returns {Uint8Array}
 */
export function createMinimalJPEG(payload = [0x00]) {
  const start = [0xff, 0xd8]; // SOI
  const end = [0xff, 0xd9];   // EOI
  return new Uint8Array([...start, ...payload, ...end]);
}

/**
 * Construct a well-formed JPEG Stereoscopic (JPS) file buffer.
 *
 * Specification:
 * - SOI: 0xFF, 0xD8
 * - APP3: 0xFF, 0xE3
 * - Length: 2 bytes
 * - Identifier: "_JPSJPS_\0" (8 bytes)
 * - Header length: 2 bytes (0x00, 0x02 or 0x00, 0x04)
 * - Descriptor:
 *     layout format (1 byte): 1=interleaved, 2=side-by-side, 3=top-bottom, 4=anaglyph
 *     flags (1 byte): bit 0=half-height, bit 1=half-width, bit 2=left-field-first (1=left-right, 0=right-left)
 * - Remainder of JPEG payload & EOI
 *
 * @param {Object} [options]
 * @param {string|number} [options.layout='side-by-side'] - 'interleaved', 'side-by-side', 'top-bottom', 'anaglyph' or 1..4
 * @param {boolean} [options.halfWidth=false] - Whether half-width flag is set
 * @param {boolean} [options.halfHeight=false] - Whether half-height flag is set
 * @param {string|number} [options.eyeOrder='left-right'] - 'left-right' (1) or 'right-left' (0)
 * @param {boolean} [options.omitMarker=false] - If true, omit APP3 to test filename fallback
 * @param {Uint8Array} [options.extraPayload] - Additional payload before EOI
 * @returns {{ bytes: Uint8Array, buffer: Buffer, dataUrl: string }}
 */
export function createJPS(options = {}) {
  const {
    layout = 'side-by-side',
    halfWidth = false,
    halfHeight = false,
    eyeOrder = 'left-right',
    omitMarker = false,
    extraPayload = new Uint8Array([0xff, 0xdb, 0x00, 0x03, 0x00]),
  } = options;

  let layoutCode = 2; // Default side-by-side
  if (typeof layout === 'number') {
    layoutCode = layout;
  } else if (layout === 'interleaved') {
    layoutCode = 1;
  } else if (layout === 'side-by-side') {
    layoutCode = 2;
  } else if (layout === 'top-bottom' || layout === 'over-under') {
    layoutCode = 3;
  } else if (layout === 'anaglyph') {
    layoutCode = 4;
  }

  let flags = 0;
  if (halfHeight) flags |= 0x01;
  if (halfWidth) flags |= 0x02;
  if (eyeOrder === 'left-right' || eyeOrder === 1) flags |= 0x04;

  const soi = new Uint8Array([0xff, 0xd8]);
  const eoi = new Uint8Array([0xff, 0xd9]);

  if (omitMarker) {
    const bytes = concat(soi, extraPayload, eoi);
    return {
      bytes,
      buffer: Buffer.from(bytes),
      dataUrl: 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64'),
    };
  }

  // Identifier: '_JPSJPS_\0'
  const identifier = text('_JPSJPS_\0');
  const descriptorHeaderLen = u16(2); // 2 bytes of descriptor follow
  const descriptor = new Uint8Array([layoutCode, flags]);

  // Total APP3 marker content length = 2 (length field itself) + identifier + 2 + descriptor
  const app3Length = 2 + identifier.length + descriptorHeaderLen.length + descriptor.length;
  const app3Header = new Uint8Array([0xff, 0xe3, (app3Length >>> 8) & 255, app3Length & 255]);

  const app3 = concat(app3Header, identifier, descriptorHeaderLen, descriptor);
  const bytes = concat(soi, app3, extraPayload, eoi);

  return {
    bytes,
    buffer: Buffer.from(bytes),
    dataUrl: 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64'),
  };
}

/**
 * Construct a well-formed PNG Stereoscopic (sTER chunk / PNS) buffer.
 *
 * PNG specification:
 * - Signature: 89 50 4E 47 0D 0A 1A 0A
 * - IHDR chunk: 13 bytes data + 4 bytes CRC
 * - sTER chunk: 1 byte data (mode: 0 = cross-fuse / right-left, 1 = diverging-fuse / left-right) + 4 bytes CRC
 * - IDAT chunk
 * - IEND chunk
 *
 * @param {Object} [options]
 * @param {number} [options.mode=1] - 0 (cross-fuse / right-left) or 1 (diverging-fuse / left-right)
 * @param {number} [options.width=100]
 * @param {number} [options.height=50]
 * @param {boolean} [options.omitSter=false] - If true, omit sTER chunk to test .pns filename fallback
 * @returns {{ bytes: Uint8Array, buffer: Buffer, dataUrl: string }}
 */
export function createPNGStereo(options = {}) {
  const {
    mode = 1,
    width = 100,
    height = 50,
    omitSter = false,
  } = options;

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: width(4), height(4), bitDepth(1)=8, colorType(1)=2 (RGB), compression(1)=0, filter(1)=0, interlace(1)=0
  const ihdrData = concat(u32(width, height), new Uint8Array([8, 2, 0, 0, 0]));
  const ihdrTypeAndData = concat(text('IHDR'), ihdrData);
  const ihdrCrc = crc32(ihdrTypeAndData);
  const ihdrChunk = concat(u32(13), ihdrTypeAndData, u32(ihdrCrc));

  // sTER chunk: length 1, mode byte (0 = cross-fuse, 1 = diverging-fuse, or arbitrary byte for boundary tests)
  let sterChunk = new Uint8Array(0);
  if (!omitSter) {
    const sterData = new Uint8Array([mode & 0xff]);
    const sterTypeAndData = concat(text('sTER'), sterData);
    const sterCrc = crc32(sterTypeAndData);
    sterChunk = concat(u32(1), sterTypeAndData, u32(sterCrc));
  }

  // Minimal IDAT chunk: uncompressed / empty zlib block
  const idatData = new Uint8Array([0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01]);
  const idatTypeAndData = concat(text('IDAT'), idatData);
  const idatCrc = crc32(idatTypeAndData);
  const idatChunk = concat(u32(idatData.length), idatTypeAndData, u32(idatCrc));

  // IEND chunk: length 0
  const iendType = text('IEND');
  const iendCrc = crc32(iendType);
  const iendChunk = concat(u32(0), iendType, u32(iendCrc));

  const bytes = concat(signature, ihdrChunk, sterChunk, idatChunk, iendChunk);

  return {
    bytes,
    buffer: Buffer.from(bytes),
    dataUrl: 'data:image/png;base64,' + Buffer.from(bytes).toString('base64'),
  };
}

/**
 * Construct an ISOBMFF HEIC container with Apple Portrait auxC disparity/depth property and auxl item reference.
 *
 * @param {Object} [options]
 * @param {string} [options.auxType='urn:apple:photo:2018:aux:disparity']
 * @param {number} [options.primaryItemId=1]
 * @param {number} [options.depthItemId=2]
 * @param {number} [options.width=100]
 * @param {number} [options.height=100]
 * @returns {{ bytes: Uint8Array, buffer: Buffer, dataUrl: string }}
 */
export function createHEICDepth(options = {}) {
  const {
    auxType = 'urn:apple:photo:2018:aux:disparity',
    primaryItemId = 1,
    depthItemId = 2,
    width = 100,
    height = 100,
  } = options;

  // ftyp box: brand 'heic', minor 0, compatible brands 'mif1', 'heic'
  const ftyp = box('ftyp', text('heic'), u32(0), text('mif1'), text('heic'));

  // pitm: primary item ID
  const pitm = fullBox('pitm', 0, 0, u16(primaryItemId));

  // hdlr: handler pict
  const hdlr = fullBox('hdlr', 0, 0, u32(0), text('pict'), u32(0, 0, 0), text('Apple Photo\0'));

  // iinf: item info box with infe entries
  const infePrimary = fullBox('infe', 2, 0, u16(primaryItemId), u16(0), text('hvc1'), text('Primary\0'));
  const infeDepth = fullBox('infe', 2, 0, u16(depthItemId), u16(0), text('hvc1'), text('Depth\0'));
  const iinf = fullBox('iinf', 0, 0, u16(2), infePrimary, infeDepth);

  // iref: item reference box with auxl (auxiliary reference from depth to primary)
  const auxlRef = box('auxl', u16(depthItemId), u16(1), u16(primaryItemId));
  const iref = fullBox('iref', 0, 0, auxlRef);

  // iprp: item properties
  // ispe: image spatial extents
  const ispe = fullBox('ispe', 0, 0, u32(width, height));
  // auxC: auxiliary type property with null-terminated urn string
  const auxC = fullBox('auxC', 0, 0, text(auxType + '\0'));

  const ipco = box('ipco', ispe, auxC);
  // ipma: associations: item 1 -> prop 1 (ispe); item 2 -> prop 1 (ispe), prop 2 (auxC)
  const ipma = fullBox('ipma', 0, 0,
    u32(2), // 2 entry associations
    u16(primaryItemId), 1, 1, // 1 property: index 1
    u16(depthItemId), 2, 1, 2  // 2 properties: index 1, index 2
  );
  const iprp = box('iprp', ipco, ipma);

  // meta box enclosing pitm, hdlr, iinf, iref, iprp
  const meta = fullBox('meta', 0, 0, hdlr, pitm, iinf, iref, iprp);

  // mdat box for raw mock media bits
  const mdat = box('mdat', new Uint8Array([0x00, 0x01, 0x02, 0x03]));

  const bytes = concat(ftyp, meta, mdat);

  return {
    bytes,
    buffer: Buffer.from(bytes),
    dataUrl: 'data:image/heic;base64,' + Buffer.from(bytes).toString('base64'),
  };
}

/**
 * Construct an ISOBMFF AVIF container with MIAF stereo ('ster') entity group.
 *
 * @param {Object} [options]
 * @param {Array<number>} [options.stereoGroup=[1, 2]] - Entity IDs for [leftEye, rightEye]
 * @returns {{ bytes: Uint8Array, buffer: Buffer, dataUrl: string }}
 */
export function createAVIFStereo(options = {}) {
  const {
    stereoGroup = [1, 2],
  } = options;

  const ftyp = box('ftyp', text('avif'), u32(0), text('mif1'), text('miaf'), text('avif'));
  const pitm = fullBox('pitm', 0, 0, u16(stereoGroup[0]));
  const hdlr = fullBox('hdlr', 0, 0, u32(0), text('pict'), u32(0, 0, 0), text('AVIF Stereo\0'));

  // grpl entity group with ster box grouping the stereo views
  const sterBox = box('ster', u32(0, 100, stereoGroup.length, ...stereoGroup));
  const grpl = box('grpl', sterBox);

  const meta = fullBox('meta', 0, 0, hdlr, pitm, grpl);
  const mdat = box('mdat', new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));

  const bytes = concat(ftyp, meta, mdat);

  return {
    bytes,
    buffer: Buffer.from(bytes),
    dataUrl: 'data:image/avif;base64,' + Buffer.from(bytes).toString('base64'),
  };
}

/**
 * Create synthetic RGB-D composite image representation.
 *
 * @param {Object} [options]
 * @param {string} [options.layout='left-right'] - 'left-right', 'right-left', 'top-bottom', 'bottom-top'
 * @param {number} [options.width=100]
 * @param {number} [options.height=50]
 * @returns {{ layout: string, width: number, height: number, buffer: Buffer, dataUrl: string }}
 */
export function createRGBD(options = {}) {
  const {
    layout = 'left-right',
    width = 100,
    height = 50,
  } = options;

  // Create a minimal PNG with specified dimensions representing composite color and depth
  const png = createPNGStereo({ width, height, omitSter: true });

  return {
    layout,
    width,
    height,
    bytes: png.bytes,
    buffer: png.buffer,
    dataUrl: png.dataUrl,
  };
}

/**
 * Create Looking Glass Quilt descriptor and filename.
 *
 * @param {number} [cols=8]
 * @param {number} [rows=6]
 * @param {number} [aspect=0.75]
 * @returns {{ filename: string, cols: number, rows: number, aspect: number, totalViews: number }}
 */
export function createQuiltDescriptor(cols = 8, rows = 6, aspect = 0.75) {
  const filename = `quilt_sample_qs${cols}x${rows}a${aspect}.png`;
  return {
    filename,
    cols,
    rows,
    aspect,
    totalViews: cols * rows,
  };
}

/**
 * Construct an animated Wigglegram GIF buffer with 2+ frames.
 *
 * @param {Object} [options]
 * @param {number} [options.frameCount=2]
 * @param {number} [options.width=100]
 * @param {number} [options.height=100]
 * @returns {{ bytes: Uint8Array, buffer: Buffer, dataUrl: string, frameCount: number }}
 */
export function createWigglegram(options = {}) {
  const {
    frameCount = 2,
    width = 100,
    height = 100,
  } = options;

  // Minimal GIF89a header
  const header = text('GIF89a');
  // Logical screen descriptor: width(2), height(2), packed(1)=0x80 (GCT present, 2 colors), bg(1)=0, aspect(1)=0
  const lsd = concat(u16le(width, height), new Uint8Array([0x80, 0, 0]));
  // Global color table: Black (0,0,0) and White (255,255,255)
  const gct = new Uint8Array([0, 0, 0, 255, 255, 255]);

  // Netscape application extension for looping
  const appExt = concat(
    new Uint8Array([0x21, 0xff, 0x0b]),
    text('NETSCAPE2.0'),
    new Uint8Array([0x03, 0x01, 0x00, 0x00, 0x00])
  );

  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    // Graphic control extension: delay 20 (0.2s)
    const gce = new Uint8Array([0x21, 0xf9, 0x04, 0x04, 0x14, 0x00, 0x00, 0x00]);
    // Image descriptor: left(2)=0, top(2)=0, width(2), height(2), packed(1)=0
    const imgDesc = concat(new Uint8Array([0x2c]), u16le(0, 0, width, height), new Uint8Array([0]));
    // Minimal LZW raster data
    const imgData = new Uint8Array([0x02, 0x02, 0x44, 0x01, 0x00]);
    frames.push(gce, imgDesc, imgData);
  }

  // GIF trailer
  const trailer = new Uint8Array([0x3b]);

  const bytes = concat(header, lsd, gct, appExt, ...frames, trailer);

  return {
    bytes,
    buffer: Buffer.from(bytes),
    dataUrl: 'data:image/gif;base64,' + Buffer.from(bytes).toString('base64'),
    frameCount,
  };
}

/**
 * Construct an authentic Multi-Picture Format (MPO) buffer.
 *
 * @param {Array<number>} types - Image types array (e.g. [PRIMARY, DISPARITY])
 * @param {Object} [options]
 * @returns {Uint8Array}
 */
export function createMPO(types = [0x030000, 0x020002], { littleEndian = true, corruptOffsets = false } = {}) {
  const others = types.slice(1).map((_, i) => new Uint8Array([0xff, 0xd8, 0xaa, i, 0xff, 0xd9]));
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
    const offset = i === 0 ? 0 : position - headerPosition + (corruptOffsets ? 100000 : 0);
    index.setUint32(entry, (i === 0 ? 0x20000000 : 0) | type, littleEndian);
    index.setUint32(entry + 4, size, littleEndian);
    index.setUint32(entry + 8, offset, littleEndian);
    if (i > 0) position += size;
  });
  first.set(new Uint8Array(index.buffer), headerPosition);

  return new Uint8Array([...first, ...others.flatMap(image => [...image])]);
}

/**
 * Canon RF-S 3.9mm F3.5 STM Dual Fisheye camera profile definition.
 */
export const CANON_3_9MM_PROFILE = {
  name: 'Canon RF-S 3.9mm F3.5 STM Dual Fisheye',
  exif: {
    Make: 'Canon',
    LensModel: /(?:Canon\s+)?RF-S\s*3\.9mm\s*F3\.5\s*STM\s*DUAL\s*FISHEYE/i,
  },
  type: (exif) => (exif?.Software?.includes('EOS VR Utility') ? 'left-right' : 'right-left'),
  angle: { horizontal: 144, vertical: 144 },
  fisheyeCircles: {
    width: 6960,
    diameter: 3060,
    leftCenter: 1740,
  },
};

/**
 * Canon RF-S 7.8mm F4 STM Dual camera profile definition.
 */
export const CANON_7_8MM_PROFILE = {
  name: 'Canon RF-S 7.8mm F4 STM Dual',
  exif: {
    Make: 'Canon',
    LensModel: /(?:Canon\s+)?RF-S\s*7\.8mm\s*F4\s*STM\s*DUAL/i,
  },
  type: 'left-right',
  angle: { horizontal: 50.5, vertical: 63.2 },
};

/**
 * XREAL Beam Pro camera profile definition.
 */
export const XREAL_BEAM_PRO_PROFILE = {
  name: 'XREAL Beam Pro',
  exif: {
    Make: 'XREAL',
    Model: /Beam\s*Pro|X4000/i,
  },
  fileName: /^S[PV]_/i,
  type: 'left-right',
  angle: { horizontal: 100.9, vertical: 84.8 },
};

/**
 * Produce synthetic EXIF metadata objects matching target camera profiles.
 *
 * @param {string} profileName - 'canon-3.9mm', 'canon-3.9mm-processed', 'canon-7.8mm', 'xreal-beam-pro', 'canon-5.2mm', 'gopro', 'insta360'
 * @param {Object} [overrides={}]
 * @returns {Object}
 */
export function createCameraEXIF(profileName, overrides = {}) {
  const norm = profileName.toLowerCase();
  let base = {};

  if (norm.includes('3.9mm') || norm.includes('3_9mm')) {
    const isProcessed = norm.includes('processed');
    base = {
      Make: 'Canon',
      Model: 'Canon EOS R7',
      LensModel: 'RF-S3.9mm F3.5 STM DUAL FISHEYE',
      FocalLength: 3.9,
      ImageWidth: 6960,
      ImageHeight: 4640,
      Software: isProcessed ? 'Canon EOS VR Utility v1.4' : 'Canon EOS R7 Firmware 1.2.0',
    };
  } else if (norm.includes('7.8mm') || norm.includes('7_8mm')) {
    base = {
      Make: 'Canon',
      Model: 'Canon EOS R7',
      LensModel: 'RF-S7.8mm F4 STM DUAL',
      FocalLength: 7.8,
      ImageWidth: 6960,
      ImageHeight: 4640,
    };
  } else if (norm.includes('xreal') || norm.includes('beam')) {
    base = {
      Make: 'XREAL',
      Model: 'Beam Pro',
      FocalLength: 2.5,
      ImageWidth: 3840,
      ImageHeight: 1440,
    };
  } else if (norm.includes('5.2mm') || norm.includes('5_2mm')) {
    base = {
      Make: 'Canon',
      Model: 'Canon EOS R5',
      LensModel: 'RF5.2mm F2.8 L DUAL FISHEYE',
      FocalLength: 5.2,
      ImageWidth: 8192,
      ImageHeight: 5464,
    };
  } else if (norm.includes('gopro')) {
    base = {
      Make: 'GoPro',
      Model: 'HERO7 Black',
      ImageWidth: 4000,
      ImageHeight: 3000,
    };
  } else if (norm.includes('insta360')) {
    base = {
      Make: 'Insta360',
      Model: 'insta360 evo',
      ImageWidth: 6080,
      ImageHeight: 3040,
    };
  }

  return { ...base, ...overrides };
}
