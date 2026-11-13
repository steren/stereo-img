import { expect } from '@esm-bundle/chai';
import { parseLIF } from '../../parsers/lif-parser/lif-parser.js';
import '../../stereo-img.js';

const LIF = '/examples/leia_lume_pad2.jpg';
// Another picture of the same device, converted to a side by side JPEG.
const SIDE_BY_SIDE = '/examples/leia_lume_pad2_2x1.jpg';
// A regular picture
const REGULAR = '/examples/Panasonic-DMC-GX8-left.jpg';

const WIDTH = 388;
const HEIGHT = 243;

/** A small greyscale version of a picture. */
async function thumbnail(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(await createImageBitmap(imageData), 0, 0, WIDTH, HEIGHT);
  const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  return Array.from({ length: data.length / 4 }, (_, i) => (data[4 * i] + data[4 * i + 1] + data[4 * i + 2]) / 3);
}

/**
 * How far the content of a band of rows is shifted horizontally in the right picture,
 * compared with the left one. Negative when it is further to the left.
 */
function horizontalShift(left, right, firstRow, lastRow) {
  let best;
  for (let shift = -30; shift <= 30; shift++) {
    let difference = 0;
    for (let y = firstRow; y < lastRow; y++) {
      for (let x = 40; x < WIDTH - 40; x++) {
        difference += Math.abs(left[y * WIDTH + x] - right[y * WIDTH + x + shift]);
      }
    }
    if (!best || difference < best.difference) {
      best = { shift, difference };
    }
  }
  return best.shift;
}

async function waitFor(condition, description, timeout = 40000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('LIF Parser', function () {
  this.timeout(60000);

  it('should extract the left and right views of a Lume Pad 2 picture', async () => {
    const result = await parseLIF(LIF);

    for (const eye of [result.leftEye, result.rightEye]) {
      expect(eye instanceof ImageData).to.be.true;
      expect(eye.width).to.equal(4656);
      expect(eye.height).to.equal(2910);
    }

    // The picture shows a hedge from above: its top is far, its bottom is near.
    // An object is further to the left for the right eye than for the left eye, the more so when it is near.
    const [left, right] = await Promise.all([result.leftEye, result.rightEye].map(thumbnail));
    const far = horizontalShift(left, right, 0, Math.round(HEIGHT * 0.14));
    const near = horizontalShift(left, right, Math.round(HEIGHT * 0.85), HEIGHT);
    expect(far).to.be.lessThan(0);
    expect(near).to.be.lessThan(far - 3);
  });

  it('should use the focal length of the camera', async () => {
    const result = await parseLIF(LIF);

    expect(result.phiLength * 180 / Math.PI).to.be.closeTo(65.5, 0.1);
  });

  it('should prefer the "angle" option', async () => {
    const result = await parseLIF(LIF, { angle: '180' });

    expect(result.phiLength).to.equal(Math.PI);
  });

  it('should reject a picture that is not in the Leia Image Format', async () => {
    let error;
    await parseLIF(REGULAR).catch(e => { error = e; });

    expect(error?.message).to.include('No pair of views');
  });

  it('should stop when aborted', async () => {
    const controller = new AbortController();
    const parsing = parseLIF(LIF, { signal: controller.signal });
    controller.abort();

    let error;
    await parsing.catch(e => { error = e; });

    expect(error?.name).to.equal('AbortError');
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
      await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
      return element.stereoData;
    }

    for (const attributes of [{ src: LIF }, { src: LIF, type: 'lif' }]) {
      it(`should display ${JSON.stringify(attributes)}`, async () => {
        const stereoData = await display(attributes);

        expect(stereoData.leftEye.width).to.equal(4656);
        expect(stereoData.leftEye === stereoData.rightEye).to.be.false;
        expect(stereoData.phiLength * 180 / Math.PI).to.be.closeTo(65.5, 0.1);
      });
    }

    it('should display the side by side conversion of a Lume Pad 2 picture', async () => {
      const stereoData = await display({ src: SIDE_BY_SIDE });

      expect(stereoData.leftEye.width).to.equal(4656);
      expect(stereoData.leftEye.height).to.equal(2910);
      expect(stereoData.leftEye === stereoData.rightEye).to.be.false;
    });

    it('should display an empty scene for type="lif" on a regular picture', async () => {
      const stereoData = await display({ src: REGULAR, type: 'lif' });

      expect(stereoData.leftEye.width).to.equal(10);
    });
  });
});
