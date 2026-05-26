import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnaglyph } from '../../parsers/anaglyph-parser/anaglyph-parser.js';

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

class FakeImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
}

test('parseAnaglyph splits color channels', async () => {
  const origFetch = global.fetch;
  const origImage = global.Image;
  const origDocument = global.document;
  const origImageData = global.ImageData;

  global.fetch = async () => ({ blob: async () => new Blob() });
  global.Image = FakeImage;
  global.ImageData = FakeImageData;

  const pixel = [10, 20, 30, 40];
  global.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(pixel) })
      })
    })
  };

  try {
    const result = await parseAnaglyph('data:image/jpeg;base64,AA');
    assert.deepStrictEqual(Array.from(result.leftEye.data), [10,10,10,40]);
    assert.deepStrictEqual(Array.from(result.rightEye.data), [20,20,20,40]);
    assert.equal(result.phiLength, 1.02278);
    assert.equal(result.thetaLength, 0.8838);
    assert.equal(result.thetaStart, Math.PI / 2 - result.thetaLength / 2);
  } finally {
    global.fetch = origFetch;
    global.Image = origImage;
    global.document = origDocument;
    global.ImageData = origImageData;
  }
});
