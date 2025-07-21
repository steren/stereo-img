import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDepth } from '../parsers/depth-parser/depth-parser.js';

// Helper to create a minimal JPEG payload
function makeJPEG(payload) {
  const start = [0xff, 0xd8]; // SOI
  const end = [0xff, 0xd9];   // EOI
  return new Uint8Array([...start, ...payload, ...end]);
}

class FakeImage {
  constructor() {
    this._src = '';
    this._onload = null;
  }
  set src(v) {
    this._src = v;
    if (this._onload) setImmediate(this._onload);
  }
  get src() { return this._src; }
  set onload(fn) {
    this._onload = fn;
    if (this._src) setImmediate(fn);
  }
  get onload() { return this._onload; }
}

test('parseDepth extracts embedded depth image', async () => {
  const OriginalImage = global.Image;
  global.Image = FakeImage;
  try {
    const imgs = [
      makeJPEG([0]),
      makeJPEG([1]),
      makeJPEG([2]),
      makeJPEG([3]),
      makeJPEG([4]),
    ];
    const concatenated = new Uint8Array(imgs.reduce((arr, i) => [...arr, ...i], []));
    const url = 'data:image/jpeg;base64,' + Buffer.from(concatenated).toString('base64');

    const result = await parseDepth(url);

    assert.ok(result.depth instanceof FakeImage);
    assert.strictEqual(result.leftEye, result.rightEye);
    assert.equal(result.phiLength, 1.02278);
    assert.equal(result.thetaLength, 0.8838);
    assert.equal(result.thetaStart, Math.PI / 2 - result.thetaLength / 2);
  } finally {
    global.Image = OriginalImage;
  }
});
