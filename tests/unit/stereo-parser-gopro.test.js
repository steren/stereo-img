import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStereo } from '../../parsers/stereo-parser/stereo-parser.js';

class FakeImage {
  constructor() {
    this.width = 4;
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

const GOPRO_PHI_LENGTH = 122.6 * Math.PI / 180;

for (const url of [
  'GOPR0123.JPG',
  'gopro-beach.jpg',
  'examples/GOPR0.left-right.jpg',
  '/pictures/2024/GOPR0123.JPG',
  'https://example.com/pictures/GOPR0123.JPG?size=large#top',
]) {
  test(`uses the GoPro angle of view for ${url}`, async () => {
    const result = await parseStereo(url, {});
    assert.equal(result.phiLength, GOPRO_PHI_LENGTH);
  });
}

for (const url of [
  'picture.jpg',
  'https://example.com/gopro/picture.jpg',
  'https://example.com/picture.jpg?camera=GOPR0123',
  'data:image/jpeg;base64,AAAA/GOPR0123',
]) {
  test(`does not use the GoPro angle of view for ${url}`, async () => {
    const result = await parseStereo(url, {});
    assert.notEqual(result.phiLength, GOPRO_PHI_LENGTH);
  });
}
