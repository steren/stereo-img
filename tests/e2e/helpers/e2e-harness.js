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

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../..');

/**
 * Mock ImageData adhering to browser ImageData interface.
 */
export class FakeImageData {
  /**
   * @param {number|Uint8ClampedArray} dataOrWidth
   * @param {number} widthOrHeight
   * @param {number} [height]
   */
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

/**
 * Mock Image element adhering to browser HTMLImageElement interface.
 */
export class FakeImage {
  constructor() {
    this.width = 4;
    this.height = 2;
    this._src = '';
    this.onload = null;
    this.onerror = null;
    this.crossOrigin = null;
  }

  set src(value) {
    this._src = value;
    if (value) {
      if (value.startsWith('error') || value === 'corrupt') {
        setImmediate(() => this.onerror?.(new Error('Failed to load image: ' + value)));
      } else {
        setImmediate(() => this.onload?.());
      }
    }
  }

  get src() {
    return this._src;
  }
}

/**
 * Mock 2D Canvas Context.
 */
export class FakeCanvasRenderingContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this._pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    // Fill with default white/non-black so it is not mistaken for circular fisheye background
    this._pixels.fill(255);
  }

  drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight) {
    // If image has data or dimensions, record or simulate copy
    if (image?.width && image?.height) {
      this.canvas.width = Math.max(this.canvas.width, image.width);
      this.canvas.height = Math.max(this.canvas.height, image.height);
    }
  }

  getImageData(x, y, w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const targetIdx = (j * w + i) * 4;
        const srcX = Math.min(x + i, this.canvas.width - 1);
        const srcY = Math.min(y + j, this.canvas.height - 1);
        const srcIdx = (srcY * this.canvas.width + srcX) * 4;
        data[targetIdx] = this._pixels[srcIdx] ?? 255;
        data[targetIdx + 1] = this._pixels[srcIdx + 1] ?? 255;
        data[targetIdx + 2] = this._pixels[srcIdx + 2] ?? 255;
        data[targetIdx + 3] = this._pixels[srcIdx + 3] ?? 255;
      }
    }
    return new FakeImageData(data, w, h);
  }

  putImageData(imageData, dx, dy) {
    // Simulated putImageData
  }

  clearRect(x, y, w, h) {}
  fillRect(x, y, w, h) {}
  beginPath() {}
  closePath() {}
  arc() {}
  fill() {}
  stroke() {}
}

/**
 * Mock HTML Canvas element.
 */
export class FakeHTMLCanvasElement {
  constructor(width = 4, height = 2) {
    this.width = width;
    this.height = height;
    this._context = new FakeCanvasRenderingContext2D(this);
  }

  getContext(type, options) {
    if (type === '2d') {
      return this._context;
    }
    return null;
  }

  toDataURL(type = 'image/png') {
    return 'data:' + type + ';base64,AAAA';
  }
}

/**
 * Mock HTMLElement base class for Node.js test environment.
 */
export class FakeHTMLElement {
  constructor() {
    this._attributes = new Map();
    this.style = {};
    this._listeners = new Map();
    this.shadowRoot = null;
    this.ownerDocument = global.document;
  }

  getAttribute(name) {
    return this._attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    const oldValue = this.getAttribute(name);
    const strVal = String(value);
    this._attributes.set(name, strVal);
    if (this.attributeChangedCallback) {
      const observed = this.constructor.observedAttributes || [];
      if (observed.includes(name)) {
        this.attributeChangedCallback(name, oldValue, strVal);
      }
    }
  }

  removeAttribute(name) {
    const oldValue = this.getAttribute(name);
    this._attributes.delete(name);
    if (this.attributeChangedCallback && oldValue !== null) {
      const observed = this.constructor.observedAttributes || [];
      if (observed.includes(name)) {
        this.attributeChangedCallback(name, oldValue, null);
      }
    }
  }

  hasAttribute(name) {
    return this._attributes.has(name);
  }

  attachShadow(options = {}) {
    this.shadowRoot = {
      querySelector: () => null,
      querySelectorAll: () => [],
      appendChild: (node) => node,
      removeChild: (node) => node,
      adoptedStyleSheets: [],
      innerHTML: '',
    };
    return this.shadowRoot;
  }

  addEventListener(type, listener) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    if (this._listeners.has(type)) {
      this._listeners.get(type).delete(listener);
    }
  }

  dispatchEvent(event) {
    const type = event?.type || String(event);
    const set = this._listeners.get(type);
    if (set) {
      for (const listener of set) {
        try {
          if (typeof listener === 'function') {
            listener.call(this, event);
          } else if (listener?.handleEvent) {
            listener.handleEvent(event);
          }
        } catch (e) {
          console.error('Error in event listener:', e);
        }
      }
    }
    return true;
  }

  connectedCallback() {}
  disconnectedCallback() {}
}

/**
 * Mock CSSStyleSheet.
 */
export class FakeCSSStyleSheet {
  constructor() {
    this.cssRules = [];
  }
  replaceSync(text) {}
  async replace(text) {}
}

let savedGlobals = null;
const customElementRegistry = new Map();

/**
 * Setup a lightweight, robust browser DOM environment on `global`.
 */
export function setupDOMEnvironment() {
  if (savedGlobals) {
    return; // Already set up
  }

  savedGlobals = {
    HTMLElement: global.HTMLElement,
    customElements: global.customElements,
    CSSStyleSheet: global.CSSStyleSheet,
    window: global.window,
    document: global.document,
    Image: global.Image,
    ImageData: global.ImageData,
  };

  global.ImageData = FakeImageData;
  global.Image = FakeImage;
  global.HTMLElement = FakeHTMLElement;
  global.CSSStyleSheet = FakeCSSStyleSheet;

  global.customElements = {
    define: (name, constructor) => {
      customElementRegistry.set(name, constructor);
    },
    get: (name) => customElementRegistry.get(name),
    whenDefined: async (name) => customElementRegistry.get(name),
  };

  global.document = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        return new FakeHTMLCanvasElement();
      }
      if (tag === 'img') {
        return new FakeImage();
      }
      return {
        style: {},
        setAttribute: () => {},
        getAttribute: () => null,
        appendChild: (n) => n,
        removeChild: (n) => n,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    },
    head: { appendChild: () => {}, removeChild: () => {} },
    body: { appendChild: () => {}, removeChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  global.window = global;
  if (!global.location) {
    global.location = { href: 'http://localhost/' };
  }
}

/**
 * Teardown the mock DOM environment and restore previous globals.
 */
export function teardownDOMEnvironment() {
  if (!savedGlobals) {
    return;
  }

  global.HTMLElement = savedGlobals.HTMLElement;
  global.customElements = savedGlobals.customElements;
  global.CSSStyleSheet = savedGlobals.CSSStyleSheet;
  global.window = savedGlobals.window;
  global.document = savedGlobals.document;
  global.Image = savedGlobals.Image;
  global.ImageData = savedGlobals.ImageData;

  savedGlobals = null;
}

/**
 * Dynamically import a parser module if it exists.
 * Returns null if the parser module does not exist on disk.
 *
 * @param {string} formatName - e.g. 'jps', 'png', 'heic', 'depth', 'rgbd', 'avif', 'quilt', 'wiggle', 'cameras'
 * @returns {Promise<Object|null>} The imported module or null.
 */
export async function getParser(formatName) {
  const norm = formatName.toLowerCase();
  const parserMap = {
    'jps': 'parsers/jps-parser/jps-parser.js',
    'png': 'parsers/png-parser/png-parser.js',
    'pns': 'parsers/png-parser/png-parser.js',
    'heic': 'parsers/heic-parser/heic-parser.js',
    'depth': 'parsers/depth-parser/depth-parser.js',
    'rgbd': 'parsers/rgbd-parser/rgbd-parser.js',
    'avif': 'parsers/avif-parser/avif-parser.js',
    'quilt': 'parsers/quilt-parser/quilt-parser.js',
    'wiggle': 'parsers/wiggle-parser/wiggle-parser.js',
    'stereo': 'parsers/stereo-parser/stereo-parser.js',
    'mpo': 'parsers/mpo-parser/mpo-parser.js',
    'mono': 'parsers/mono-parser/mono-parser.js',
    'vr': 'parsers/vr-parser/vr-parser.js',
    'lif': 'parsers/lif-parser/lif-parser.js',
    'anaglyph': 'parsers/anaglyph-parser/anaglyph-parser.js',
    'cameras': 'parsers/stereo-parser/cameras.js',
  };

  const relativePath = parserMap[norm] || `parsers/${norm}-parser/${norm}-parser.js`;
  const fullPath = resolve(PROJECT_ROOT, relativePath);

  if (!existsSync(fullPath)) {
    return null;
  }

  try {
    const mod = await import('file://' + fullPath);
    return mod;
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      return null;
    }
    throw err;
  }
}

/**
 * Validate that an object or value represents valid visual image/canvas content.
 * @param {*} val
 * @returns {boolean}
 */
export function isVisualContent(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') {
    return val.startsWith('data:image/') ||
           val.startsWith('blob:') ||
           /^https?:\/\//i.test(val) ||
           /^[./\w-]+\.(jpg|jpeg|png|heic|avif|webp|gif|jps|pns)/i.test(val);
  }
  if (typeof val === 'object') {
    if (typeof val.width === 'number' && typeof val.height === 'number' && val.width > 0 && val.height > 0) {
      if (val.data && (ArrayBuffer.isView(val.data) || typeof val.data.length === 'number')) {
        return true;
      }
      if (typeof val.src === 'string') {
        return true;
      }
      if (typeof val.getContext === 'function') {
        return true;
      }
    }
    if (val instanceof FakeImageData || val instanceof FakeImage || val instanceof FakeHTMLCanvasElement) {
      return true;
    }
  }
  return false;
}

/**
 * Validate that an object satisfies the StereoData interface contract.
 *
 * @param {Object} actual - The parsed output to validate.
 * @param {Object} [expected] - Expected properties.
 */
export function assertStereoData(actual, expected = {}) {
  assert.ok(actual, 'StereoData must be a non-null object');
  assert.equal(typeof actual, 'object', 'StereoData must be an object');

  // Verify leftEye and rightEye exist
  assert.ok(actual.leftEye !== undefined && actual.leftEye !== null, 'StereoData.leftEye must exist');
  assert.ok(actual.rightEye !== undefined && actual.rightEye !== null, 'StereoData.rightEye must exist');
  assert.ok(isVisualContent(actual.leftEye), `StereoData.leftEye must be valid visual content (ImageData, Image, canvas, or URL), got ${typeof actual.leftEye}`);
  assert.ok(isVisualContent(actual.rightEye), `StereoData.rightEye must be valid visual content (ImageData, Image, canvas, or URL), got ${typeof actual.rightEye}`);

  // Verify field of view angles in radians: strictly positive bounds
  assert.equal(typeof actual.phiLength, 'number', 'StereoData.phiLength must be a number');
  assert.ok(actual.phiLength > 0, `phiLength (${actual.phiLength}) must be strictly positive`);
  assert.ok(actual.phiLength <= 2 * Math.PI + 1e-4, `phiLength (${actual.phiLength}) must be <= 2*pi`);

  assert.equal(typeof actual.thetaLength, 'number', 'StereoData.thetaLength must be a number');
  assert.ok(actual.thetaLength > 0, `thetaLength (${actual.thetaLength}) must be strictly positive`);
  assert.ok(actual.thetaLength <= Math.PI + 1e-4, `thetaLength (${actual.thetaLength}) must be <= pi`);

  assert.equal(typeof actual.thetaStart, 'number', 'StereoData.thetaStart must be a number');

  // Verify symmetrical vertical centering around equator
  const expectedThetaStart = Math.PI / 2 - actual.thetaLength / 2;
  const diff = Math.abs(actual.thetaStart - expectedThetaStart);
  assert.ok(diff < 1e-3, `thetaStart (${actual.thetaStart}) expected near ${expectedThetaStart} (diff ${diff})`);

  // Check expected property assertions
  if (expected.projection !== undefined) {
    assert.equal(actual.projection, expected.projection, `Expected projection ${expected.projection}, got ${actual.projection}`);
  }

  if (expected.hasDepth !== undefined) {
    assert.equal(Boolean(actual.depth), expected.hasDepth, `Expected depth presence to be ${expected.hasDepth}`);
    if (expected.hasDepth) {
      assert.ok(isVisualContent(actual.depth), 'StereoData.depth must be valid visual content when present');
    }
  }

  if (expected.phiLength !== undefined) {
    const diff = Math.abs(actual.phiLength - expected.phiLength);
    assert.ok(diff < 1e-3, `phiLength mismatch: expected ${expected.phiLength}, got ${actual.phiLength} (diff ${diff})`);
  }

  if (expected.thetaLength !== undefined) {
    const diff = Math.abs(actual.thetaLength - expected.thetaLength);
    assert.ok(diff < 1e-3, `thetaLength mismatch: expected ${expected.thetaLength}, got ${actual.thetaLength} (diff ${diff})`);
  }

  if (expected.roll !== undefined) {
    const diff = Math.abs(actual.roll - expected.roll);
    assert.ok(diff < 1e-3, `roll mismatch: expected ${expected.roll}, got ${actual.roll}`);
  }

  if (expected.pitch !== undefined) {
    const diff = Math.abs(actual.pitch - expected.pitch);
    assert.ok(diff < 1e-3, `pitch mismatch: expected ${expected.pitch}, got ${actual.pitch}`);
  }

  if (expected.aspectRatio !== undefined) {
    let actualRatio;
    if (typeof actual.aspectRatio === 'number') {
      actualRatio = actual.aspectRatio;
    } else if (actual.leftEye?.width && actual.leftEye?.height) {
      actualRatio = actual.leftEye.width / actual.leftEye.height;
    } else if (actual.phiLength > 0 && actual.thetaLength > 0) {
      actualRatio = actual.phiLength / actual.thetaLength;
    }
    assert.ok(actualRatio !== undefined, 'Cannot verify aspect ratio: actual stereo data has no discernible dimensions');
    const diff = Math.abs(actualRatio - expected.aspectRatio);
    assert.ok(diff < 1e-2, `Aspect ratio mismatch: expected ${expected.aspectRatio}, got ${actualRatio} (diff ${diff})`);
  }
}

/**
 * Load an authentic asset from the examples/ directory.
 *
 * @param {string} name - Filename in examples/
 * @returns {{ bytes: Uint8Array, buffer: Buffer, dataUrl: string, name: string, path: string }}
 */
export function loadExampleAsset(name) {
  const assetPath = resolve(PROJECT_ROOT, 'examples', name);
  if (!existsSync(assetPath)) {
    throw new Error(`Example asset not found: ${assetPath}`);
  }

  const buffer = readFileSync(assetPath);
  const bytes = new Uint8Array(buffer);

  let mime = 'image/jpeg';
  if (name.endsWith('.png') || name.endsWith('.pns')) {
    mime = 'image/png';
  } else if (name.endsWith('.HEIC') || name.endsWith('.heic')) {
    mime = 'image/heic';
  } else if (name.endsWith('.avif')) {
    mime = 'image/avif';
  } else if (name.endsWith('.gif')) {
    mime = 'image/gif';
  } else if (name.endsWith('.webp')) {
    mime = 'image/webp';
  }

  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

  return {
    bytes,
    buffer,
    dataUrl,
    name,
    path: assetPath,
    url: 'file://' + assetPath,
  };
}

/**
 * Instantiate and initialize a StereoImg custom element within the mock DOM.
 *
 * @returns {Promise<Object>} An instance of StereoImg.
 */
export async function createStereoImgElement() {
  setupDOMEnvironment();
  await import('../../../stereo-img.js');
  const StereoImgClass = global.customElements.get('stereo-img');
  assert.ok(StereoImgClass, '<stereo-img> must be registered in customElements');
  return new StereoImgClass();
}
