import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStereo } from '../../parsers/stereo-parser/stereo-parser.js';

const WIDTH = 16;
const HEIGHT = 8;

class FakeImage {
  constructor() {
    this.width = WIDTH;
    this.height = HEIGHT;
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

/**
 * Install a fake canvas backed by `rows`, an array of strings where '#' is a
 * white pixel and '.' a black one. Reading outside of the image throws, so a
 * scan that runs past the edge fails the test instead of hanging it.
 */
function installCanvas(rows) {
  global.Image = FakeImage;
  global.ImageData = FakeImageData;
  global.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {},
        getImageData: (x, y, w, h) => {
          if (x < 0 || y < 0 || x + w > WIDTH || y + h > HEIGHT) {
            throw new RangeError(`read outside of the image: ${x},${y} ${w}x${h}`);
          }
          const data = [];
          for (let j = y; j < y + h; j++) {
            for (let i = x; i < x + w; i++) {
              const value = rows[j][i] === '#' ? 255 : 0;
              data.push(value, value, value, 255);
            }
          }
          return new FakeImageData(new Uint8ClampedArray(data), w, h);
        },
      }),
    }),
  };
}

test('fisheye edge detection finds the edges of both eyes', async () => {
  installCanvas([
    '................',
    '................',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '................',
    '................',
  ]);

  const result = await parseStereo('fisheye.jpg', {});

  assert.equal(result.projection, 'fisheye');
  // Both eyes are cropped to their lit area: no black pixel is left.
  assert.equal(result.leftEye.width, result.rightEye.width);
  assert.ok(result.leftEye.data.every(value => value === 255));
  assert.ok(result.rightEye.data.every(value => value === 255));
});

test('fisheye edge detection terminates when the right half is black', async () => {
  installCanvas([
    '................',
    '................',
    '..####..........',
    '..####..........',
    '..####..........',
    '..####..........',
    '................',
    '................',
  ]);

  const result = await parseStereo('fisheye.jpg', {});

  assert.equal(result.projection, 'fisheye');
  assert.ok(result.leftEye.data.every(value => value === 255));
  assert.equal(result.rightEye.width, WIDTH / 2);
});
