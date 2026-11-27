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

import parseQuiltDefault, {
  parseQuilt,
  parseQuiltDescriptor,
  getQuiltTileBounds,
} from '../../parsers/quilt-parser/quilt-parser.js';
import { quiltDescriptorOfName, StereoImg } from '../../stereo-img.js';

// ============================================================================
// Coordinate-Encoded Canvas & DOM Harness
// ============================================================================

class FakeImageData {
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

function makeCoordinateQuiltBuffer(width, height, cols, rows) {
  const buf = new Uint8ClampedArray(width * height * 4);
  const tileWidth = Math.max(1, Math.floor(width / cols));
  const tileHeight = Math.max(1, Math.floor(height / rows));

  for (let y = 0; y < height; y++) {
    const rowFromTop = Math.min(rows - 1, Math.floor(y / tileHeight));
    const rowFromBottom = (rows - 1) - rowFromTop;
    for (let x = 0; x < width; x++) {
      const col = Math.min(cols - 1, Math.floor(x / tileWidth));
      const viewIndex = rowFromBottom * cols + col;
      const offset = (y * width + x) * 4;
      buf[offset] = (col * 30) & 0xff;
      buf[offset + 1] = (rowFromTop * 40) & 0xff;
      buf[offset + 2] = (viewIndex * 5) & 0xff;
      buf[offset + 3] = 255;
    }
  }
  return buf;
}

function makeExifJpeg(focalLength35mm) {
  const tiff = new Uint8Array(44);
  const tv = new DataView(tiff.buffer);
  tiff[0] = 0x4d;
  tiff[1] = 0x4d;
  tv.setUint16(2, 42, false);
  tv.setUint32(4, 8, false);
  tv.setUint16(8, 1, false);
  tv.setUint16(10, 0x8769, false);
  tv.setUint16(12, 4, false);
  tv.setUint32(14, 1, false);
  tv.setUint32(18, 26, false);
  tv.setUint32(22, 0, false);
  tv.setUint16(26, 1, false);
  tv.setUint16(28, 0xa405, false);
  tv.setUint16(30, 3, false);
  tv.setUint32(32, 1, false);
  tv.setUint16(36, focalLength35mm, false);
  tv.setUint32(40, 0, false);

  const app1Len = 2 + 6 + tiff.length;
  const out = new Uint8Array(2 + 2 + app1Len + 2);
  out[0] = 0xff;
  out[1] = 0xd8;
  out[2] = 0xff;
  out[3] = 0xe1;
  new DataView(out.buffer).setUint16(4, app1Len, false);
  out.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6);
  out.set(tiff, 12);
  out[out.length - 2] = 0xff;
  out[out.length - 1] = 0xd9;
  return out;
}

function withMockDOM({ width = 32, height = 24, pixels = null, readOnlySize = false, failLoad = false, asyncLoad = true } = {}) {
  const saved = {
    Image: global.Image,
    ImageData: global.ImageData,
    document: global.document,
    fetch: global.fetch,
    URL: global.URL,
  };

  const images = [];
  let canvasesCreated = 0;

  class MockImage {
    constructor() {
      this._src = '';
      this.onload = null;
      this.onerror = null;
      this.crossOrigin = null;
      if (readOnlySize) {
        Object.defineProperty(this, 'naturalWidth', { get: () => width });
        Object.defineProperty(this, 'naturalHeight', { get: () => height });
        Object.defineProperty(this, 'width', { get: () => Math.max(1, Math.floor(width / 2)) });
        Object.defineProperty(this, 'height', { get: () => Math.max(1, Math.floor(height / 2)) });
      } else {
        this.width = width;
        this.height = height;
      }
      images.push(this);
    }

    set src(value) {
      this._src = value;
      if (!value) {
        return;
      }
      const trigger = () => {
        if (failLoad || value.startsWith('error')) {
          this.onerror?.(new Error(`Mock load failure: ${value}`));
        } else {
          this.onload?.();
        }
      };
      if (asyncLoad) {
        setImmediate(trigger);
      } else {
        trigger();
      }
    }

    get src() {
      return this._src;
    }
  }

  class MockCanvas {
    constructor() {
      this.width = width;
      this.height = height;
      this._buffer = pixels ? new Uint8ClampedArray(pixels) : new Uint8ClampedArray(width * height * 4).fill(255);
      this._ctx = {
        canvas: this,
        drawImage: (img, sx, sy, sw, sh, dx, dy, dw, dh) => {
          const targetW = Number.isFinite(dw) ? dw : (Number.isFinite(sx) && !Number.isFinite(sw) ? this.width : (img.naturalWidth || img.width));
          const targetH = Number.isFinite(dh) ? dh : (Number.isFinite(sy) && !Number.isFinite(sh) ? this.height : (img.naturalHeight || img.height));
          if (pixels && (targetW !== width || targetH !== height)) {
            this._buffer = new Uint8ClampedArray(targetW * targetH * 4);
            for (let row = 0; row < targetH; row++) {
              const srcRow = Math.min(height - 1, Math.floor((row * height) / targetH));
              for (let col = 0; col < targetW; col++) {
                const srcCol = Math.min(width - 1, Math.floor((col * width) / targetW));
                const dstIdx = (row * targetW + col) * 4;
                const srcIdx = (srcRow * width + srcCol) * 4;
                this._buffer[dstIdx] = pixels[srcIdx];
                this._buffer[dstIdx + 1] = pixels[srcIdx + 1];
                this._buffer[dstIdx + 2] = pixels[srcIdx + 2];
                this._buffer[dstIdx + 3] = pixels[srcIdx + 3];
              }
            }
          }
        },
        getImageData: (x, y, w, h) => {
          const out = new Uint8ClampedArray(w * h * 4);
          const bufW = this.width;
          for (let row = 0; row < h; row++) {
            for (let col = 0; col < w; col++) {
              const srcX = Math.min(Math.max(0, x + col), bufW - 1);
              const srcY = Math.min(Math.max(0, y + row), this.height - 1);
              const srcIdx = (srcY * bufW + srcX) * 4;
              const dstIdx = (row * w + col) * 4;
              out[dstIdx] = this._buffer[srcIdx];
              out[dstIdx + 1] = this._buffer[srcIdx + 1];
              out[dstIdx + 2] = this._buffer[srcIdx + 2];
              out[dstIdx + 3] = this._buffer[srcIdx + 3];
            }
          }
          return new FakeImageData(out, w, h);
        },
        clearRect: () => {},
      };
    }

    getContext(kind) {
      return kind === '2d' ? this._ctx : null;
    }
  }

  global.Image = MockImage;
  global.ImageData = FakeImageData;
  global.document = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        canvasesCreated++;
        return new MockCanvas();
      }
      return {};
    },
  };

  return {
    images,
    getCanvasesCreated: () => canvasesCreated,
    restore: () => {
      global.Image = saved.Image;
      global.ImageData = saved.ImageData;
      global.document = saved.document;
      global.fetch = saved.fetch;
      global.URL = saved.URL;
    },
  };
}

// ============================================================================
// 1. Descriptor Parsing (parseQuiltDescriptor & quiltDescriptorOfName)
// ============================================================================

test('parseQuiltDescriptor parses standard 8x6 and 5x9 descriptors', () => {
  assert.deepEqual(parseQuiltDescriptor('looking-glass_qs8x6a0.75.png'), {
    cols: 8,
    rows: 6,
    aspect: 0.75,
    totalViews: 48,
  });
  assert.deepEqual(parseQuiltDescriptor('quilt_sample_qs5x9a0.5625.png'), {
    cols: 5,
    rows: 9,
    aspect: 0.5625,
    totalViews: 45,
  });
  assert.deepEqual(parseQuiltDescriptor('single_qs1x1a1.0.png'), {
    cols: 1,
    rows: 1,
    aspect: 1,
    totalViews: 1,
  });
});

test('parseQuiltDescriptor supports case-insensitivity, leading-dot aspect, suffix, query/hash, and URL encoding', () => {
  assert.deepEqual(parseQuiltDescriptor('PATH/TO/PHOTO_QS4x8A1.333.JPG'), {
    cols: 4,
    rows: 8,
    aspect: 1.333,
    totalViews: 32,
  });
  assert.deepEqual(parseQuiltDescriptor('clip_qs8x6a.75.png'), {
    cols: 8,
    rows: 6,
    aspect: 0.75,
    totalViews: 48,
  });
  assert.deepEqual(parseQuiltDescriptor('clip_qs8x6a0.75_v2.png'), {
    cols: 8,
    rows: 6,
    aspect: 0.75,
    totalViews: 48,
  });
  assert.deepEqual(parseQuiltDescriptor('https://example.com/my%20quilt_qs6x8a0.75.webp?token=123#view'), {
    cols: 6,
    rows: 8,
    aspect: 0.75,
    totalViews: 48,
  });
  assert.deepEqual(parseQuiltDescriptor('noext_qs2x2a2'), {
    cols: 2,
    rows: 2,
    aspect: 2,
    totalViews: 4,
  });
  assert.deepEqual(parseQuiltDescriptor('quilt_qs8x6a0.75.v2.png'), {
    cols: 8,
    rows: 6,
    aspect: 0.75,
    totalViews: 48,
  });
  assert.deepEqual(parseQuiltDescriptor('quilt_qs8x6a0.75.backup.png'), {
    cols: 8,
    rows: 6,
    aspect: 0.75,
    totalViews: 48,
  });
  assert.deepEqual(quiltDescriptorOfName('quilt_qs8x6a0.75.v2.png'), {
    cols: 8,
    rows: 6,
    aspect: 0.75,
    totalViews: 48,
  });
  assert.deepEqual(parseQuiltDescriptor('C:\\Users\\alice\\quilt_qs8x6a0.75.png'), {
    cols: 8,
    rows: 6,
    aspect: 0.75,
    totalViews: 48,
  });
  assert.deepEqual(parseQuiltDescriptor('https://example.com/dir%2Fquilt_qs8x6a0.75.png'), {
    cols: 8,
    rows: 6,
    aspect: 0.75,
    totalViews: 48,
  });
});

test('parseQuiltDescriptor and quiltDescriptorOfName ignore descriptors in Windows or %2F/%5C parent directories', () => {
  const dirOnlyCases = [
    'C:\\renders_qs8x6a0.75\\normal.png',
    '\\\\server\\renders_qs8x6a0.75\\normal.png',
    'https://example.com/renders_qs8x6a0.75%2Fnormal.png',
    'https://example.com/renders_qs8x6a0.75%5Cnormal.png',
    'https://example.com/renders_qs8x6a0.75/normal.png?file=quilt_qs8x6a0.75.png',
  ];
  for (const input of dirOnlyCases) {
    assert.equal(parseQuiltDescriptor(input), null, `Expected null for ${input}`);
    assert.equal(quiltDescriptorOfName(input), undefined, `Expected undefined for ${input}`);
  }
});

test('parseQuiltDescriptor rejects invalid descriptors, zero bounds, and data/blob URIs', () => {
  const invalidCases = [
    '',
    '   ',
    null,
    undefined,
    123,
    'regular-stereo.png',
    'quilt_qs0x0a0.75.png',
    'quilt_qs0x6a0.75.png',
    'quilt_qs8x0a0.75.png',
    'quilt_qs8x6a0.png',
    'quilt_qs8x6a0.0.png',
    'quilt_qs8x6aABC.png',
    'quilt_qs8x6a1.2.3.png',
    'quilt_qs8x6a12px.png',
    'quilt_qs8x6a.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:https://example.com/quilt_qs8x6a0.75.png',
  ];
  for (const input of invalidCases) {
    assert.equal(parseQuiltDescriptor(input), null, `Expected null for ${String(input)}`);
    assert.equal(quiltDescriptorOfName(input), undefined, `Expected undefined for ${String(input)}`);
  }
});

// ============================================================================
// 2. Grid Bounds Geometry (getQuiltTileBounds)
// ============================================================================

test('getQuiltTileBounds maps View 0 bottom-left to View N-1 top-right', () => {
  // 8x6 grid on 32x24 image -> 4x4 tiles
  assert.deepEqual(getQuiltTileBounds(32, 24, 8, 6, 0), { x: 0, y: 20, width: 4, height: 4 });
  assert.deepEqual(getQuiltTileBounds(32, 24, 8, 6, 7), { x: 28, y: 20, width: 4, height: 4 });
  assert.deepEqual(getQuiltTileBounds(32, 24, 8, 6, 8), { x: 0, y: 16, width: 4, height: 4 });
  assert.deepEqual(getQuiltTileBounds(32, 24, 8, 6, 40), { x: 0, y: 0, width: 4, height: 4 });
  assert.deepEqual(getQuiltTileBounds(32, 24, 8, 6, 47), { x: 28, y: 0, width: 4, height: 4 });
});

test('getQuiltTileBounds handles non-divisible, 1x1, and tiny FakeImage dimensions', () => {
  // 1001x701 with 8x6 -> tileWidth = 125, tileHeight = 116
  assert.deepEqual(getQuiltTileBounds(1001, 701, 8, 6, 0), { x: 0, y: 580, width: 125, height: 116 });
  assert.deepEqual(getQuiltTileBounds(1001, 701, 8, 6, 47), { x: 875, y: 0, width: 125, height: 116 });

  // 1x1 grid
  assert.deepEqual(getQuiltTileBounds(640, 480, 1, 1, 0), { x: 0, y: 0, width: 640, height: 480 });

  // 4x2 FakeImage with 8x6 grid -> clamps tile size >= 1 and coords within bounds
  const b0 = getQuiltTileBounds(4, 2, 8, 6, 0);
  const b47 = getQuiltTileBounds(4, 2, 8, 6, 47);
  assert.equal(b0.width, 1);
  assert.equal(b0.height, 1);
  assert.ok(b0.x >= 0 && b0.x <= 3);
  assert.ok(b0.y >= 0 && b0.y <= 1);
  assert.equal(b47.width, 1);
  assert.equal(b47.height, 1);
  assert.ok(b47.x >= 0 && b47.x <= 3);
  assert.ok(b47.y >= 0 && b47.y <= 1);
});

test('getQuiltTileBounds throws RangeError on invalid grid or viewIndex', () => {
  assert.throws(() => getQuiltTileBounds(32, 24, 8, 6, -1), RangeError);
  assert.throws(() => getQuiltTileBounds(32, 24, 8, 6, 48), RangeError);
  assert.throws(() => getQuiltTileBounds(32, 24, 8, 6, 1.5), RangeError);
  assert.throws(() => getQuiltTileBounds(32, 24, 0, 6, 0), RangeError);
  assert.throws(() => getQuiltTileBounds(32, 24, 8, 0, 0), RangeError);
  assert.throws(() => getQuiltTileBounds(0, 24, 8, 6, 0), RangeError);
  assert.throws(() => getQuiltTileBounds(32, -1, 8, 6, 0), RangeError);
  assert.throws(() => getQuiltTileBounds(100, 100, 1e200, 1e200, 0), RangeError);
});

// ============================================================================
// 3. Pixel Slicing & Stereo Extraction (parseQuilt)
// ============================================================================

test('parseQuilt default export equals parseQuilt named export', () => {
  assert.equal(parseQuiltDefault, parseQuilt);
});

test('parseQuilt slices default extreme views (View 0 left, View N-1 right) accurately', async () => {
  const pixels = makeCoordinateQuiltBuffer(32, 24, 8, 6);
  const env = withMockDOM({ width: 32, height: 24, pixels });
  try {
    const data = await parseQuilt('sample_qs8x6a0.75.png');

    assert.equal(data.leftEye.width, 4);
    assert.equal(data.leftEye.height, 4);
    assert.equal(data.rightEye.width, 4);
    assert.equal(data.rightEye.height, 4);

    // View 0: col=0, rowFromTop=5 -> (0, 200, 0, 255)
    assert.deepEqual(Array.from(data.leftEye.data.slice(0, 4)), [0, 200, 0, 255]);
    // View 47: col=7, rowFromTop=0 -> (210, 0, 235, 255)
    assert.deepEqual(Array.from(data.rightEye.data.slice(0, 4)), [210, 0, 235, 255]);
  } finally {
    env.restore();
  }
});

test('parseQuilt extracts specific view via options.viewIndex', async () => {
  const pixels = makeCoordinateQuiltBuffer(32, 24, 8, 6);
  const env = withMockDOM({ width: 32, height: 24, pixels });
  try {
    const cases = [
      { viewIndex: 0, rgba: [0, 200, 0, 255] },
      { viewIndex: 7, rgba: [210, 200, 35, 255] },
      { viewIndex: 40, rgba: [0, 0, 200, 255] },
      { viewIndex: 47, rgba: [210, 0, 235, 255] },
    ];
    for (const c of cases) {
      const data = await parseQuilt('sample_qs8x6a0.75.png', { viewIndex: c.viewIndex });
      assert.deepEqual(Array.from(data.leftEye.data.slice(0, 4)), c.rgba);
      assert.deepEqual(Array.from(data.rightEye.data.slice(0, 4)), c.rgba);
    }
  } finally {
    env.restore();
  }
});

test('parseQuilt supports custom leftView and rightView options', async () => {
  const pixels = makeCoordinateQuiltBuffer(32, 24, 8, 6);
  const env = withMockDOM({ width: 32, height: 24, pixels });
  try {
    // leftView 10: rowFromBottom=1 (rowFromTop=4), col=2 -> (60, 160, 50, 255)
    // rightView 25: rowFromBottom=3 (rowFromTop=2), col=1 -> (30, 80, 125, 255)
    const data = await parseQuilt('sample_qs8x6a0.75.png', { leftView: 10, rightView: 25 });
    assert.deepEqual(Array.from(data.leftEye.data.slice(0, 4)), [60, 160, 50, 255]);
    assert.deepEqual(Array.from(data.rightEye.data.slice(0, 4)), [30, 80, 125, 255]);
  } finally {
    env.restore();
  }
});

test('parseQuilt handles 1x1 grid and odd non-divisible image dimensions', async () => {
  const pixels1x1 = makeCoordinateQuiltBuffer(6, 4, 1, 1);
  let env = withMockDOM({ width: 6, height: 4, pixels: pixels1x1 });
  try {
    const data = await parseQuilt('single_qs1x1a1.5.png');
    assert.equal(data.leftEye.width, 6);
    assert.equal(data.leftEye.height, 4);
    assert.equal(data.rightEye.width, 6);
    assert.equal(data.rightEye.height, 4);
    assert.deepEqual(Array.from(data.leftEye.data.slice(0, 4)), [0, 0, 0, 255]);
  } finally {
    env.restore();
  }

  // 25x19 with 4x3 grid -> tileWidth=6, tileHeight=6
  const pixelsOdd = makeCoordinateQuiltBuffer(25, 19, 4, 3);
  env = withMockDOM({ width: 25, height: 19, pixels: pixelsOdd });
  try {
    const data = await parseQuilt('odd_qs4x3a1.0.png');
    assert.equal(data.leftEye.width, 6);
    assert.equal(data.leftEye.height, 6);
    // View 0: col=0, rowFromTop=2 -> (0, 80, 0, 255)
    assert.deepEqual(Array.from(data.leftEye.data.slice(0, 4)), [0, 80, 0, 255]);
    // View 11: col=3, rowFromTop=0 -> (90, 0, 55, 255)
    assert.deepEqual(Array.from(data.rightEye.data.slice(0, 4)), [90, 0, 55, 255]);
  } finally {
    env.restore();
  }
});

test('parseQuilt prefers naturalWidth/naturalHeight even when width/height are read-only', async () => {
  const pixels = makeCoordinateQuiltBuffer(16, 12, 4, 3);
  const env = withMockDOM({ width: 16, height: 12, pixels, readOnlySize: true });
  try {
    const data = await parseQuilt('readonly_qs4x3a1.0.png');
    assert.equal(data.leftEye.width, 4);
    assert.equal(data.leftEye.height, 4);
    // View 0: col=0, rowFromTop=2 -> (0, 80, 0, 255)
    assert.deepEqual(Array.from(data.leftEye.data.slice(0, 4)), [0, 80, 0, 255]);
    // View 11: col=3, rowFromTop=0 -> (90, 0, 55, 255)
    assert.deepEqual(Array.from(data.rightEye.data.slice(0, 4)), [90, 0, 55, 255]);
  } finally {
    env.restore();
  }
});

// ============================================================================
// 4. StereoData Contract, Angles, EXIF & Projection
// ============================================================================

test('parseQuilt derives angles from angle attribute, EXIF FocalLengthIn35mmFormat, and projection', async () => {
  const pixels = makeCoordinateQuiltBuffer(16, 12, 4, 3);
  const env = withMockDOM({ width: 16, height: 12, pixels });
  try {
    const d45 = await parseQuilt('test_qs4x3a1.0.png', { angle: 45 });
    assert.ok(Math.abs(d45.phiLength - (45 * Math.PI) / 180) < 1e-6);
    assert.ok(Math.abs(d45.thetaStart - (Math.PI / 2 - d45.thetaLength / 2)) < 1e-6);
    assert.equal(d45.projection, undefined);

    const d180 = await parseQuilt('test_qs4x3a1.0.png', { angle: '180', projection: 'fisheye' });
    assert.equal(d180.phiLength, Math.PI);
    assert.equal(d180.thetaLength, Math.PI);
    assert.equal(d180.thetaStart, 0);
    assert.equal(d180.projection, 'fisheye');

    const d360 = await parseQuilt('test_qs4x3a1.0.png', { angle: 360 });
    assert.equal(d360.phiLength, 2 * Math.PI);
    assert.equal(d360.thetaLength, Math.PI);

    // EXIF FocalLengthIn35mmFormat via JPEG data URI + originalUrl
    const exifBytes = makeExifJpeg(50);
    const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(exifBytes).toString('base64');
    const dExif = await parseQuilt(dataUrl, { originalUrl: 'exif_qs4x3a1.0.png' });
    const diag = 2 * Math.atan(43.3 / 100);
    const expectedPhi = diag * Math.cos(Math.atan(4 / 4));
    assert.ok(Math.abs(dExif.phiLength - expectedPhi) < 1e-4);
    assert.equal(dExif.aspect, 1.0);
  } finally {
    env.restore();
  }
});

test('parseQuilt propagates descriptor aspect to anglesOfView and StereoData.aspect without altering raw tile pixels', async () => {
  // 5x9 Looking Glass Portrait quilt packed into square 45x45 pixels -> raw tile is 9x5 (1.80:1),
  // whereas a0.5625 specifies 9:16 portrait display aspect (0.5625).
  const pixels = makeCoordinateQuiltBuffer(45, 45, 5, 9);
  const env = withMockDOM({ width: 45, height: 45, pixels });
  try {
    const portrait = await parseQuilt('portrait_qs5x9a0.5625.png', { angle: 45 });
    assert.equal(portrait.leftEye.width, 9);
    assert.equal(portrait.leftEye.height, 5);
    assert.equal(portrait.aspect, 0.5625);
    assert.ok(portrait.thetaLength > portrait.phiLength, 'Portrait aspect 0.5625 must yield thetaLength > phiLength');
    assert.ok(Math.abs((portrait.phiLength / portrait.thetaLength) - 0.5625) < 1e-6);

    const overridden = await parseQuilt('portrait_qs5x9a0.5625.png', { angle: 45, aspect: 1.5 });
    assert.equal(overridden.aspect, 1.5);
    assert.ok(overridden.phiLength > overridden.thetaLength, 'Landscape aspect override 1.5 must yield phiLength > thetaLength');
    assert.ok(Math.abs((overridden.phiLength / overridden.thetaLength) - 1.5) < 1e-6);
  } finally {
    env.restore();
  }
});

// ============================================================================
// 5. Error Handling & AbortSignal
// ============================================================================

test('parseQuilt rejects invalid URLs, malformed descriptors, and out-of-range options', async () => {
  const env = withMockDOM({ width: 16, height: 12 });
  try {
    await assert.rejects(parseQuilt(''));
    await assert.rejects(parseQuilt('   '));
    await assert.rejects(parseQuilt(null));
    await assert.rejects(parseQuilt(undefined));
    await assert.rejects(parseQuilt('not-a-quilt.png'));
    await assert.rejects(parseQuilt('quilt_qs0x0a0.75.png'));
    await assert.rejects(parseQuilt('quilt_qs8x6aABC.png'));
    await assert.rejects(parseQuilt('quilt_qs8x6a0.png'));
    await assert.rejects(parseQuilt('quilt_qs8x6a1.2.3.png'));
    // Malformed _qs must still reject even when fallbackDefault is true
    await assert.rejects(parseQuilt('quilt_qs0x0a0.75.png', { fallbackDefault: true }));

    await assert.rejects(parseQuilt('quilt_qs8x6a0.75.png', { viewIndex: -1 }), RangeError);
    await assert.rejects(parseQuilt('quilt_qs8x6a0.75.png', { viewIndex: 48 }), RangeError);
    await assert.rejects(parseQuilt('quilt_qs8x6a0.75.png', { viewIndex: 1.5 }), RangeError);
    await assert.rejects(parseQuilt('quilt_qs8x6a0.75.png', { viewIndex: true }), RangeError);
    await assert.rejects(parseQuilt('quilt_qs8x6a0.75.png', { leftView: 48 }), RangeError);
    await assert.rejects(parseQuilt('quilt_qs8x6a0.75.png', { rightView: -1 }), RangeError);
    await assert.rejects(parseQuilt('data:image/png;base64,AAAA', { columns: 0, rows: 6 }), RangeError);
    await assert.rejects(parseQuilt('data:image/png;base64,AAAA', { columns: 4 }), RangeError);
    await assert.rejects(parseQuilt('data:image/png;base64,AAAA', { columns: 8, rows: 6, aspect: -1 }), RangeError);
    // Rejects without touching DOM Image on descriptor error
    assert.equal(env.images.length, 0);
  } finally {
    env.restore();
  }
});

test('parseQuilt falls back missing columns or rows to defaults when fallbackDefault is true', async () => {
  const pixels = makeCoordinateQuiltBuffer(32, 24, 8, 6);
  const env = withMockDOM({ width: 32, height: 24, pixels });
  try {
    // Only columns specified -> rows falls back to 6 -> 4 cols x 6 rows => 8x4 tiles
    const colsOnly = await parseQuilt('data:image/png;base64,AAAA', { columns: 4, fallbackDefault: true });
    assert.equal(colsOnly.leftEye.width, Math.floor(32 / 4));
    assert.equal(colsOnly.leftEye.height, Math.floor(24 / 6));
    assert.equal(colsOnly.aspect, 0.75);

    // Only rows specified -> cols falls back to 8 -> 8 cols x 3 rows => 4x8 tiles
    const rowsOnly = await parseQuilt('data:image/png;base64,AAAA', { rows: 3, fallbackDefault: true });
    assert.equal(rowsOnly.leftEye.width, Math.floor(32 / 8));
    assert.equal(rowsOnly.leftEye.height, Math.floor(24 / 3));
    assert.equal(rowsOnly.aspect, 0.75);
  } finally {
    env.restore();
  }
});

test('parseQuilt rejects on image load error and respects AbortSignal', async () => {
  const envFail = withMockDOM({ failLoad: true });
  try {
    await assert.rejects(parseQuilt('broken_qs8x6a0.75.png'));
  } finally {
    envFail.restore();
  }

  const env = withMockDOM({ width: 16, height: 12 });
  try {
    // 1. Pre-aborted signal does not touch Image or canvas
    await assert.rejects(parseQuilt('quilt_qs8x6a0.75.png', { signal: AbortSignal.abort() }), err => err.name === 'AbortError');
    assert.equal(env.images.length, 0);
    assert.equal(env.getCanvasesCreated(), 0);

    // 2. Aborted mid-load clears image.src and skips canvas creation
    const controller = new AbortController();
    const reason = new Error('cancelled quilt');
    const pending = parseQuilt('quilt_qs8x6a0.75.png', { signal: controller.signal });
    controller.abort(reason);
    await assert.rejects(pending, err => err === reason);
    assert.equal(env.images.length, 1);
    assert.equal(env.images[0].src, '');
    assert.equal(env.getCanvasesCreated(), 0);

    // 3. Post-completion abort is ignored
    const postController = new AbortController();
    const res = await parseQuilt('quilt_qs4x3a1.0.png', { signal: postController.signal });
    postController.abort();
    assert.ok(res.leftEye);
  } finally {
    env.restore();
  }
});

// ============================================================================
// 6. <stereo-img> Element Routing & Integration
// ============================================================================

test('StereoImg._parsePicture auto-detects _qs filename before _isStereo and supports explicit type="quilt"', async () => {
  const pixels = makeCoordinateQuiltBuffer(20, 18, 5, 3);
  const env = withMockDOM({ width: 20, height: 18, pixels });
  try {
    let isStereoCalled = false;
    // Valid minimal 1x1 PNG header + IHDR + IEND so exifr.parse handles bytes cleanly
    const minimalPngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);
    const mockPicture = (url, bytes = minimalPngBytes) => ({
      url,
      objectURL: async () => 'blob:mock-quilt',
      bytes: async () => bytes,
      release: () => {},
    });

    const instance = Object.create(StereoImg.prototype);
    instance._isStereo = async () => {
      isStereoCalled = true;
      return false;
    };

    // 1. Auto-detect via _qs5x3a0.75.png without triggering _isStereo
    const autoData = await instance._parsePicture(
      mockPicture('https://example.com/render_qs5x3a0.75.png'),
      null,
      {},
    );
    assert.equal(isStereoCalled, false);
    assert.equal(autoData.leftEye.width, 4);
    assert.equal(autoData.leftEye.height, 6);
    // View 0: col=0, rowFromTop=2 -> (0, 80, 0, 255)
    assert.deepEqual(Array.from(autoData.leftEye.data.slice(0, 4)), [0, 80, 0, 255]);
    // View 14: col=4, rowFromTop=0 -> (120, 0, 70, 255)
    assert.deepEqual(Array.from(autoData.rightEye.data.slice(0, 4)), [120, 0, 70, 255]);

    // 2. Explicit type="quilt" without _qs filename descriptor falls back to 8x6
    const fallbackData = await instance._parsePicture(
      mockPicture('data:image/png;base64,AAAA'),
      null,
      { type: 'quilt' },
    );
    assert.equal(fallbackData.leftEye.width, Math.floor(20 / 8));
    assert.equal(fallbackData.leftEye.height, Math.floor(18 / 6));
  } finally {
    env.restore();
  }
});

test('StereoImg.createEye renders PlaneGeometry with stereoData.aspect instead of distorted raw tile aspect', async () => {
  const env = withMockDOM({ width: 45, height: 45 });
  try {
    const rawTile = new FakeImageData(9, 5); // raw tile pixel ratio 1.80 (from 45x45 5x9 portrait quilt)
    const fakeInstance = {
      stereoData: {
        leftEye: rawTile,
        rightEye: rawTile,
        phiLength: 0.5,
        thetaStart: 1.0,
        thetaLength: 0.5 / 0.5625,
        aspect: 0.5625,
      },
      renderer: { capabilities: { maxTextureSize: 4096 } },
      stereoImageGroup: {
        children: [],
        add(mesh) {
          this.children.push(mesh);
        },
      },
      _maxTextureSize: StereoImg.prototype._maxTextureSize,
    };

    await StereoImg.prototype.createEye.call(fakeInstance, 'left');
    assert.equal(fakeInstance.stereoImageGroup.children.length, 1);
    const params = fakeInstance.stereoImageGroup.children[0].geometry.parameters;
    assert.ok(Math.abs((params.width / params.height) - 0.5625) < 1e-6);

    // Without stereoData.aspect, createEye falls back to raw imageData.width / imageData.height
    fakeInstance.stereoImageGroup.children = [];
    delete fakeInstance.stereoData.aspect;
    await StereoImg.prototype.createEye.call(fakeInstance, 'left');
    const fallbackParams = fakeInstance.stereoImageGroup.children[0].geometry.parameters;
    assert.ok(Math.abs((fallbackParams.width / fallbackParams.height) - (9 / 5)) < 1e-6);
  } finally {
    env.restore();
  }
});

test('parseQuilt and StereoImg normalize non-Error onerror events and reject truncated PNGs missing IEND', async () => {
  const pixels = makeCoordinateQuiltBuffer(16, 12, 4, 3);
  const env = withMockDOM({ width: 16, height: 12, pixels });
  try {
    // 1. Non-Error DOM Event in image.onerror -> Error instance
    const SavedImage = global.Image;
    global.Image = class EventErrorImage {
      set src(v) {
        if (v) {
          setImmediate(() => this.onerror?.({ type: 'error' }));
        }
      }
    };
    await assert.rejects(
      () => parseQuilt('https://example.invalid/missing_qs4x3a1.0.png'),
      (err) => err instanceof Error && /Failed to load quilt image/i.test(err.message)
    );
    await assert.rejects(
      () => StereoImg.prototype._loadImage('https://example.invalid/bad.gif'),
      (err) => err instanceof Error && /Failed to load image/i.test(err.message)
    );
    await assert.rejects(
      () => StereoImg.prototype.createEye.call(
        { stereoData: { leftEye: 'https://example.invalid/eye.png', phiLength: 0.5 } },
        'left'
      ),
      (err) => err instanceof Error && /Failed to load image/i.test(err.message)
    );

    // 2. Truncated PNG (missing IEND) via options.bytes, data URI, and fetch
    global.Image = SavedImage;
    const truncatedPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x0c,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x04, 0x49, 0x44, 0x41, 0x54,
      0x78, 0x9c,
    ]);
    await assert.rejects(
      () => parseQuilt('trunc_qs4x3a1.0.png', { bytes: truncatedPng }),
      (err) => err instanceof Error && /missing IEND chunk/i.test(err.message)
    );
    const truncDataUrl = 'data:image/png;base64,' + Buffer.from(truncatedPng).toString('base64');
    await assert.rejects(
      () => parseQuilt(truncDataUrl, { columns: 4, rows: 3, aspect: 1.0 }),
      (err) => err instanceof Error && /missing IEND chunk/i.test(err.message)
    );

    global.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => truncatedPng.buffer.slice(truncatedPng.byteOffset, truncatedPng.byteOffset + truncatedPng.byteLength),
    });
    await assert.rejects(
      () => parseQuilt('https://example.invalid/trunc_qs4x3a1.0.png'),
      (err) => err instanceof Error && /missing IEND chunk/i.test(err.message)
    );

    // 3. Zero naturalWidth/naturalHeight rejects
    global.fetch = undefined;
    global.Image = class ZeroNaturalImage {
      constructor() {
        this.width = 16;
        this.height = 12;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
      }
      set src(v) {
        if (v) {
          setImmediate(() => this.onload?.());
        }
      }
    };
    await assert.rejects(
      () => parseQuilt('zero_qs4x3a1.0.png'),
      (err) => err instanceof Error && /missing IEND chunk/i.test(err.message)
    );
  } finally {
    env.restore();
  }
});
