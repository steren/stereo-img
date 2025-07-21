import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStereo } from '../parsers/stereo-parser/stereo-parser.js';

class FakeImage {
  constructor() {
    this.width = 2;
    this.height = 1;
    this._src = '';
    this._onload = null;
  }
  set src(v) { this._src = v; if (this._onload) setImmediate(this._onload); }
  get src() { return this._src; }
  set onload(fn) { this._onload = fn; if (this._src) setImmediate(fn); }
  get onload() { return this._onload; }
}

class FakeImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
}

test('parseStereo rejects when exif parsing fails', async () => {
  const origImage = global.Image;
  const origDocument = global.document;
  const origImageData = global.ImageData;
  global.Image = FakeImage;
  global.ImageData = FakeImageData;

  const pixels = [1,2,3,4, 5,6,7,8];
  function makeCanvas() {
    return {
      getContext: () => ({
        drawImage: () => {},
        getImageData: (x, y, w, h) => {
          const arr = [];
          for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
              const idx = ((y + j) * 2 + (x + i)) * 4;
              arr.push(...pixels.slice(idx, idx + 4));
            }
          }
          return { data: new Uint8ClampedArray(arr) };
        }
      })
    };
  }
  global.document = { createElement: makeCanvas };

  try {
    await assert.rejects(
      parseStereo('data:image/jpeg;base64,AA', { projection: 'equirectangular', angle: 180 })
    );
  } finally {
    global.Image = origImage;
    global.document = origDocument;
    global.ImageData = origImageData;
  }
});
