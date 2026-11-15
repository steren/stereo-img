import test from 'node:test';
import assert from 'node:assert/strict';
import { verticalOffset } from '../../lib/verticalOffset.js';

/**
 * A grey picture with soft random shapes, the same for the same seed.
 * @param {number} width
 * @param {number} height
 * @param {Object} [options]
 * @param {number} [options.dx] - how far to the right the shapes are moved
 * @param {number} [options.dy] - how far down the shapes are moved
 * @param {number} [options.seed] - what the shapes are
 * @param {number} [options.gain] - contrast of the picture
 * @param {number} [options.bias] - brightness added to the picture
 */
function makePicture(width, height, { dx = 0, dy = 0, seed = 1, gain = 1, bias = 0 } = {}) {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const waves = Array.from({ length: 24 }, () => ({
    fx: (random() - 0.5) * 0.5, fy: (random() - 0.5) * 0.5, phase: random() * 2 * Math.PI, amplitude: 10 + random() * 20,
  }));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 128;
      for (const wave of waves) {
        value += wave.amplitude * Math.sin((x - dx) * wave.fx + (y - dy) * wave.fy + wave.phase);
      }
      value = value * gain + bias;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

test('finds no offset between twice the same picture', () => {
  const picture = makePicture(160, 160);

  assert.ok(Math.abs(verticalOffset(picture, picture)) < 0.1);
});

test('finds how much lower or higher the second picture is', () => {
  const first = makePicture(160, 160);

  for (const dy of [1, 3, 7, -2, -5, -12]) {
    const offset = verticalOffset(first, makePicture(160, 160, { dy }));
    assert.ok(Math.abs(offset - dy) < 0.3, `${dy} pixels lower, found ${offset}`);
  }
});

test('finds the vertical offset whatever the horizontal one, which is what a stereo picture is made of', () => {
  const first = makePicture(160, 160);

  for (const [dx, dy] of [[9, 4], [-11, 4], [15, -6], [0, 6]]) {
    const offset = verticalOffset(first, makePicture(160, 160, { dx, dy }));
    assert.ok(Math.abs(offset - dy) < 0.3, `${dx} pixels right and ${dy} pixels lower, found ${offset}`);
  }
});

test('finds the offset of large pictures, which are compared at a lower resolution', () => {
  const first = makePicture(900, 900);
  const second = makePicture(900, 900, { dx: 37, dy: 21 });

  const offset = verticalOffset(first, second);

  assert.ok(Math.abs(offset - 21) < 1, `found ${offset}`);
});

test('does not mind a view that is darker or less contrasted than the other', () => {
  const first = makePicture(160, 160);
  const second = makePicture(160, 160, { dy: 5, gain: 0.6, bias: 20 });

  assert.ok(Math.abs(verticalOffset(first, second) - 5) < 0.3);
});

test('finds nothing when the offset is larger than what it looks for', () => {
  const first = makePicture(160, 160);

  // the best match is at the end of what is tried
  assert.equal(verticalOffset(first, makePicture(160, 160, { dy: 6 }), { maxVertical: 6 }), 0);
  assert.ok(Math.abs(verticalOffset(first, makePicture(160, 160, { dy: 6 }), { maxVertical: 8 }) - 6) < 0.3);
});

test('finds nothing between two different pictures', () => {
  assert.equal(verticalOffset(makePicture(160, 160, { seed: 1 }), makePicture(160, 160, { seed: 2 })), 0);
});

test('finds nothing in plain pictures', () => {
  const black = { data: new Uint8ClampedArray(160 * 160 * 4), width: 160, height: 160 };
  const grey = { data: new Uint8ClampedArray(160 * 160 * 4).fill(128), width: 160, height: 160 };

  assert.equal(verticalOffset(black, black), 0);
  assert.equal(verticalOffset(grey, makePicture(160, 160)), 0);
  assert.equal(verticalOffset(makePicture(160, 160), grey), 0);
});

test('finds nothing in pictures that are too small or of different sizes', () => {
  assert.equal(verticalOffset(makePicture(12, 12), makePicture(12, 12)), 0);
  assert.equal(verticalOffset(makePicture(160, 160), makePicture(160, 150)), 0);
});
