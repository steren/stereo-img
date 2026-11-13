import { expect } from '@esm-bundle/chai';
import { parseStereo } from '../../parsers/stereo-parser/stereo-parser.js';
import '../../stereo-img.js';

const LEFT = '/examples/Panasonic-DMC-GX8-left.jpg';
const RIGHT = '/examples/Panasonic-DMC-GX8-right.jpg';
const WIDTH = 456;
const HEIGHT = 342;

/** The pixels of a picture, at a small size. */
async function pixels(src) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);
  return new Uint32Array(ctx.getImageData(0, 0, WIDTH, HEIGHT).data.buffer);
}

/**
 * Build an interlaced picture, as a lossless PNG.
 * @returns {Promise<string>} its URL. The parser releases it once loaded, so each parsing needs its own.
 */
async function interlace(first, second, byColumns) {
  const interlaced = new Uint32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const line = byColumns ? x : y;
      interlaced[y * WIDTH + x] = (line % 2 === 0 ? first : second)[y * WIDTH + x];
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(interlaced.buffer), WIDTH, HEIGHT), 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(blob);
}

/**
 * Check that an eye holds the lines of a picture that were kept in the interlaced one.
 * @param {number} parity - 0 if the picture provided the first, third... lines, 1 for the others
 */
function expectLinesOf(eye, picture, parity, byColumns) {
  const eyePixels = new Uint32Array(eye.data.buffer);
  let different = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if ((byColumns ? x : y) % 2 === parity && eyePixels[y * WIDTH + x] !== picture[y * WIDTH + x]) {
        different++;
      }
    }
  }
  expect(different).to.equal(0);
}

describe('Stereo Parser, interlaced pictures', function () {
  this.timeout(30000);

  let left;
  let right;

  before(async () => {
    left = await pixels(LEFT);
    right = await pixels(RIGHT);
    // the two pictures are different enough to tell them apart
    expect(left.filter((pixel, i) => pixel !== right[i]).length).to.be.greaterThan(left.length / 2);
  });

  for (const byColumns of [false, true]) {
    const prefix = byColumns ? 'column-' : '';

    it(`should separate the eyes of a "${prefix}interlaced" picture`, async () => {
      const result = await parseStereo(await interlace(left, right, byColumns), { type: `${prefix}interlaced` });

      expect(result.leftEye.width).to.equal(WIDTH);
      expect(result.leftEye.height).to.equal(HEIGHT);
      expectLinesOf(result.leftEye, left, 0, byColumns);
      expectLinesOf(result.rightEye, right, 1, byColumns);
    });

    it(`should separate the eyes of a "${prefix}interlaced-reverse" picture`, async () => {
      const result = await parseStereo(await interlace(right, left, byColumns), { type: `${prefix}interlaced-reverse` });

      expectLinesOf(result.leftEye, left, 1, byColumns);
      expectLinesOf(result.rightEye, right, 0, byColumns);
    });
  }

  it('should display an interlaced picture in the component', async () => {
    const element = document.createElement('stereo-img');
    element.setAttribute('type', 'interlaced');
    element.setAttribute('src', await interlace(left, right, false));
    document.body.appendChild(element);
    try {
      const start = Date.now();
      while (!(element.stereoData && !element.loadingIndicator.visible)) {
        if (Date.now() - start > 20000) {
          throw new Error('Timed out waiting for the picture');
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      expect(element.stereoData.leftEye.width).to.equal(WIDTH);
      expect(element.stereoData.leftEye.height).to.equal(HEIGHT);
      expectLinesOf(element.stereoData.leftEye, left, 0, false);
      expectLinesOf(element.stereoData.rightEye, right, 1, false);
      expect(element.stereoImageGroup.children.length).to.equal(2);
    } finally {
      element.remove();
      element.renderer?.setAnimationLoop(null);
    }
  });
});
