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

import parseRGBDDefault, {
  parseRGBD,
  normalizeRgbdType,
  resolveRgbdLayout,
  toDepthMap,
  imageDataToCanvas,
} from '../../parsers/rgbd-parser/rgbd-parser.js';
import { rgbdTypeOfName, StereoImg } from '../../stereo-img.js';

// ============================================================================
// Synthetic PNG & DOM Test Harness
// ============================================================================

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = new Uint8Array(0)) {
  const typeBytes = new Uint8Array(Array.from(type, c => c.charCodeAt(0)));
  const chunk = new Uint8Array(8 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return chunk;
}

function makePng(width, height, extraChunks = []) {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunks = [
    signature,
    pngChunk('IHDR', ihdr),
    ...extraChunks,
    pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])),
    pngChunk('IEND'),
  ];
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function makeExifTiff(focalLength35mm) {
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
  return tiff;
}

function makeExifJpeg(focalLength35mm) {
  const tiff = makeExifTiff(focalLength35mm);
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

function toPngDataUrl(bytes) {
  return 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
}

class FakeImageData {
  constructor(dataOrWidth, widthOrHeight, maybeHeight) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = maybeHeight;
    }
  }
}

function setupMockDOM(
  imgWidth,
  imgHeight,
  pixelFn,
  {
    withPutImageData = true,
    naturalOnly = false,
    cssWidth = 4,
    cssHeight = 2,
    readOnlyDimensions = false,
  } = {}
) {
  const sourcePixels = new Uint8ClampedArray(imgWidth * imgHeight * 4);
  for (let y = 0; y < imgHeight; y++) {
    for (let x = 0; x < imgWidth; x++) {
      const [r, g, b, a = 255] = pixelFn(x, y);
      const idx = (y * imgWidth + x) * 4;
      sourcePixels[idx] = r;
      sourcePixels[idx + 1] = g;
      sourcePixels[idx + 2] = b;
      sourcePixels[idx + 3] = a;
    }
  }

  const createdImages = [];
  const createdCanvases = [];

  class FakeImage {
    constructor() {
      if (readOnlyDimensions) {
        this.naturalWidth = imgWidth;
        this.naturalHeight = imgHeight;
      } else if (naturalOnly) {
        this.width = cssWidth;
        this.height = cssHeight;
        this.naturalWidth = imgWidth;
        this.naturalHeight = imgHeight;
      } else {
        this.width = imgWidth;
        this.height = imgHeight;
      }
      this._src = '';
      this.onload = null;
      this.onerror = null;
      createdImages.push(this);
    }
    set src(v) {
      this._src = v;
      if (v) {
        setImmediate(() => {
          if (typeof v === 'string' && v.startsWith('error')) {
            this.onerror?.(new Error('Image load failed'));
          } else {
            this.onload?.();
          }
        });
      }
    }
    get src() {
      return this._src;
    }
  }

  if (readOnlyDimensions) {
    Object.defineProperty(FakeImage.prototype, 'width', {
      get() { return cssWidth; },
      configurable: true,
    });
    Object.defineProperty(FakeImage.prototype, 'height', {
      get() { return cssHeight; },
      configurable: true,
    });
  }

  class FakeCanvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this._pixels = new Uint8ClampedArray(0);
      this._putImageData = null;
      createdCanvases.push(this);
    }
    getContext(kind) {
      if (kind !== '2d') return null;
      const canvas = this;
      const ensureBuffer = () => {
        const needed = canvas.width * canvas.height * 4;
        if (canvas._pixels.length !== needed) {
          canvas._pixels = new Uint8ClampedArray(needed);
        }
      };
      const ctx = {
        clearRect() {
          ensureBuffer();
          canvas._pixels.fill(0);
        },
        drawImage(_img, ...args) {
          ensureBuffer();
          if (args.length === 2 || args.length === 4) {
            const dw = args.length === 4 ? args[2] : imgWidth;
            const dh = args.length === 4 ? args[3] : imgHeight;
            for (let y = 0; y < Math.min(dh, imgHeight); y++) {
              for (let x = 0; x < Math.min(dw, imgWidth); x++) {
                const sIdx = (y * imgWidth + x) * 4;
                const dIdx = (y * canvas.width + x) * 4;
                canvas._pixels.set(sourcePixels.subarray(sIdx, sIdx + 4), dIdx);
              }
            }
          } else if (args.length === 8) {
            const [sx, sy, sw, sh, dx, dy, dw, dh] = args;
            for (let y = 0; y < Math.min(sh, dh); y++) {
              for (let x = 0; x < Math.min(sw, dw); x++) {
                const srcX = sx + x;
                const srcY = sy + y;
                if (srcX >= 0 && srcX < imgWidth && srcY >= 0 && srcY < imgHeight) {
                  const sIdx = (srcY * imgWidth + srcX) * 4;
                  const dIdx = ((dy + y) * canvas.width + (dx + x)) * 4;
                  canvas._pixels.set(sourcePixels.subarray(sIdx, sIdx + 4), dIdx);
                }
              }
            }
          }
        },
        getImageData(x, y, w, h) {
          ensureBuffer();
          const out = new Uint8ClampedArray(w * h * 4);
          for (let row = 0; row < h; row++) {
            for (let col = 0; col < w; col++) {
              const sx = x + col;
              const sy = y + row;
              if (sx >= 0 && sx < canvas.width && sy >= 0 && sy < canvas.height) {
                const sIdx = (sy * canvas.width + sx) * 4;
                const dIdx = (row * w + col) * 4;
                out.set(canvas._pixels.subarray(sIdx, sIdx + 4), dIdx);
              }
            }
          }
          return new FakeImageData(out, w, h);
        },
      };
      if (withPutImageData) {
        ctx.putImageData = (imageData) => {
          canvas._putImageData = imageData;
          canvas.width = imageData.width;
          canvas.height = imageData.height;
          canvas._pixels = new Uint8ClampedArray(imageData.data);
        };
      }
      return ctx;
    }
  }

  global.Image = FakeImage;
  global.ImageData = FakeImageData;
  global.document = {
    createElement(tag) {
      if (tag === 'canvas') return new FakeCanvas();
      throw new Error(`Unexpected tag: ${tag}`);
    },
  };

  return { createdImages, createdCanvases, FakeImage, FakeCanvas };
}

function getDepthImageData(depth) {
  if (depth && depth._putImageData) {
    return depth._putImageData;
  }
  return depth;
}

function pixelAt(imageData, x, y) {
  const idx = (y * imageData.width + x) * 4;
  return [
    imageData.data[idx],
    imageData.data[idx + 1],
    imageData.data[idx + 2],
    imageData.data[idx + 3],
  ];
}

let savedGlobals;

test.beforeEach(() => {
  savedGlobals = {
    Image: global.Image,
    ImageData: global.ImageData,
    document: global.document,
    fetch: global.fetch,
  };
});

test.afterEach(() => {
  global.Image = savedGlobals.Image;
  global.ImageData = savedGlobals.ImageData;
  global.document = savedGlobals.document;
  global.fetch = savedGlobals.fetch;
});

// ============================================================================
// Unit Tests
// ============================================================================

test('1. Export parity: default export equals named parseRGBD and helpers are exported', () => {
  assert.strictEqual(parseRGBDDefault, parseRGBD);
  assert.equal(typeof normalizeRgbdType, 'function');
  assert.equal(typeof resolveRgbdLayout, 'function');
  assert.equal(typeof toDepthMap, 'function');
  assert.equal(typeof imageDataToCanvas, 'function');
});

test('2. Horizontal left-right / sbs / rgbd-left-right / rgbd-sbs slicing and coordinate verification', async () => {
  setupMockDOM(8, 4, (x, y) => {
    if (x < 4) return [10 + x, 100 + y, 200, 255];
    const g = 50 + (x - 4) * 30;
    return [g, g, g, 255];
  });

  for (const opts of [
    { layout: 'left-right' },
    { layout: 'sbs' },
    { type: 'rgbd-left-right' },
    { type: 'rgbd-sbs' },
  ]) {
    const res = await parseRGBD('picture.png', opts);
    assert.strictEqual(res.leftEye, res.rightEye);
    assert.equal(res.leftEye.width, 4);
    assert.equal(res.leftEye.height, 4);
    assert.deepStrictEqual(pixelAt(res.leftEye, 0, 0), [10, 100, 200, 255]);
    assert.deepStrictEqual(pixelAt(res.leftEye, 3, 2), [13, 102, 200, 255]);

    const depthData = getDepthImageData(res.depth);
    assert.equal(depthData.width, 4);
    assert.equal(depthData.height, 4);
    // Input x=4 -> 50 -> inverted 255 - 50 = 205; x=7 -> 140 -> inverted 255 - 140 = 115
    assert.deepStrictEqual(pixelAt(depthData, 0, 0), [205, 205, 205, 255]);
    assert.deepStrictEqual(pixelAt(depthData, 3, 1), [115, 115, 115, 255]);
  }
});

test('3. Horizontal right-left / rgbd-right-left places right half as color and left half as depth', async () => {
  setupMockDOM(8, 4, (x, y) => {
    if (x < 4) {
      const g = 20 + x * 40;
      return [g, g, g, 255];
    }
    return [40 + x, 80 + y, 160, 255];
  });

  for (const opts of [{ layout: 'right-left' }, { type: 'rgbd-right-left' }]) {
    const res = await parseRGBD('picture.png', opts);
    assert.strictEqual(res.leftEye, res.rightEye);
    assert.equal(res.leftEye.width, 4);
    assert.equal(res.leftEye.height, 4);
    assert.deepStrictEqual(pixelAt(res.leftEye, 0, 0), [44, 80, 160, 255]);
    assert.deepStrictEqual(pixelAt(res.leftEye, 3, 3), [47, 83, 160, 255]);

    const depthData = getDepthImageData(res.depth);
    // Input x=0 -> 20 -> inverted 235; x=3 -> 140 -> inverted 115
    assert.deepStrictEqual(pixelAt(depthData, 0, 0), [235, 235, 235, 255]);
    assert.deepStrictEqual(pixelAt(depthData, 3, 2), [115, 115, 115, 255]);
  }
});

test('4. Vertical top-bottom / ou / tb / rgbd-top-bottom / rgbd-ou / rgbd-tb slicing', async () => {
  setupMockDOM(4, 8, (x, y) => {
    if (y < 4) return [15 + x, 60 + y, 220, 255];
    const g = 30 + (y - 4) * 50;
    return [g, g, g, 255];
  });

  for (const opts of [
    { layout: 'top-bottom' },
    { layout: 'ou' },
    { layout: 'tb' },
    { type: 'rgbd-top-bottom' },
    { type: 'rgbd-ou' },
    { type: 'rgbd-tb' },
  ]) {
    const res = await parseRGBD('picture.png', opts);
    assert.strictEqual(res.leftEye, res.rightEye);
    assert.equal(res.leftEye.width, 4);
    assert.equal(res.leftEye.height, 4);
    assert.deepStrictEqual(pixelAt(res.leftEye, 2, 3), [17, 63, 220, 255]);

    const depthData = getDepthImageData(res.depth);
    assert.equal(depthData.width, 4);
    assert.equal(depthData.height, 4);
    // y=4 -> 30 -> inverted 225; y=7 -> 180 -> inverted 75
    assert.deepStrictEqual(pixelAt(depthData, 0, 0), [225, 225, 225, 255]);
    assert.deepStrictEqual(pixelAt(depthData, 1, 3), [75, 75, 75, 255]);
  }
});

test('5. Vertical bottom-top / rgbd-bottom-top places bottom half as color and top half as depth', async () => {
  setupMockDOM(4, 8, (x, y) => {
    if (y < 4) {
      const g = 10 + y * 50;
      return [g, g, g, 255];
    }
    return [30 + x, 90 + y, 180, 255];
  });

  for (const opts of [{ layout: 'bottom-top' }, { type: 'rgbd-bottom-top' }]) {
    const res = await parseRGBD('picture.png', opts);
    assert.strictEqual(res.leftEye, res.rightEye);
    assert.equal(res.leftEye.width, 4);
    assert.equal(res.leftEye.height, 4);
    assert.deepStrictEqual(pixelAt(res.leftEye, 1, 0), [31, 94, 180, 255]);
    assert.deepStrictEqual(pixelAt(res.leftEye, 3, 3), [33, 97, 180, 255]);

    const depthData = getDepthImageData(res.depth);
    // y=0 -> 10 -> inverted 245; y=3 -> 160 -> inverted 95
    assert.deepStrictEqual(pixelAt(depthData, 0, 0), [245, 245, 245, 255]);
    assert.deepStrictEqual(pixelAt(depthData, 2, 3), [95, 95, 95, 255]);
  }
});

test('6. Auto-layout ("rgbd" / omitted) selects horizontal for wide/square and vertical for tall', async () => {
  // Wide 8x4 -> left-right (4x4)
  setupMockDOM(8, 4, (x) => (x < 4 ? [100, 10, 20, 255] : [80, 80, 80, 255]));
  const wide = await parseRGBD('wide.png', { type: 'rgbd' });
  assert.equal(wide.leftEye.width, 4);
  assert.equal(wide.leftEye.height, 4);
  assert.deepStrictEqual(pixelAt(wide.leftEye, 0, 0), [100, 10, 20, 255]);

  // Tall 4x8 -> top-bottom (4x4)
  setupMockDOM(4, 8, (_x, y) => (y < 4 ? [50, 150, 250, 255] : [60, 60, 60, 255]));
  const tall = await parseRGBD('tall.png');
  assert.equal(tall.leftEye.width, 4);
  assert.equal(tall.leftEye.height, 4);
  assert.deepStrictEqual(pixelAt(tall.leftEye, 0, 0), [50, 150, 250, 255]);

  // Square 4x4 -> left-right (2x4)
  setupMockDOM(4, 4, (x) => (x < 2 ? [10, 200, 30, 255] : [40, 40, 40, 255]));
  const square = await parseRGBD('square.png', { type: 'rgbd' });
  assert.equal(square.leftEye.width, 2);
  assert.equal(square.leftEye.height, 4);
  assert.deepStrictEqual(pixelAt(square.leftEye, 0, 0), [10, 200, 30, 255]);
});

test('7. Chroma-tinted JPEG 4:2:0 depth pixels normalize via Rec. 601 luminance while color stays intact', async () => {
  setupMockDOM(4, 2, (x) => {
    if (x < 2) return [12, 34, 56, 255];
    if (x === 2) return [200, 100, 50, 255]; // luma = Math.round(124.2) = 124 -> inverted 131
    return [10, 240, 30, 128]; // luma = Math.round(147.29) = 147 -> inverted 108, alpha 128
  });

  const res = await parseRGBD('chroma.jpg', { type: 'rgbd-left-right' });
  assert.deepStrictEqual(pixelAt(res.leftEye, 0, 0), [12, 34, 56, 255]);
  assert.deepStrictEqual(pixelAt(res.leftEye, 1, 1), [12, 34, 56, 255]);

  const depthData = getDepthImageData(res.depth);
  assert.deepStrictEqual(pixelAt(depthData, 0, 0), [131, 131, 131, 255]);
  assert.deepStrictEqual(pixelAt(depthData, 1, 0), [108, 108, 108, 128]);
});

test('8. Depth polarity: default inverts disparity (255->0, 0->255) and opt-out preserves metric depth', async () => {
  setupMockDOM(4, 2, (x) => {
    if (x < 2) return [1, 2, 3, 255];
    if (x === 2) return [255, 255, 255, 255];
    return [0, 0, 0, 180];
  });

  // Default: standard RGB-D (255=near, 0=far) -> inverted to metric depth (0=near, 255=far)
  const defaultRes = await parseRGBD('default.png', { type: 'rgbd-left-right' });
  const defaultDepth = getDepthImageData(defaultRes.depth);
  assert.deepStrictEqual(pixelAt(defaultDepth, 0, 0), [0, 0, 0, 255]);
  assert.deepStrictEqual(pixelAt(defaultDepth, 1, 0), [255, 255, 255, 180]);

  // Opt-out via invertDepth: false
  const noInvertRes = await parseRGBD('noinvert.png', { type: 'rgbd-left-right', invertDepth: false });
  const noInvertDepth = getDepthImageData(noInvertRes.depth);
  assert.deepStrictEqual(pixelAt(noInvertDepth, 0, 0), [255, 255, 255, 255]);
  assert.deepStrictEqual(pixelAt(noInvertDepth, 1, 0), [0, 0, 0, 180]);

  // Opt-out via polarity: 'depth'
  const metricRes = await parseRGBD('metric.png', { type: 'rgbd-left-right', polarity: 'depth' });
  const metricDepth = getDepthImageData(metricRes.depth);
  assert.deepStrictEqual(pixelAt(metricDepth, 0, 0), [255, 255, 255, 255]);
  assert.deepStrictEqual(pixelAt(metricDepth, 1, 0), [0, 0, 0, 180]);
});

test('9. All-zero depth channel resolves cleanly with zero NaN values', async () => {
  setupMockDOM(8, 4, (x) => (x < 4 ? [20, 40, 60, 255] : [0, 0, 0, 255]));

  const resDefault = await parseRGBD('zeros.png', { layout: 'left-right' });
  const dDefault = getDepthImageData(resDefault.depth);
  assert.equal(dDefault.data.some(v => Number.isNaN(v)), false);
  assert.deepStrictEqual(pixelAt(dDefault, 0, 0), [255, 255, 255, 255]);

  const resMetric = await parseRGBD('zeros.png', { layout: 'left-right', polarity: 'depth' });
  const dMetric = getDepthImageData(resMetric.depth);
  assert.equal(dMetric.data.some(v => Number.isNaN(v)), false);
  assert.deepStrictEqual(pixelAt(dMetric, 0, 0), [0, 0, 0, 255]);
});

test('10. Odd dimensions (101x50 SBS & 50x101 TB) align slices to outer edges cleanly', async () => {
  // 101x50 SBS: left = 0..49, center ignored x=50, right = 51..100
  setupMockDOM(101, 50, (x) => {
    if (x < 50) return [x, 10, 20, 255];
    if (x === 50) return [255, 0, 255, 255]; // center seam column
    const g = x - 51; // 0..49
    return [g, g, g, 255];
  });
  const sbs = await parseRGBD('odd-sbs.png', { layout: 'left-right' });
  assert.equal(sbs.leftEye.width, 50);
  assert.equal(sbs.leftEye.height, 50);
  assert.deepStrictEqual(pixelAt(sbs.leftEye, 49, 0), [49, 10, 20, 255]);
  const sbsDepth = getDepthImageData(sbs.depth);
  assert.equal(sbsDepth.width, 50);
  assert.equal(sbsDepth.height, 50);
  // x=51 has g=0 -> inverted 255 (must NOT read center seam x=50!)
  assert.deepStrictEqual(pixelAt(sbsDepth, 0, 0), [255, 255, 255, 255]);
  assert.deepStrictEqual(pixelAt(sbsDepth, 49, 0), [206, 206, 206, 255]);

  // 50x101 TB: top = 0..49, center ignored y=50, bottom = 51..100
  setupMockDOM(50, 101, (_x, y) => {
    if (y < 50) return [10, y, 20, 255];
    if (y === 50) return [255, 0, 255, 255]; // center seam row
    const g = y - 51;
    return [g, g, g, 255];
  });
  const tb = await parseRGBD('odd-tb.png', { layout: 'top-bottom' });
  assert.equal(tb.leftEye.width, 50);
  assert.equal(tb.leftEye.height, 50);
  assert.deepStrictEqual(pixelAt(tb.leftEye, 0, 49), [10, 49, 20, 255]);
  const tbDepth = getDepthImageData(tb.depth);
  assert.equal(tbDepth.width, 50);
  assert.equal(tbDepth.height, 50);
  assert.deepStrictEqual(pixelAt(tbDepth, 0, 0), [255, 255, 255, 255]);
  assert.deepStrictEqual(pixelAt(tbDepth, 0, 49), [206, 206, 206, 255]);
});

test('11. 1x1 rejection on decoded Image AND PNG IHDR under 4x2 FakeImage', async () => {
  // Case A: decoded FakeImage is 1x1
  setupMockDOM(1, 1, () => [128, 128, 128, 255]);
  await assert.rejects(() => parseRGBD('tiny.png', { layout: 'left-right' }), /at least 2 pixels/);
  await assert.rejects(() => parseRGBD('tiny.png', { layout: 'top-bottom' }), /at least 2 pixels/);
  await assert.rejects(() => parseRGBD('tiny.png', { type: 'rgbd' }), /at least 2 pixels/);

  // Case B: 1x2 horizontal & 2x1 vertical
  setupMockDOM(1, 2, () => [128, 128, 128, 255]);
  await assert.rejects(() => parseRGBD('thin.png', { layout: 'left-right' }), /at least 2 pixels/);
  setupMockDOM(2, 1, () => [128, 128, 128, 255]);
  await assert.rejects(() => parseRGBD('flat.png', { layout: 'top-bottom' }), /at least 2 pixels/);

  // Case C: FakeImage reports 4x2, but PNG IHDR in data URL encodes 1x1
  setupMockDOM(4, 2, () => [128, 128, 128, 255]);
  const png1x1Url = toPngDataUrl(makePng(1, 1));
  await assert.rejects(() => parseRGBD(png1x1Url, { layout: 'left-right' }), /at least 2 pixels/);
  await assert.rejects(() => parseRGBD(png1x1Url, { layout: 'top-bottom' }), /at least 2 pixels/);
});

test('12. naturalWidth || naturalHeight precedence over CSS width/height (writable and read-only)', async () => {
  // Writable width/height differing from naturalWidth/naturalHeight
  setupMockDOM(
    8,
    4,
    (x, y) => (x < 4 ? [20 + x, 40 + y, 60, 255] : [100, 100, 100, 255]),
    { naturalOnly: true, cssWidth: 4, cssHeight: 2 }
  );
  const resWritable = await parseRGBD('natural.png', { layout: 'left-right' });
  assert.equal(resWritable.leftEye.width, 4);
  assert.equal(resWritable.leftEye.height, 4);
  assert.deepStrictEqual(pixelAt(resWritable.leftEye, 3, 3), [23, 43, 60, 255]);

  // Read-only width/height getters returning 4x2 while naturalWidth=8, naturalHeight=4
  setupMockDOM(
    8,
    4,
    (x, y) => (x < 4 ? [30 + x, 50 + y, 70, 255] : [90, 90, 90, 255]),
    { readOnlyDimensions: true, cssWidth: 4, cssHeight: 2 }
  );
  const resReadOnly = await parseRGBD('natural-ro.png', { layout: 'left-right' });
  assert.equal(resReadOnly.leftEye.width, 4);
  assert.equal(resReadOnly.leftEye.height, 4);
  assert.deepStrictEqual(pixelAt(resReadOnly.leftEye, 3, 3), [33, 53, 70, 255]);
});

test('13. imageDataToCanvas returns Canvas in DOM, ImageData when putImageData missing or document undefined', async () => {
  // Full DOM with putImageData -> Canvas with matching dimensions
  const { FakeCanvas } = setupMockDOM(8, 4, (x) => (x < 4 ? [10, 20, 30, 255] : [120, 120, 120, 255]), {
    withPutImageData: true,
  });
  const withCanvas = await parseRGBD('dom.png', { layout: 'left-right' });
  assert.ok(withCanvas.depth instanceof FakeCanvas);
  assert.equal(withCanvas.depth.width, 4);
  assert.equal(withCanvas.depth.height, 4);

  // Minimal canvas mock lacking putImageData -> ImageData fallback
  setupMockDOM(8, 4, (x) => (x < 4 ? [10, 20, 30, 255] : [120, 120, 120, 255]), {
    withPutImageData: false,
  });
  const withoutPut = await parseRGBD('minimal.png', { layout: 'left-right' });
  assert.ok(withoutPut.depth instanceof FakeImageData);
  assert.equal(withoutPut.depth.width, 4);
  assert.equal(withoutPut.depth.height, 4);

  // typeof document === 'undefined' -> imageDataToCanvas returns ImageData directly
  delete global.document;
  const rawImgData = new FakeImageData(new Uint8ClampedArray([10, 10, 10, 255]), 1, 1);
  assert.strictEqual(imageDataToCanvas(rawImgData), rawImgData);
});

test('14. Angles and projection contract: planar default phiLength < PI/2, angle="120", fisheye overridden', async () => {
  setupMockDOM(8, 4, (x) => (x < 4 ? [100, 120, 140, 255] : [80, 80, 80, 255]));

  const def = await parseRGBD('default.png', { layout: 'left-right' });
  assert.ok(def.phiLength > 0 && def.phiLength < Math.PI / 2);
  assert.ok(def.thetaLength > 0);
  assert.ok(Math.abs(def.thetaStart - (Math.PI / 2 - def.thetaLength / 2)) < 1e-9);
  assert.strictEqual(def.projection, undefined);

  const angledStr = await parseRGBD('angled.png', { layout: 'left-right', angle: '120' });
  assert.ok(Math.abs(angledStr.phiLength - (2 * Math.PI) / 3) < 1e-9);

  const angledNum = await parseRGBD('angled-num.png', { layout: 'left-right', angle: 120 });
  assert.ok(Math.abs(angledNum.phiLength - (2 * Math.PI) / 3) < 1e-9);

  const fisheyeReq = await parseRGBD('fisheye.png', { layout: 'left-right', projection: 'fisheye' });
  assert.strictEqual(fisheyeReq.projection, undefined);
  assert.ok(fisheyeReq.phiLength < Math.PI / 2);
});

test('15. <stereo-img> explicit type dispatch reuses picture.bytes() without extra fetch calls', async () => {
  setupMockDOM(8, 4, (x) => (x < 4 ? [20, 30, 40, 255] : [180, 180, 180, 255]));
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    throw new Error('fetch should not be called');
  };

  const pngBytes = makePng(8, 4);
  for (const type of ['rgbd', 'rgbd-sbs', 'rgbd-top-bottom', 'rgbd-right-left', 'rgbd-bottom-top', 'rgbd-ou']) {
    const picture = {
      url: 'https://example.invalid/explicit.png',
      objectURL: async () => 'blob:mock-explicit',
      bytes: async () => pngBytes,
    };
    const res = await StereoImg.prototype._parsePicture.call({}, picture, null, { type, signal: undefined });
    assert.ok(res.depth);
    assert.strictEqual(res.leftEye, res.rightEye);
    assert.strictEqual(res.projection, undefined);
  }
  assert.equal(fetchCalls, 0);
});

test('16. <stereo-img> rgbdTypeOfName auto-detection runs before _isStereo on color-vs-depth composites', async () => {
  // Left half red [255,0,0,255], right half dark gray [10,10,10,255]: mean diff >> 25 so _isStereo would return false
  setupMockDOM(8, 4, (x, y) => {
    if (x < 4 && y < 2) return [255, 0, 0, 255];
    if (x >= 4 && y >= 2) return [10, 10, 10, 255];
    return x < 4 ? [255, 0, 0, 255] : [10, 10, 10, 255];
  });

  let isStereoCalled = false;
  const fakeInstance = {
    async _isStereo() {
      isStereoCalled = true;
      return false;
    },
  };

  const pngBytes = makePng(8, 4);
  for (const url of [
    'https://example.com/scene_rgbd.png',
    'https://example.com/scene_rgbd_tb.png?v=1',
    'https://example.com/frame_color_depth_ou.jpg',
    'https://example.com/sample_rgbd_rl.png',
  ]) {
    const picture = {
      url,
      objectURL: async () => 'blob:mock-auto',
      bytes: async () => pngBytes,
    };
    const res = await StereoImg.prototype._parsePicture.call(fakeInstance, picture, null, { signal: undefined });
    assert.ok(res.depth, `Expected depth map for ${url}`);
    assert.strictEqual(res.leftEye, res.rightEye);
  }
  assert.equal(isStereoCalled, false, '_isStereo must not be invoked when rgbdTypeOfName matches');
});

test('17. rgbdTypeOfName positive, negative, data:/blob: URI, and substring false-positive tests', () => {
  // Negative / false-positive guards
  assert.equal(rgbdTypeOfName('https://example.com/foo_tb_bar.jpg'), undefined);
  assert.equal(rgbdTypeOfName('https://example.com/walrus-360.top-bottom.jpg'), undefined);
  assert.equal(rgbdTypeOfName('data:image/png;base64,AAAA_rgbd_tb'), undefined);
  assert.equal(rgbdTypeOfName('blob:https://example.com/rgbd-tb-1234'), undefined);
  assert.equal(rgbdTypeOfName(null), undefined);

  // Word-boundary check: "mountain" contains "ou", must NOT match rgbd-top-bottom
  assert.equal(rgbdTypeOfName('https://example.com/mountain_rgbd.jpg'), 'rgbd');

  // Positive mappings
  assert.equal(rgbdTypeOfName('https://example.com/scene_rgbd.png'), 'rgbd');
  assert.equal(rgbdTypeOfName('https://example.com/scene_rgb-d_sbs.png'), 'rgbd-left-right');
  assert.equal(rgbdTypeOfName('https://example.com/scene_rgb_depth_lr.png'), 'rgbd-left-right');
  assert.equal(rgbdTypeOfName('https://example.com/scene_color-depth_rl.png'), 'rgbd-right-left');
  assert.equal(rgbdTypeOfName('https://example.com/scene_rgbd_tb.png?v=1'), 'rgbd-top-bottom');
  assert.equal(rgbdTypeOfName('https://example.com/scene_rgbd_ou.png'), 'rgbd-top-bottom');
  assert.equal(rgbdTypeOfName('https://example.com/scene_rgbd_bottom-top.png'), 'rgbd-bottom-top');
  assert.equal(rgbdTypeOfName('https://example.com/scene_rgbd_bt.png'), 'rgbd-bottom-top');
});

test('18. AbortSignal pre-aborted rejects with AbortError before creating Image or Canvas', async () => {
  const { createdImages, createdCanvases } = setupMockDOM(8, 4, () => [0, 0, 0, 255]);
  const signal = AbortSignal.abort();
  await assert.rejects(
    () => parseRGBD('picture.png', { signal }),
    (err) => err?.name === 'AbortError'
  );
  assert.equal(createdImages.length, 0);
  assert.equal(createdCanvases.length, 0);
});

test('19. AbortSignal hanging-image abort clears handlers/src, and normal load removes abort listener', async () => {
  setupMockDOM(8, 4, (x) => (x < 4 ? [10, 20, 30, 255] : [100, 100, 100, 255]));

  // Hanging image abort
  let hangingImg;
  class HangingImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.src = '';
      hangingImg = this;
    }
  }
  const SavedImage = global.Image;
  global.Image = HangingImage;

  const controller = new AbortController();
  const customReason = new DOMException('Custom abort reason', 'AbortError');
  const promise = parseRGBD('hanging.png', { signal: controller.signal });
  setImmediate(() => controller.abort(customReason));
  await assert.rejects(promise, (err) => err === customReason);
  assert.strictEqual(hangingImg.onload, null);
  assert.strictEqual(hangingImg.onerror, null);
  assert.strictEqual(hangingImg.src, '');

  // Normal load removes abort listener
  global.Image = SavedImage;
  let removedListeners = 0;
  const ctrl2 = new AbortController();
  const origRemove = ctrl2.signal.removeEventListener.bind(ctrl2.signal);
  ctrl2.signal.removeEventListener = (type, listener, options) => {
    if (type === 'abort') removedListeners++;
    return origRemove(type, listener, options);
  };
  await parseRGBD('normal.png', { signal: ctrl2.signal });
  assert.equal(removedListeners, 1);
});

test('20. <stereo-img> explicit type="rgbd-tb" dispatches to parseRGBD top-bottom without mono fallback', async () => {
  setupMockDOM(4, 8, (x, y) => {
    if (y < 4) return [15 + x, 60 + y, 220, 255];
    const g = 40 + (y - 4) * 50;
    return [g, g, g, 255];
  });
  const pngBytes = makePng(4, 8);
  const picture = {
    url: 'https://example.invalid/composite.png',
    objectURL: async () => 'blob:mock-rgbd-tb',
    bytes: async () => pngBytes,
  };
  let isStereoCalled = false;
  const fakeInstance = {
    async _isStereo() {
      isStereoCalled = true;
      return false;
    },
  };
  const res = await StereoImg.prototype._parsePicture.call(fakeInstance, picture, null, {
    type: 'rgbd-tb',
    signal: undefined,
  });
  assert.ok(res.depth, 'type="rgbd-tb" must produce a depth map');
  assert.strictEqual(res.leftEye, res.rightEye);
  assert.equal(res.leftEye.width, 4);
  assert.equal(res.leftEye.height, 4);
  assert.deepStrictEqual(pixelAt(res.leftEye, 2, 3), [17, 63, 220, 255]);
  const depthData = getDepthImageData(res.depth);
  assert.deepStrictEqual(pixelAt(depthData, 0, 0), [215, 215, 215, 255]);
  assert.equal(isStereoCalled, false);
});

test('21. <stereo-img> auto-detection flattens unmerged EXIF FocalLengthIn35mmFormat=50 to match direct parseRGBD', async () => {
  setupMockDOM(8, 4, (x) => (x < 4 ? [100, 120, 140, 255] : [80, 80, 80, 255]));
  const jpegBytes = makeExifJpeg(50);

  const direct = await parseRGBD('photo_rgbd.jpg', { type: 'rgbd', bytes: jpegBytes });
  const fallback27 = await parseRGBD('photo_rgbd.jpg', { type: 'rgbd' });
  assert.ok(Math.abs(direct.phiLength - fallback27.phiLength) > 0.2, '50mm FOV must differ from 27mm fallback');

  const picture = {
    url: 'https://example.com/photo_rgbd.jpg',
    objectURL: async () => 'blob:mock-exif-jpg',
    bytes: async () => jpegBytes,
  };
  const fakeInstance = {
    async _isStereo() {
      return false;
    },
  };
  const autoRes = await StereoImg.prototype._parsePicture.call(fakeInstance, picture, null, {
    signal: undefined,
  });
  assert.ok(autoRes.depth);
  assert.ok(Math.abs(autoRes.phiLength - direct.phiLength) < 1e-12);

  // Explicit top-level EXIF tags still override nested exif.exif / exif.ifd0 tags
  const explicitOverride = await parseRGBD('override.jpg', {
    type: 'rgbd',
    exif: { ifd0: { FocalLengthIn35mmFormat: 24 }, exif: { FocalLengthIn35mmFormat: 35 }, FocalLengthIn35mmFormat: 50 },
  });
  assert.ok(Math.abs(explicitOverride.phiLength - direct.phiLength) < 1e-12);
});

test('22. imageDataToCanvas safely returns degenerate null, undefined, and 0-dimension ImageData without putImageData', () => {
  let putImageDataCalled = false;
  global.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`Unexpected tag: ${tag}`);
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            putImageData(imgData) {
              putImageDataCalled = true;
              if (!imgData || imgData.width <= 0 || imgData.height <= 0) {
                throw new DOMException('Invalid ImageData dimensions', 'IndexSizeError');
              }
            },
          };
        },
      };
    },
  };

  assert.strictEqual(imageDataToCanvas(null), null);
  assert.strictEqual(imageDataToCanvas(undefined), undefined);

  const zeroDim = new FakeImageData(new Uint8ClampedArray(0), 0, 0);
  assert.strictEqual(imageDataToCanvas(zeroDim), zeroDim);
  const zeroWidth = new FakeImageData(new Uint8ClampedArray(0), 0, 4);
  assert.strictEqual(imageDataToCanvas(zeroWidth), zeroWidth);
  const nanDim = { width: Number.NaN, height: 4, data: new Uint8ClampedArray(0) };
  assert.strictEqual(imageDataToCanvas(nanDim), nanDim);

  assert.equal(putImageDataCalled, false);
});

test('23. rgbdTypeOfName handles %20-encoded spaces and case-insensitive DATA:/BLOB: URI rejection', () => {
  assert.equal(rgbdTypeOfName('https://example.com/my%20rgbd%20top%20bottom.png'), 'rgbd-top-bottom');
  assert.equal(rgbdTypeOfName('https://example.com/my%20rgb%20depth%20left%20right.png'), 'rgbd-left-right');
  assert.equal(rgbdTypeOfName('https://example.com/my%20rgb%20d%20bottom%20top.png'), 'rgbd-bottom-top');
  assert.equal(rgbdTypeOfName('https://example.com/my%20color%20depth%20right%20left.png'), 'rgbd-right-left');

  assert.equal(rgbdTypeOfName('DATA:image/png;base64,rgbd_sbs'), undefined);
  assert.equal(rgbdTypeOfName('Data:image/png;base64,rgbd_tb'), undefined);
  assert.equal(rgbdTypeOfName('BLOB:https://example.com/rgbd-tb'), undefined);
  assert.equal(rgbdTypeOfName('Blob:https://example.com/rgbd-sbs'), undefined);
});

test('24. Data URI PNG with newline/whitespace without options.bytes avoids fetch and parses embedded eXIf metadata', async () => {
  setupMockDOM(8, 4, (x) => (x < 4 ? [100, 120, 140, 255] : [80, 80, 80, 255]));
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    throw new Error('fetch must not be called for PNG data URI');
  };
  const pngBytes = makePng(8, 4, [pngChunk('eXIf', makeExifTiff(50))]);
  const base64 = Buffer.from(pngBytes).toString('base64');
  // Include leading spaces and newline inside base64 prefix to verify prefix scanning & full decode
  const spacedDataUrl = `data:image/png;base64,  ${base64.slice(0, 16)}\n${base64.slice(16)}`;

  const withBytes = await parseRGBD(spacedDataUrl, { type: 'rgbd-left-right', bytes: pngBytes });
  const withoutBytes = await parseRGBD(spacedDataUrl, { type: 'rgbd-left-right' });

  assert.equal(fetchCalls, 0);
  assert.ok(Math.abs(withoutBytes.phiLength - withBytes.phiLength) < 1e-12);
  const default27 = await parseRGBD('plain.png', { type: 'rgbd-left-right' });
  assert.ok(Math.abs(withoutBytes.phiLength - default27.phiLength) > 0.2);
});

test('25. Newline-wrapped and 120-space-padded 1x1 PNG data URIs reject via IHDR before creating Image when fetch is undefined', async () => {
  const { createdImages } = setupMockDOM(8, 4, (x) => (x < 4 ? [10, 20, 30, 255] : [100, 100, 100, 255]));
  global.fetch = undefined;

  const png1x1 = makePng(1, 1);
  const b64 = Buffer.from(png1x1).toString('base64');

  const newlineWrapped = `data:image/png;base64,${b64.slice(0, 16)}\n${b64.slice(16)}`;
  const spacePadded = `data:image/png;base64,${' '.repeat(120)}${b64.slice(0, 16)}\n${b64.slice(16)}`;
  const paramPadded = `DATA:IMAGE/PNG;CHARSET=UTF-8;BASE64,${' '.repeat(120)}${b64}`;

  for (const dataUrl of [newlineWrapped, spacePadded, paramPadded]) {
    await assert.rejects(
      () => parseRGBD(dataUrl, { type: 'rgbd-left-right' }),
      /at least 2 pixels/
    );
  }
  assert.equal(createdImages.length, 0);
});

test('26. Uppercase DATA:, parameterized MIME, and >65KB PNG data URIs extract eXIf 50mm FOV without options.bytes', async () => {
  setupMockDOM(8, 4, (x) => (x < 4 ? [100, 120, 140, 255] : [80, 80, 80, 255]));
  global.fetch = undefined;

  const smallPng = makePng(8, 4, [pngChunk('eXIf', makeExifTiff(50))]);
  const smallB64 = Buffer.from(smallPng).toString('base64');
  const expected50mm = await parseRGBD('ref.png', { type: 'rgbd-left-right', bytes: smallPng });

  // Construct > 65 KB PNG with 70000-byte IDAT preceding eXIf chunk
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 8, false);
  ihdrView.setUint32(4, 4, false);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const largeChunks = [
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', new Uint8Array(70000)),
    pngChunk('eXIf', makeExifTiff(50)),
    pngChunk('IEND'),
  ];
  const largePng = new Uint8Array(largeChunks.reduce((s, c) => s + c.length, 0));
  let offset = 0;
  for (const c of largeChunks) {
    largePng.set(c, offset);
    offset += c.length;
  }
  const largeB64 = Buffer.from(largePng).toString('base64');

  const variants = [
    `DATA:IMAGE/PNG;BASE64,${smallB64}`,
    `data:image/png;charset=utf-8;base64,${smallB64}`,
    `data:image/png;base64,${largeB64}`,
  ];

  for (const url of variants) {
    const res = await parseRGBD(url, { type: 'rgbd-left-right' });
    assert.ok(
      Math.abs(res.phiLength - expected50mm.phiLength) < 1e-12,
      `Expected ~0.577886 rad (50mm) for ${url.slice(0, 40)}, got ${res.phiLength}`
    );
  }
});

test('27. normalizedExif does not overwrite nested exif.exif/ifd0 tags with explicit top-level undefined', async () => {
  setupMockDOM(8, 4, (x) => (x < 4 ? [100, 120, 140, 255] : [80, 80, 80, 255]));
  const jpeg50 = makeExifJpeg(50);
  const expected50mm = await parseRGBD('ref.jpg', { type: 'rgbd-left-right', bytes: jpeg50 });

  const withUndefinedTop = await parseRGBD('test.jpg', {
    type: 'rgbd-left-right',
    exif: {
      FocalLengthIn35mmFormat: undefined,
      exif: { FocalLengthIn35mmFormat: 50 },
    },
  });
  assert.ok(Math.abs(withUndefinedTop.phiLength - expected50mm.phiLength) < 1e-12);

  const withUndefinedExifSub = await parseRGBD('test2.jpg', {
    type: 'rgbd-left-right',
    exif: {
      ifd0: { FocalLengthIn35mmFormat: 50 },
      exif: { FocalLengthIn35mmFormat: undefined },
    },
  });
  assert.ok(Math.abs(withUndefinedExifSub.phiLength - expected50mm.phiLength) < 1e-12);
});

test('28. rgbdTypeOfName handles consecutive %20%20 spaces and leading-whitespace data:/blob: rejection', () => {
  assert.equal(rgbdTypeOfName('https://example.com/my%20%20rgbd%20%20top%20%20bottom.png'), 'rgbd-top-bottom');
  assert.equal(rgbdTypeOfName('https://example.com/my%20%20rgb%20%20depth%20%20left%20%20right.png'), 'rgbd-left-right');
  assert.equal(rgbdTypeOfName('https://example.com/my%20%20rgb%20%20d%20%20bottom%20%20top.png'), 'rgbd-bottom-top');
  assert.equal(rgbdTypeOfName('https://example.com/my%20%20color%20%20depth%20%20right%20%20left.png'), 'rgbd-right-left');

  assert.equal(rgbdTypeOfName(' data:rgbd_sbs'), undefined);
  assert.equal(rgbdTypeOfName('  DATA:image/png;base64,rgbd_tb'), undefined);
  assert.equal(rgbdTypeOfName('\tblob:https://example.com/rgbd-tb'), undefined);
});

test('29. parseRGBD validates URL upfront, normalizes non-Error image.onerror events, and rejects truncated PNGs without IEND', async () => {
  const { createdImages } = setupMockDOM(8, 4, (x) => (x < 4 ? [10, 20, 30, 255] : [100, 100, 100, 255]));
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    return { ok: false, status: 404 };
  };

  for (const badUrl of [null, undefined, '', '   ', 123]) {
    await assert.rejects(
      () => parseRGBD(badUrl),
      (err) => err instanceof Error && /Invalid or missing URL/i.test(err.message)
    );
  }
  assert.equal(fetchCalls, 0);
  assert.equal(createdImages.length, 0);

  // Non-Error DOM Event passed to image.onerror must reject with an Error instance
  const SavedImage = global.Image;
  global.Image = class EventErrorImage {
    set src(v) {
      if (v) {
        setImmediate(() => this.onerror?.({ type: 'error' }));
      }
    }
  };
  await assert.rejects(
    () => parseRGBD('https://example.invalid/missing.png'),
    (err) => err instanceof Error && /Failed to load RGB-D image/i.test(err.message)
  );

  // Truncated PNG (signature + IHDR + partial IDAT, missing IEND) rejects even if Image.onload would fire
  global.Image = SavedImage;
  const fullPng = makePng(8, 4);
  const truncatedPng = fullPng.subarray(0, fullPng.length - 12); // strip IEND chunk
  const truncatedDataUrl = toPngDataUrl(truncatedPng);

  await assert.rejects(
    () => parseRGBD('https://example.invalid/trunc.png', { bytes: truncatedPng }),
    (err) => err instanceof Error && /missing IEND chunk/i.test(err.message)
  );
  await assert.rejects(
    () => parseRGBD(truncatedDataUrl, { type: 'rgbd-left-right' }),
    (err) => err instanceof Error && /missing IEND chunk/i.test(err.message)
  );

  global.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => truncatedPng.buffer.slice(truncatedPng.byteOffset, truncatedPng.byteOffset + truncatedPng.byteLength),
  });
  await assert.rejects(
    () => parseRGBD('https://example.invalid/trunc-fetch.png'),
    (err) => err instanceof Error && /missing IEND chunk/i.test(err.message)
  );

  // Zero naturalWidth/naturalHeight even with non-zero CSS width/height must reject
  setupMockDOM(0, 0, () => [0, 0, 0, 0], { naturalOnly: true, cssWidth: 8, cssHeight: 4 });
  global.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => parseRGBD('https://example.invalid/zero-natural.png'),
    (err) => err instanceof Error && /missing IEND chunk/i.test(err.message)
  );
});
