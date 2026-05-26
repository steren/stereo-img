import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStereo, parseStereoPair } from '../../parsers/stereo-parser/stereo-parser.js';

// Helper to create a minimal JPEG payload
function makeJPEG(payload) {
  const start = [0xff, 0xd8]; // SOI
  const end = [0xff, 0xd9];   // EOI
  return new Uint8Array([...start, ...payload, ...end]);
}
const jpeg = makeJPEG([0]);
const url = 'data:image/jpeg;base64,' + Buffer.from(jpeg).toString('base64');

class FakeImage {
  constructor() {
    this.width = 2;
    this.height = 2;
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

  const pixels = [
    1,2,3,4, 5,6,7,8,
    9,10,11,12, 13,14,15,16
  ];
  function makeCanvas() {
    return {
      getContext: (type, options) => ({
        drawImage: () => {},
        getImageData: (x, y, w, h) => {
          const arr = [];
          for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
              const idx = ((y + j) * 2 + (x + i)) * 4;
              arr.push(...pixels.slice(idx, idx + 4));
            }
          }
          return new FakeImageData(new Uint8ClampedArray(arr), w, h);
        }
      })
    };
  }
  global.document = { createElement: makeCanvas };
});

test('parseStereo splits left-right images', async () => {
    const result = await parseStereo(url, { type: 'left-right' });
    assert.deepStrictEqual(Array.from(result.leftEye.data), [1,2,3,4,9,10,11,12]);
    assert.equal(result.leftEye.width, 1);
    assert.equal(result.leftEye.height, 2);
    assert.deepStrictEqual(Array.from(result.rightEye.data), [5,6,7,8,13,14,15,16]);
    assert.equal(result.rightEye.width, 1);
    assert.equal(result.rightEye.height, 2);
});

test('parseStereo splits right-left images', async () => {
    const result = await parseStereo(url, { type: 'right-left' });
    assert.deepStrictEqual(Array.from(result.rightEye.data), [1,2,3,4,9,10,11,12]);
    assert.equal(result.rightEye.width, 1);
    assert.equal(result.rightEye.height, 2);
    assert.deepStrictEqual(Array.from(result.leftEye.data), [5,6,7,8,13,14,15,16]);
    assert.equal(result.leftEye.width, 1);
    assert.equal(result.leftEye.height, 2);
});

test('parseStereo splits top-bottom images', async () => {
    const result = await parseStereo(url, { type: 'top-bottom' });
    assert.deepStrictEqual(Array.from(result.leftEye.data), [1,2,3,4,5,6,7,8]);
    assert.equal(result.leftEye.width, 2);
    assert.equal(result.leftEye.height, 1);
    assert.deepStrictEqual(Array.from(result.rightEye.data), [9,10,11,12,13,14,15,16]);
    assert.equal(result.rightEye.width, 2);
    assert.equal(result.rightEye.height, 1);
});

test('parseStereo splits bottom-top images', async () => {
    const result = await parseStereo(url, { type: 'bottom-top' });
    assert.deepStrictEqual(Array.from(result.rightEye.data), [1,2,3,4,5,6,7,8]);
    assert.equal(result.rightEye.width, 2);
    assert.equal(result.rightEye.height, 1);
    assert.deepStrictEqual(Array.from(result.leftEye.data), [9,10,11,12,13,14,15,16]);
    assert.equal(result.leftEye.width, 2);
    assert.equal(result.leftEye.height, 1);
});

test('parseStereoPair handles two separate images', async () => {
    const result = await parseStereoPair(url, url, { type: 'pair' });
    assert.deepStrictEqual(Array.from(result.leftEye.data), [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
    assert.equal(result.leftEye.width, 2);
    assert.equal(result.leftEye.height, 2);
    assert.deepStrictEqual(Array.from(result.rightEye.data), [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
    assert.equal(result.rightEye.width, 2);
    assert.equal(result.rightEye.height, 2);
});

test('Fisheye projection option', async () => {
    const result = await parseStereo(url, { projection: 'fisheye' });
    assert.equal(result.projection, 'fisheye');
});

test('Angle calculation with 180 option', async () => {
    const result = await parseStereo(url, { angle: 180 });
    assert.equal(result.phiLength, Math.PI);
    assert.equal(result.thetaLength, Math.PI);
});

test('Angle calculation with 360 option', async () => {
    const result = await parseStereo(url, { angle: 360 });
    assert.equal(result.phiLength, Math.PI * 2);
    assert.equal(result.thetaLength, Math.PI);
});

test('Angle calculation with fisheye projection', async () => {
    const result = await parseStereo(url, { projection: 'fisheye' });
    assert.equal(result.phiLength, Math.PI);
    assert.equal(result.thetaLength, Math.PI);
});

test('Angle calculation with custom angle', async () => {
    const result = await parseStereo(url, { angle: 90 });
    assert.equal(result.phiLength, Math.PI / 2);
    assert.equal(result.thetaLength, (Math.PI / 2) * 2/2); // height/width
});

test('Default angle calculation', async () => {
    const result = await parseStereo(url, {});
    assert.ok(result.phiLength > 0);
    assert.ok(result.thetaLength > 0);
});