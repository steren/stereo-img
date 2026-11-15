import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStereo, halfType } from '../../parsers/stereo-parser/stereo-parser.js';

class FakeImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
}

/** Install a fake picture where each pixel holds its position: red is its column and green its row. */
function installPicture(width, height) {
  class FakeImage {
    constructor() { this.width = width; this.height = height; this.onload = null; this._src = ''; }
    set src(value) { this._src = value; if (value) setImmediate(() => this.onload?.()); }
    get src() { return this._src; }
  }
  global.Image = FakeImage;
  global.ImageData = FakeImageData;
  global.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {},
        getImageData: (x, y, w, h) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
              data.set([x + i, y + j, 200, 255], (j * w + i) * 4);
            }
          }
          return new FakeImageData(data, w, h);
        },
      }),
    }),
  };
}

/** The value of a channel of every pixel, one array per row. */
function rows(imageData, channel) {
  return Array.from({ length: imageData.height }, (_, y) =>
    Array.from({ length: imageData.width }, (_, x) => imageData.data[(y * imageData.width + x) * 4 + channel]));
}
const RED = 0;
const GREEN = 1;

test('half-left-right: each view gets its width back, its columns being doubled', async () => {
  installPicture(4, 2);
  const result = await parseStereo('picture.png', { type: 'half-left-right' });
  assert.deepStrictEqual(rows(result.leftEye, RED), [[0, 0, 1, 1], [0, 0, 1, 1]]);
  assert.deepStrictEqual(rows(result.rightEye, RED), [[2, 2, 3, 3], [2, 2, 3, 3]]);
  assert.deepStrictEqual(rows(result.leftEye, GREEN), [[0, 0, 0, 0], [1, 1, 1, 1]]);
});

test('half-right-left: the left eye is on the right', async () => {
  installPicture(4, 2);
  const result = await parseStereo('picture.png', { type: 'half-right-left' });
  assert.deepStrictEqual(rows(result.leftEye, RED)[0], [2, 2, 3, 3]);
  assert.deepStrictEqual(rows(result.rightEye, RED)[0], [0, 0, 1, 1]);
});

test('half-top-bottom: each view gets its height back, its rows being doubled', async () => {
  installPicture(2, 4);
  const result = await parseStereo('picture.png', { type: 'half-top-bottom' });
  assert.deepStrictEqual(rows(result.leftEye, GREEN), [[0, 0], [0, 0], [1, 1], [1, 1]]);
  assert.deepStrictEqual(rows(result.rightEye, GREEN), [[2, 2], [2, 2], [3, 3], [3, 3]]);
});

test('half-bottom-top: the left eye is at the bottom', async () => {
  installPicture(2, 4);
  const result = await parseStereo('picture.png', { type: 'half-bottom-top' });
  assert.deepStrictEqual(rows(result.leftEye, GREEN), [[2, 2], [2, 2], [3, 3], [3, 3]]);
});

test('the angles of view of a half side by side picture are the ones of the whole picture', async () => {
  installPicture(1600, 900);
  const half = await parseStereo('picture.png', { type: 'half-left-right' });
  const full = await parseStereo('picture.png', { type: 'left-right' });
  // a 16:9 view, wider than it is high, instead of 8:9
  assert.ok(Math.abs(half.phiLength / half.thetaLength - 16 / 9) < 0.15, `${half.phiLength / half.thetaLength}`);
  assert.ok(full.phiLength / full.thetaLength < 1);
});

test('tells half types apart from the others', () => {
  assert.deepStrictEqual(halfType('half-left-right'), { type: 'left-right', half: true });
  assert.deepStrictEqual(halfType('half-bottom-top'), { type: 'bottom-top', half: true });
  assert.deepStrictEqual(halfType('left-right'), { type: 'left-right', half: false });
  assert.deepStrictEqual(halfType('half-interlaced'), { type: 'half-interlaced', half: false });
  assert.deepStrictEqual(halfType(undefined), { type: undefined, half: false });
});
