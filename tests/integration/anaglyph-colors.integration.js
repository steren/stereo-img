import { expect } from '@esm-bundle/chai';
import { parseAnaglyph, COLORS } from '../../parsers/anaglyph-parser/anaglyph-parser.js';
import '../../stereo-img.js';

const LEFT = '/examples/Panasonic-DMC-GX8-left.jpg';
const RIGHT = '/examples/Panasonic-DMC-GX8-right.jpg';
const WIDTH = 912;
const HEIGHT = 684;

/** The RGBA pixels of a picture, at a reduced size. */
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
  return ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
}

/**
 * Build an anaglyph of two pictures.
 * @param {string} type - 'image/png' for a lossless file, 'image/jpeg' for a compressed one
 * @returns {Promise<string>} its URL
 */
async function makeAnaglyph(left, right, colors, type) {
  const data = new Uint8ClampedArray(left.length).fill(255);
  for (let i = 0; i < left.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      data[i + channel] = COLORS[colors].left.includes(channel) ? left[i + channel]
        : COLORS[colors].right.includes(channel) ? right[i + channel] : 0;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.getContext('2d').putImageData(new ImageData(data, WIDTH, HEIGHT), 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.8));
  return URL.createObjectURL(blob);
}

/** Average difference between the grey pixels of an eye and the channels of a picture that it should show. */
function difference(eye, picture, channels) {
  let total = 0;
  for (let i = 0; i < picture.length; i += 4) {
    const expected = channels.reduce((sum, channel) => sum + picture[i + channel], 0) / channels.length;
    total += Math.abs(eye.data[i] - expected);
  }
  return total / (picture.length / 4);
}

describe('Anaglyph Parser, colours', function () {
  this.timeout(60000);

  let left;
  let right;

  before(async () => {
    left = await pixels(LEFT);
    right = await pixels(RIGHT);
  });

  for (const colors of Object.keys(COLORS)) {
    for (const type of ['image/png', 'image/jpeg']) {
      it(`should find the colours of a ${colors} anaglyph (${type})`, async () => {
        const result = await parseAnaglyph(await makeAnaglyph(left, right, colors, type));

        expect(result.colors).to.equal(colors);
        // each eye shows its picture, and not the one of the other eye
        const { left: leftChannels, right: rightChannels } = COLORS[colors];
        // compression changes the pixels of a JPEG: allow for it
        const tolerance = type === 'image/png' ? 1 : 9;
        const leftWithLeft = difference(result.leftEye, left, leftChannels);
        const rightWithRight = difference(result.rightEye, right, rightChannels);
        expect(leftWithLeft).to.be.lessThan(tolerance);
        expect(rightWithRight).to.be.lessThan(tolerance);
        expect(difference(result.leftEye, right, leftChannels)).to.be.greaterThan(Math.max(8, 1.4 * leftWithLeft));
        expect(difference(result.rightEye, left, rightChannels)).to.be.greaterThan(Math.max(8, 1.4 * rightWithRight));
      });
    }
  }

  for (const src of ['/examples/persepolis.anaglyph.jpg', '/examples/wikipedia.anaglyph.jpg']) {
    it(`should find that ${src} is red-cyan`, async () => {
      const result = await parseAnaglyph(src);

      expect(result.colors).to.equal('red-cyan');
    });
  }

  it('should use the colours it is given', async () => {
    const result = await parseAnaglyph(await makeAnaglyph(left, right, 'red-cyan', 'image/png'), { colors: 'amber-blue' });

    expect(result.colors).to.equal('amber-blue');
    expect(difference(result.rightEye, right, [2])).to.be.lessThan(1);
  });

  describe('in the component', () => {
    let element;

    afterEach(() => {
      element?.remove();
      element?.renderer?.setAnimationLoop(null);
    });

    async function display(attributes) {
      element = document.createElement('stereo-img');
      for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
      }
      document.body.appendChild(element);
      const start = Date.now();
      while (!(element.stereoData && !element.loadingIndicator.visible)) {
        if (Date.now() - start > 20000) {
          throw new Error('Timed out waiting for the picture');
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return element.stereoData;
    }

    it('should find the colours with type="anaglyph"', async () => {
      const stereoData = await display({ type: 'anaglyph', src: await makeAnaglyph(left, right, 'green-magenta', 'image/png') });

      expect(stereoData.colors).to.equal('green-magenta');
    });

    it('should use the colours named by the type', async () => {
      const stereoData = await display({ type: 'anaglyph-red-blue', src: await makeAnaglyph(left, right, 'green-magenta', 'image/png') });

      expect(stereoData.colors).to.equal('red-blue');
    });
  });
});
