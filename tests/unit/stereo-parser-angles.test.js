import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStereo, parseStereoPair } from '../../parsers/stereo-parser/stereo-parser.js';

// A 4x4 picture: its eyes are 2x4 (side by side), 4x2 (top / bottom) or 4x4 (pair).
const SIZE = 4;

class FakeImage {
  constructor() {
    this.width = SIZE;
    this.height = SIZE;
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

test.beforeEach(() => {
  global.Image = FakeImage;
  global.ImageData = FakeImageData;
  global.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {},
        // white pixels, so that the picture is not mistaken for a fisheye one
        getImageData: (x, y, w, h) => new FakeImageData(new Uint8ClampedArray(w * h * 4).fill(255), w, h),
      }),
    }),
  };
});

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`);

test('custom angle: the vertical angle follows the shape of a side by side eye', async () => {
  const result = await parseStereo('picture.jpg', { type: 'left-right', angle: 60 });
  close(result.phiLength, Math.PI / 3);
  close(result.thetaLength, Math.PI / 3 * 2); // eyes are twice as high as wide
});

test('custom angle: the vertical angle follows the shape of a top / bottom eye', async () => {
  const result = await parseStereo('picture.jpg', { type: 'top-bottom', angle: 120 });
  close(result.phiLength, Math.PI * 2 / 3);
  close(result.thetaLength, Math.PI / 3); // eyes are twice as wide as high
});

test('custom angle: the vertical angle follows the shape of a pair eye', async () => {
  const result = await parseStereoPair('left.jpg', 'right.jpg', { type: 'pair', angle: 120 });
  close(result.phiLength, Math.PI * 2 / 3);
  close(result.thetaLength, Math.PI * 2 / 3); // eyes are square
});

test('default angle: a top / bottom eye is wider than high', async () => {
  const result = await parseStereo('picture.jpg', { type: 'top-bottom' });
  assert.ok(result.phiLength > result.thetaLength);
});

test('default angle: a pair eye is as wide as high', async () => {
  const result = await parseStereoPair('left.jpg', 'right.jpg', { type: 'pair' });
  close(result.phiLength, result.thetaLength);
});

test('default angle: a side by side eye is higher than wide', async () => {
  const result = await parseStereo('picture.jpg', { type: 'left-right' });
  assert.ok(result.phiLength < result.thetaLength);
});
