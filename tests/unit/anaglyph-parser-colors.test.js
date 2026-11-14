import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnaglyph, detectColors, COLORS } from '../../parsers/anaglyph-parser/anaglyph-parser.js';

const WIDTH = 320;
const HEIGHT = 120;
const RED = 0;
const GREEN = 1;
const BLUE = 2;

/** A repeatable random number generator. */
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * A view of a scene made of vertical stripes of random colours, 4 to 16 pixels wide.
 * @param {number} shift - horizontal position of the scene: two views with different shifts have parallax
 * @returns {Array<Uint8Array>} the red, green and blue channels
 */
function makeView(shift) {
  const next = random(42);
  const stripes = [];
  while (stripes.length < WIDTH + 64) {
    const color = [next() * 255, next() * 255, next() * 255];
    const width = 4 + Math.floor(next() * 12);
    for (let i = 0; i < width; i++) {
      stripes.push(color);
    }
  }
  return [RED, GREEN, BLUE].map(channel => {
    const pixels = new Uint8Array(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        // rows are slightly different from each other
        pixels[y * WIDTH + x] = Math.min(255, stripes[x + shift][channel] * (0.8 + 0.2 * ((y * 7) % 10) / 10));
      }
    }
    return pixels;
  });
}

const leftView = makeView(0);
const rightView = makeView(9);

/** Build the RGBA pixels of an anaglyph of the two views. */
function makeAnaglyph(colors, { grey = false } = {}) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
  for (const [view, channels] of [[leftView, COLORS[colors].left], [rightView, COLORS[colors].right]]) {
    for (const channel of channels) {
      // a grey anaglyph shows the same grey picture in every channel of an eye
      const source = grey ? view[GREEN] : view[channel];
      for (let i = 0; i < WIDTH * HEIGHT; i++) {
        data[i * 4 + channel] = source[i];
      }
    }
  }
  // channels that no eye sees are left empty
  for (const channel of [RED, GREEN, BLUE]) {
    if (![...COLORS[colors].left, ...COLORS[colors].right].includes(channel)) {
      for (let i = 0; i < WIDTH * HEIGHT; i++) {
        data[i * 4 + channel] = 0;
      }
    }
  }
  return data;
}

for (const colors of Object.keys(COLORS)) {
  for (const grey of [false, true]) {
    test(`detects a ${grey ? 'grey' : 'colour'} ${colors} anaglyph`, () => {
      assert.equal(detectColors(makeAnaglyph(colors, { grey }), WIDTH, HEIGHT), colors);
    });
  }
}

test('detects the colours whatever the size of the picture', () => {
  // a picture four times as wide, where every pixel is repeated
  const small = makeAnaglyph('green-magenta');
  const scale = 4;
  const large = new Uint8ClampedArray(small.length * scale);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH * scale; x++) {
      large.set(small.subarray((y * WIDTH + Math.floor(x / scale)) * 4, (y * WIDTH + Math.floor(x / scale)) * 4 + 4), (y * WIDTH * scale + x) * 4);
    }
  }

  assert.equal(detectColors(large, WIDTH * scale, HEIGHT), 'green-magenta');
});

test('detects an empty channel that is not exactly black, as in a JPEG', () => {
  for (const [colors, channel] of [['red-green', BLUE], ['red-blue', GREEN]]) {
    const data = makeAnaglyph(colors);
    // a faint copy of the red channel leaks into the empty one
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      data[i * 4 + channel] = data[i * 4 + RED] / 16;
    }
    assert.equal(detectColors(data, WIDTH, HEIGHT), colors);
  }
});

test('falls back to red-cyan when the picture tells nothing', () => {
  const flat = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(128);
  const onlyRed = makeAnaglyph('red-green');
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    onlyRed[i * 4 + GREEN] = 0;
  }

  assert.equal(detectColors(flat, WIDTH, HEIGHT), 'red-cyan');
  assert.equal(detectColors(onlyRed, WIDTH, HEIGHT), 'red-cyan');
  assert.equal(detectColors(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1), 'red-cyan');
});

// parseAnaglyph, with a fake browser

class FakeImage {
  constructor() {
    this.width = WIDTH;
    this.height = HEIGHT;
    this.onload = null;
    this._src = '';
  }
  set src(value) { this._src = value; if (value) setImmediate(() => this.onload?.()); }
  get src() { return this._src; }
}

class FakeImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
}

async function parse(data, options) {
  const originals = { fetch: global.fetch, Image: global.Image, ImageData: global.ImageData, document: global.document };
  global.fetch = async () => ({ blob: async () => new Blob() });
  global.Image = FakeImage;
  global.ImageData = FakeImageData;
  global.document = { createElement: () => ({ getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data }) }) }) };
  try {
    return await parseAnaglyph('anaglyph.png', options);
  } finally {
    Object.assign(global, originals);
  }
}

/** The grey level of every pixel of an eye. */
const greys = eye => Array.from({ length: WIDTH * HEIGHT }, (_, i) => eye.data[i * 4]);

for (const colors of Object.keys(COLORS)) {
  test(`parseAnaglyph gives each eye its channels of a ${colors} anaglyph`, async () => {
    const result = await parse(makeAnaglyph(colors));

    assert.equal(result.colors, colors);
    // rounded like the pixels of a picture
    const average = (view, channels) => [...Uint8ClampedArray.from({ length: WIDTH * HEIGHT }, (_, i) =>
      channels.reduce((sum, channel) => sum + view[channel][i], 0) / channels.length)];
    assert.deepStrictEqual(greys(result.leftEye), average(leftView, COLORS[colors].left));
    assert.deepStrictEqual(greys(result.rightEye), average(rightView, COLORS[colors].right));
    // grey and opaque
    assert.deepStrictEqual([...result.leftEye.data.subarray(0, 4)], [result.leftEye.data[0], result.leftEye.data[0], result.leftEye.data[0], 255]);
  });
}

test('parseAnaglyph uses the colours it is given', async () => {
  const result = await parse(makeAnaglyph('red-cyan'), { colors: 'red-blue' });

  assert.equal(result.colors, 'red-blue');
  assert.deepStrictEqual(greys(result.rightEye), [...rightView[BLUE]]);
});

test('parseAnaglyph detects the colours when given unknown ones', async () => {
  for (const colors of [undefined, '', 'purple-yellow']) {
    const result = await parse(makeAnaglyph('amber-blue'), { colors });
    assert.equal(result.colors, 'amber-blue');
  }
});
