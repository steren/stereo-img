import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVR } from '../parsers/vr-parser/vr-parser.js';

class FakeImage {
  constructor() {
    this.width = 1;
    this.height = 1;
    this._src = '';
    this._onload = null;
  }
  set src(v) { this._src = v; if (this._onload) setImmediate(this._onload); }
  get src() { return this._src; }
  set onload(fn) { this._onload = fn; if (this._src) setImmediate(fn); }
  get onload() { return this._onload; }
}

class FakeImageData { constructor(data, w, h){ this.data=data; this.width=w; this.height=h; } }

test('parseVR rejects invalid images', async () => {
  const origImage = global.Image;
  const origDocument = global.document;
  const origImageData = global.ImageData;

  global.Image = FakeImage;
  global.ImageData = FakeImageData;

  global.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })
      })
    })
  };

  try {
    await assert.rejects(parseVR('data:image/jpeg;base64,AA'));
  } finally {
    global.Image = origImage;
    global.document = origDocument;
    global.ImageData = origImageData;
  }
});
