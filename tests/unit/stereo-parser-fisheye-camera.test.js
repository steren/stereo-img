import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStereo } from '../../parsers/stereo-parser/stereo-parser.js';
import { verticalOffset } from '../../lib/verticalOffset.js';

const CANON = { Make: 'Canon', LensModel: 'RF5.2mm F2.8 L DUAL FISHEYE' };

// A picture of the Canon dual fisheye lens, eight times smaller than a real one.
const WIDTH = 1024;
const HEIGHT = 683;
const DIAMETER = 3900 / 8;
const LEFT_CENTER = 1983 / 8;

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

// Waves of many sizes and directions, always the same ones.
const WAVES = Array.from({ length: 24 }, (_, i) => {
  const angle = i * 2.399963;
  const frequency = 0.03 + 0.011 * i;
  return { fx: frequency * Math.cos(angle), fy: frequency * Math.sin(angle), phase: i * 1.7, amplitude: 8 + (i * 7) % 13 };
});

/** What a lens sees at a distance from its axis, in pixels: soft shapes, none of them alike. */
function scene(x, y) {
  let value = 128;
  for (const wave of WAVES) {
    value += wave.amplitude * Math.sin(x * wave.fx + y * wave.fy + wave.phase);
  }
  return value;
}

/**
 * Install a fake canvas with a picture of two fisheye circles on black, side by side, that show the same thing.
 * @param {number} lower - how many pixels lower than the left one the right circle is
 */
function installPicture(lower) {
  const centers = [
    { x: LEFT_CENTER, y: HEIGHT / 2 - lower / 2 },
    { x: WIDTH - LEFT_CENTER, y: HEIGHT / 2 + lower / 2 },
  ];
  const brightness = (x, y) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) {
      return 0;
    }
    const center = centers[x < WIDTH / 2 ? 0 : 1];
    const dx = x - center.x;
    const dy = y - center.y;
    return dx * dx + dy * dy <= DIAMETER * DIAMETER / 4 ? scene(dx, dy) : 0;
  };
  global.Image = FakeImage;
  global.ImageData = FakeImageData;
  global.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {},
        getImageData: (left, top, w, h) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
              const value = brightness(left + i, top + j);
              data.set([value, value, value, 255], (j * w + i) * 4);
            }
          }
          return new FakeImageData(data, w, h);
        },
      }),
    }),
  };
}

/** The middle of a picture: a square, of a share of its size. */
function middle(imageData, share = 0.5) {
  const side = Math.round(imageData.width * share);
  const from = Math.round((imageData.width - side) / 2);
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    const start = ((from + y) * imageData.width + from) * 4;
    data.set(imageData.data.subarray(start, start + side * 4), y * side * 4);
  }
  return { data, width: side, height: side };
}

test('a picture of the Canon dual fisheye lens gives the 180° circle of each eye', async () => {
  installPicture(0);

  const result = await parseStereo('picture.jpg', { exif: CANON });

  assert.equal(result.projection, 'fisheye');
  assert.equal(result.phiLength, Math.PI);
  assert.equal(result.thetaLength, Math.PI);
  // 3700 pixels of a picture that is 8192 pixels wide
  for (const eye of [result.leftEye, result.rightEye]) {
    assert.equal(eye.width, 463);
    assert.equal(eye.height, 463);
  }
  // both eyes show the same thing at the same height
  assert.ok(Math.abs(verticalOffset(middle(result.rightEye), middle(result.leftEye))) <= 1);
  // the circles fill their squares: lit in the middle of each side, black in the corners
  for (const eye of [result.leftEye, result.rightEye]) {
    const brightness = (x, y) => eye.data[(y * eye.width + x) * 4];
    assert.ok(brightness(231, 2) > 0 && brightness(231, 460) > 0 && brightness(2, 231) > 0 && brightness(460, 231) > 0);
    assert.equal(brightness(0, 0) + brightness(462, 0) + brightness(0, 462) + brightness(462, 462), 0);
  }
});

test('a circle of the Canon dual fisheye lens that is lower than the other is found where it is', async () => {
  for (const lower of [6, -4, 10]) {
    installPicture(lower);

    const result = await parseStereo('picture.jpg', { exif: CANON });

    assert.equal(result.leftEye.width, 463);
    assert.equal(result.rightEye.height, 463);
    // the pictures of this lens are right-left
    const offset = verticalOffset(middle(result.rightEye), middle(result.leftEye));
    assert.ok(Math.abs(offset) <= 1, `a circle ${lower} pixels lower leaves the eyes ${offset} pixels apart`);
  }
});

test('circles of the Canon dual fisheye lens stay where they are expected when what they show can not be compared', async () => {
  // further apart than circles of this lens are: this is something else
  installPicture(40);

  const result = await parseStereo('picture.jpg', { exif: CANON });

  const offset = verticalOffset(middle(result.rightEye), middle(result.leftEye), { maxVertical: 60 });
  assert.ok(Math.abs(offset - 40) <= 1, `eyes are ${offset} pixels apart`);
});
