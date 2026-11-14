import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStereo, parseStereoPair } from '../../parsers/stereo-parser/stereo-parser.js';
import { parseMono } from '../../parsers/mono-parser/mono-parser.js';
import { parseVR } from '../../parsers/vr-parser/vr-parser.js';

/** An image that loads asynchronously, like in a browser. */
class FakeImage {
  constructor() {
    this.width = 4;
    this.height = 2;
    this.onload = null;
    this.onerror = null;
    this._src = '';
    images.push(this);
  }
  set src(value) {
    this._src = value;
    if (value) {
      setImmediate(() => this.onload?.());
    }
  }
  get src() { return this._src; }
}

class FakeImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
}

let images;
let canvases;
let originals;

test.beforeEach(() => {
  images = [];
  canvases = 0;
  originals = { Image: global.Image, ImageData: global.ImageData, document: global.document };
  global.Image = FakeImage;
  global.ImageData = FakeImageData;
  global.document = {
    createElement: () => {
      canvases++;
      return {
        getContext: () => ({
          drawImage: () => {},
          // white pixels, so that the picture is not mistaken for a fisheye one
          getImageData: (x, y, w, h) => new FakeImageData(new Uint8ClampedArray(w * h * 4).fill(255), w, h),
        }),
      };
    },
  };
});

test.afterEach(() => {
  Object.assign(global, originals);
});

const isAbortError = error => error.name === 'AbortError';

const parsers = {
  parseStereo: signal => parseStereo('picture.jpg', { type: 'left-right', signal }),
  parseStereoPair: signal => parseStereoPair('left.jpg', 'right.jpg', { type: 'pair', signal }),
  parseMono: signal => parseMono('picture.jpg', { signal }),
};

for (const [name, parse] of Object.entries(parsers)) {
  test(`${name} does nothing when the signal is already aborted`, async () => {
    await assert.rejects(parse(AbortSignal.abort()), isAbortError);

    assert.equal(images.length, 0);
    assert.equal(canvases, 0);
  });

  test(`${name} stops when aborted while the image is loading`, async () => {
    const controller = new AbortController();
    const parsing = parse(controller.signal);
    controller.abort();

    await assert.rejects(parsing, isAbortError);

    // the download is stopped and the image is never decoded
    assert.equal(images.length, 1);
    assert.equal(images[0].src, '');
    assert.equal(canvases, 0);
  });

  test(`${name} rejects with the reason given when aborting`, async () => {
    const controller = new AbortController();
    const reason = new Error('another picture was requested');
    const parsing = parse(controller.signal);
    controller.abort(reason);

    await assert.rejects(parsing, error => error === reason);
  });

  test(`${name} parses the picture when the signal is not aborted`, async () => {
    const controller = new AbortController();

    const withSignal = await parse(controller.signal);
    const withoutSignal = await parse(undefined);

    assert.ok(withSignal.leftEye);
    assert.ok(withSignal.rightEye);
    assert.equal(withSignal.leftEye.width, withoutSignal.leftEye.width);
    assert.equal(withSignal.phiLength, withoutSignal.phiLength);
  });

  test(`${name} ignores an abort that comes after it is done`, async () => {
    const controller = new AbortController();
    const result = await parse(controller.signal);
    controller.abort();

    assert.ok(result.leftEye);
    assert.ok(images.every(image => image.src !== ''));
  });
}

test('parseStereoPair stops when aborted while the second image is loading', async () => {
  const controller = new AbortController();
  const parsing = parseStereoPair('left.jpg', 'right.jpg', { type: 'pair', signal: controller.signal });
  // wait for the first image, then for the second one to start loading
  while (images.length < 2) {
    await new Promise(resolve => setImmediate(resolve));
  }
  controller.abort();

  await assert.rejects(parsing, isAbortError);
  assert.equal(images[0].src, 'left.jpg');
  assert.equal(images[1].src, '');
});

test('parseVR does nothing when the signal is already aborted', async () => {
  await assert.rejects(parseVR('data:image/jpeg;base64,AA', { signal: AbortSignal.abort() }), isAbortError);
});

test('parseVR stops when aborted while reading the metadata', async () => {
  const controller = new AbortController();
  const parsing = parseVR('data:image/jpeg;base64,AA', { signal: controller.signal });
  controller.abort();

  await assert.rejects(parsing, isAbortError);
});
