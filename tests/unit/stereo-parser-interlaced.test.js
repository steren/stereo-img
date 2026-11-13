import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStereo } from '../../parsers/stereo-parser/stereo-parser.js';

class FakeImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
}

/**
 * Install a fake picture where each pixel holds its position: red is its column and green its row.
 */
function installPicture(width, height) {
  class FakeImage {
    constructor() {
      this.width = width;
      this.height = height;
      this.onload = null;
      this._src = '';
    }
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

test('interlaced: the first row is for the left eye', async () => {
  installPicture(3, 4);

  const result = await parseStereo('picture.png', { type: 'interlaced' });

  // each eye has the size of the picture, its rows being doubled
  assert.deepStrictEqual(rows(result.leftEye, GREEN), [[0, 0, 0], [0, 0, 0], [2, 2, 2], [2, 2, 2]]);
  assert.deepStrictEqual(rows(result.rightEye, GREEN), [[1, 1, 1], [1, 1, 1], [3, 3, 3], [3, 3, 3]]);
  // columns are untouched
  assert.deepStrictEqual(rows(result.leftEye, RED)[0], [0, 1, 2]);
  assert.deepStrictEqual(rows(result.rightEye, RED)[3], [0, 1, 2]);
});

test('interlaced-reverse: the first row is for the right eye', async () => {
  installPicture(3, 4);

  const result = await parseStereo('picture.png', { type: 'interlaced-reverse' });

  assert.deepStrictEqual(rows(result.rightEye, GREEN), [[0, 0, 0], [0, 0, 0], [2, 2, 2], [2, 2, 2]]);
  assert.deepStrictEqual(rows(result.leftEye, GREEN), [[1, 1, 1], [1, 1, 1], [3, 3, 3], [3, 3, 3]]);
});

test('column-interlaced: the first column is for the left eye', async () => {
  installPicture(4, 2);

  const result = await parseStereo('picture.png', { type: 'column-interlaced' });

  assert.deepStrictEqual(rows(result.leftEye, RED), [[0, 0, 2, 2], [0, 0, 2, 2]]);
  assert.deepStrictEqual(rows(result.rightEye, RED), [[1, 1, 3, 3], [1, 1, 3, 3]]);
  // rows are untouched
  assert.deepStrictEqual(rows(result.leftEye, GREEN), [[0, 0, 0, 0], [1, 1, 1, 1]]);
});

test('column-interlaced-reverse: the first column is for the right eye', async () => {
  installPicture(4, 2);

  const result = await parseStereo('picture.png', { type: 'column-interlaced-reverse' });

  assert.deepStrictEqual(rows(result.rightEye, RED), [[0, 0, 2, 2], [0, 0, 2, 2]]);
  assert.deepStrictEqual(rows(result.leftEye, RED), [[1, 1, 3, 3], [1, 1, 3, 3]]);
});

test('interlaced: a picture with an odd number of rows', async () => {
  installPicture(2, 5);

  const result = await parseStereo('picture.png', { type: 'interlaced' });

  assert.deepStrictEqual(rows(result.leftEye, GREEN).map(row => row[0]), [0, 0, 2, 2, 4]);
  // the last row has no row of its own for the right eye: it repeats the previous one
  assert.deepStrictEqual(rows(result.rightEye, GREEN).map(row => row[0]), [1, 1, 3, 3, 3]);
});

test('interlaced: a picture with a single row', async () => {
  installPicture(2, 1);

  const result = await parseStereo('picture.png', { type: 'interlaced' });

  assert.deepStrictEqual(rows(result.leftEye, GREEN), [[0, 0]]);
  assert.deepStrictEqual(rows(result.rightEye, GREEN), [[0, 0]]);
});

test('interlaced: the angles of view are those of the whole picture', async () => {
  installPicture(4, 2);

  const interlaced = await parseStereo('picture.png', { type: 'interlaced', angle: 120 });

  assert.equal(interlaced.leftEye.width, 4);
  assert.equal(interlaced.leftEye.height, 2);
  assert.ok(Math.abs(interlaced.phiLength - Math.PI * 2 / 3) < 1e-9);
  assert.ok(Math.abs(interlaced.thetaLength - Math.PI / 3) < 1e-9);
});
