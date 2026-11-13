import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnaglyph } from '../../parsers/anaglyph-parser/anaglyph-parser.js';

const WIDTH = 4;
const HEIGHT = 2;

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

// One value per channel and per pixel, to check that nothing gets mixed up.
const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4).map((_, i) => i);

let originals;

test.beforeEach(() => {
  originals = { fetch: global.fetch, Image: global.Image, ImageData: global.ImageData, document: global.document };
  global.fetch = async () => ({ blob: async () => new Blob() });
  global.Image = FakeImage;
  global.ImageData = FakeImageData;
  global.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({ data: pixels }),
      }),
    }),
  };
});

test.afterEach(() => {
  Object.assign(global, originals);
});

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`);

test('parseAnaglyph splits every pixel of the picture', async () => {
  const result = await parseAnaglyph('anaglyph.jpg');

  assert.ok(result.leftEye.data instanceof Uint8ClampedArray);
  assert.ok(result.rightEye.data instanceof Uint8ClampedArray);
  assert.equal(result.leftEye.width, WIDTH);
  assert.equal(result.leftEye.height, HEIGHT);
  assert.equal(result.leftEye.data.length, pixels.length);
  assert.equal(result.rightEye.data.length, pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const [red, green, , alpha] = pixels.subarray(i, i + 4);
    assert.deepStrictEqual(Array.from(result.leftEye.data.subarray(i, i + 4)), [red, red, red, alpha]);
    assert.deepStrictEqual(Array.from(result.rightEye.data.subarray(i, i + 4)), [green, green, green, alpha]);
  }
});

test('parseAnaglyph uses a default angle of view', async () => {
  for (const options of [undefined, {}, { angle: null }, { angle: '0' }]) {
    const result = await parseAnaglyph('anaglyph.jpg', options);
    assert.equal(result.phiLength, 1.02278);
    assert.equal(result.thetaLength, 0.8838);
  }
});

test('parseAnaglyph uses the "angle" option', async () => {
  const result = await parseAnaglyph('anaglyph.jpg', { angle: '90' });
  close(result.phiLength, Math.PI / 2);
  close(result.thetaLength, Math.PI / 4); // the picture is twice as wide as high
  close(result.thetaStart, Math.PI / 2 - result.thetaLength / 2);
});

test('parseAnaglyph handles half and full spheres', async () => {
  const half = await parseAnaglyph('anaglyph.jpg', { angle: '180' });
  assert.equal(half.phiLength, Math.PI);
  assert.equal(half.thetaLength, Math.PI);
  assert.equal(half.thetaStart, 0);

  const full = await parseAnaglyph('anaglyph.jpg', { angle: 360 });
  assert.equal(full.phiLength, Math.PI * 2);
  assert.equal(full.thetaLength, Math.PI);
});

test('parseAnaglyph passes the "projection" option through', async () => {
  assert.equal((await parseAnaglyph('anaglyph.jpg', { projection: 'fisheye' })).projection, 'fisheye');
  assert.equal((await parseAnaglyph('anaglyph.jpg', {})).projection, undefined);
});
