import { expect } from '@esm-bundle/chai';
import { limits, readPixels, pixelReader } from '../../lib/pixels.js';
import '../../stereo-img.js';

async function waitFor(condition, description, timeout = 60000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/**
 * Make canvases behave like the ones of Safari on iOS: over a number of pixels, a canvas stays blank.
 * @param {number} mostPixels - the most pixels a canvas can have
 * @returns {{tooLarge: Array<string>, restore: Function}} the sizes of the canvases that were too large, and how to undo
 */
function limitCanvases(mostPixels) {
  const tooLarge = [];
  const { drawImage, getImageData, putImageData } = CanvasRenderingContext2D.prototype;
  const isTooLarge = ctx => {
    const { width, height } = ctx.canvas;
    if (width * height > mostPixels) {
      tooLarge.push(`${width}x${height}`);
      return true;
    }
    return false;
  };
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (!isTooLarge(this)) {
      drawImage.apply(this, args);
    }
  };
  CanvasRenderingContext2D.prototype.putImageData = function (...args) {
    if (!isTooLarge(this)) {
      putImageData.apply(this, args);
    }
  };
  CanvasRenderingContext2D.prototype.getImageData = function (x, y, width, height, ...rest) {
    if (isTooLarge(this)) {
      return new ImageData(width, height);
    }
    return getImageData.call(this, x, y, width, height, ...rest);
  };
  return {
    tooLarge,
    restore() {
      Object.assign(CanvasRenderingContext2D.prototype, { drawImage, getImageData, putImageData });
    },
  };
}

/** A picture where no two pixels are the same: every pixel tells where it is. */
async function makePicture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.data.set([x % 256, y % 256, (x >> 8) * 16 + (y >> 8), 255], (y * width + x) * 4);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(blob);
}

async function loadImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/** Tell if two sets of pixels are the same. */
function samePixels(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    return false;
  }
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) {
      return false;
    }
  }
  return true;
}

/** The share of the pixels of a picture that are not black. */
function shareOfColor(imageData) {
  let colored = 0;
  const step = 97;
  let count = 0;
  for (let i = 0; i < imageData.data.length; i += 4 * step) {
    colored += imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2] > 30 ? 1 : 0;
    count++;
  }
  return colored / count;
}

describe('pictures too large for a canvas', function () {
  this.timeout(120000);

  const realLimit = limits.canvasArea;
  let limited = null;
  let element = null;

  afterEach(() => {
    limited?.restore();
    limited = null;
    limits.canvasArea = realLimit;
    element?.remove();
    element?.renderer?.setAnimationLoop(null);
    element = null;
  });

  async function display(attributes) {
    element?.remove();
    element?.renderer?.setAnimationLoop(null);
    element = document.createElement('stereo-img');
    element.style.width = '400px';
    element.style.height = '300px';
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
    return element.stereoData;
  }

  it('reads a part of a picture without a canvas of the size of the picture', async () => {
    const image = await loadImage(await makePicture(600, 400));
    const whole = pixelReader(image)(0, 0, 600, 400);

    // canvases of 100 by 100 pixels at most
    limits.canvasArea = 10000;
    limited = limitCanvases(10000);
    const read = pixelReader(image);

    // one pixel, a row, a column, a small rectangle
    for (const [x, y, width, height] of [[0, 0, 1, 1], [599, 399, 1, 1], [0, 200, 600, 1], [300, 0, 1, 400], [250, 130, 90, 70]]) {
      const pixels = read(x, y, width, height);
      const expected = new ImageData(width, height);
      for (let row = 0; row < height; row++) {
        const start = ((y + row) * 600 + x) * 4;
        expected.data.set(whole.data.subarray(start, start + width * 4), row * width * 4);
      }
      expect(samePixels(pixels, expected), `the rectangle ${width}x${height} at ${x}, ${y}`).to.equal(true);
    }
    expect(limited.tooLarge).to.deep.equal([]);
  });

  it('reads a part larger than a canvas, in bands', async () => {
    const image = await loadImage(await makePicture(600, 400));
    const whole = pixelReader(image)(0, 0, 600, 400);

    limits.canvasArea = 10000;
    limited = limitCanvases(10000);

    // the whole picture: 24 times the limit. Its bands are 16 pixels high.
    expect(samePixels(readPixels(image, 0, 0, 600, 400), whole), 'the whole picture').to.equal(true);
    // a part whose height is not a number of bands
    const part = readPixels(image, 100, 37, 333, 301);
    expect(part.width).to.equal(333);
    expect(part.height).to.equal(301);
    expect([...part.data.slice(0, 4)]).to.deep.equal([100, 37, 0, 255]);
    expect([...part.data.slice(-4)]).to.deep.equal([(100 + 332) % 256, (37 + 300) % 256, 16 + 1, 255]);
    expect(limited.tooLarge).to.deep.equal([]);
  });

  it('gives transparent pixels outside of the picture, as a canvas does', async () => {
    const image = await loadImage(await makePicture(40, 30));
    limits.canvasArea = 100;

    const pixels = readPixels(image, 30, 20, 20, 20);

    // inside: the bottom right corner of the picture
    expect([...pixels.data.slice(0, 4)]).to.deep.equal([30, 20, 0, 255]);
    expect([...pixels.data.slice((9 * 20 + 9) * 4, (9 * 20 + 9) * 4 + 4)]).to.deep.equal([39, 29, 0, 255]);
    // outside
    expect([...pixels.data.slice((9 * 20 + 10) * 4, (9 * 20 + 10) * 4 + 4)]).to.deep.equal([0, 0, 0, 0]);
    expect([...pixels.data.slice(-4)]).to.deep.equal([0, 0, 0, 0]);
  });

  for (const [description, attributes] of [
    ['side by side', { type: 'left-right' }],
    ['one above the other', { type: 'top-bottom' }],
    ['interlaced', { type: 'interlaced' }],
    ['for one eye only', { type: 'mono' }],
    ['an anaglyph', { type: 'anaglyph' }],
  ]) {
    it(`gives the same eyes for a picture read in parts: ${description}`, async () => {
      const src = await makePicture(600, 400);
      const whole = await display({ src, ...attributes });

      limits.canvasArea = 10000;
      limited = limitCanvases(10000);
      const inParts = await display({ src, ...attributes });

      expect(samePixels(inParts.leftEye, whole.leftEye), 'the left eye').to.equal(true);
      expect(samePixels(inParts.rightEye, whole.rightEye), 'the right eye').to.equal(true);
      expect(limited.tooLarge).to.deep.equal([]);
    });
  }

  it('gives the same eyes for a pair of pictures read in parts', async () => {
    const attributes = { src: await makePicture(300, 200), 'src-right': await makePicture(310, 200), type: 'pair' };
    const whole = await display(attributes);

    limits.canvasArea = 10000;
    limited = limitCanvases(10000);
    const inParts = await display(attributes);

    expect(inParts.rightEye.width).to.equal(310);
    expect(samePixels(inParts.leftEye, whole.leftEye), 'the left eye').to.equal(true);
    expect(samePixels(inParts.rightEye, whole.rightEye), 'the right eye').to.equal(true);
    expect(limited.tooLarge).to.deep.equal([]);
  });

  it('finds the discs of a fisheye picture read in parts', async () => {
    // two discs on black, each in a half of the picture, with room around them
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 600, 300);
    for (const [center, color] of [[150, 'rgb(200, 80, 60)'], [450, 'rgb(60, 80, 200)']]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(center, 150, 120, 0, 2 * Math.PI);
      ctx.fill();
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const src = URL.createObjectURL(blob);
    const original = console.log;
    console.log = () => {};
    try {
      const whole = await display({ src, type: 'left-right', angle: '180' });

      limits.canvasArea = 10000;
      limited = limitCanvases(10000);
      const inParts = await display({ src, type: 'left-right', angle: '180' });

      expect(whole.projection).to.equal('fisheye');
      expect(inParts.projection).to.equal('fisheye');
      expect(inParts.leftEye.width).to.be.within(236, 242);
      expect(samePixels(inParts.leftEye, whole.leftEye), 'the left eye').to.equal(true);
      expect(samePixels(inParts.rightEye, whole.rightEye), 'the right eye').to.equal(true);
      expect(limited.tooLarge).to.deep.equal([]);
    } finally {
      console.log = original;
    }
  });

  it('displays the picture of a camera with two fisheye lenses where canvases are limited to 4096 by 4096 pixels', async () => {
    // 8192 by 5464 pixels: nearly three times what Safari accepts on iOS
    limited = limitCanvases(4096 * 4096);
    const original = console.log;
    console.log = () => {};
    let stereoData;
    try {
      stereoData = await display({ src: '/examples/canon-eos-r5-dual-fisheye.jpg' });
    } finally {
      console.log = original;
    }

    expect(limited.tooLarge).to.deep.equal([]);
    expect(stereoData.projection).to.equal('fisheye');
    expect(stereoData.leftEye.width).to.be.greaterThan(3000);
    // the eyes hold the picture: on a canvas that stays blank they would be black
    expect(shareOfColor(stereoData.leftEye), 'share of the left eye that is not black').to.be.greaterThan(0.5);
    expect(shareOfColor(stereoData.rightEye), 'share of the right eye that is not black').to.be.greaterThan(0.5);
  });
});
