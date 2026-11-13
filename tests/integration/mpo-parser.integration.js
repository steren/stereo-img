import { expect } from '@esm-bundle/chai';
import { parseMPO } from '../../parsers/mpo-parser/mpo-parser.js';
import { parseStereo } from '../../parsers/stereo-parser/stereo-parser.js';
import '../../stereo-img.js';

const MPO = '/examples/Panasonic-DMC-GX8.mpo';
// The same picture, converted from the .mpo file to a side by side JPEG.
const SIDE_BY_SIDE = '/examples/Panasonic-DMC-GX8.jpg';
// A regular picture
const LEFT = '/examples/Panasonic-DMC-GX8-left.jpg';

/** A small greyscale version of a picture, to compare pictures with each other. */
async function thumbnail(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 36;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(await createImageBitmap(imageData), 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return Array.from({ length: data.length / 4 }, (_, i) => (data[4 * i] + data[4 * i + 1] + data[4 * i + 2]) / 3);
}

/** Average difference between two thumbnails, from 0 (same picture) to 255. */
const difference = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;

async function waitFor(condition, description, timeout = 20000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('MPO Parser', function () {
  this.timeout(30000);

  it('should extract the left and right pictures of a Panasonic DMC-GX8 file', async () => {
    const result = await parseMPO(MPO);

    expect(result.leftEye instanceof ImageData).to.be.true;
    expect(result.rightEye instanceof ImageData).to.be.true;
    for (const eye of [result.leftEye, result.rightEye]) {
      expect(eye.width).to.equal(1824);
      expect(eye.height).to.equal(1368);
    }

    const expected = await parseStereo(SIDE_BY_SIDE, { type: 'left-right' });
    const [left, right, expectedLeft, expectedRight] = await Promise.all(
      [result.leftEye, result.rightEye, expected.leftEye, expected.rightEye].map(thumbnail));
    // each eye is the same picture as in the conversion, and not the one of the other eye
    expect(difference(left, expectedLeft)).to.be.lessThan(1);
    expect(difference(right, expectedRight)).to.be.lessThan(1);
    expect(difference(left, expectedRight)).to.be.greaterThan(10);
    expect(difference(right, expectedLeft)).to.be.greaterThan(10);
  });

  it('should use the focal length of the camera', async () => {
    const result = await parseMPO(MPO);

    // 68mm in 35mm format: a diagonal angle of view of 35 degrees
    const diagonal = Math.hypot(result.phiLength, result.thetaLength) * 180 / Math.PI;
    expect(diagonal).to.be.closeTo(35.3, 0.5);
    expect(result.phiLength).to.be.greaterThan(result.thetaLength);
  });

  it('should use the "angle" option', async () => {
    const result = await parseMPO(MPO, { angle: '180' });

    expect(result.phiLength).to.equal(Math.PI);
  });

  it('should reject a picture that is not a stereoscopic Multi-Picture Format file', async () => {
    let error;
    await parseMPO(LEFT).catch(e => { error = e; });

    expect(error?.message).to.include('No stereoscopic pair');
  });

  it('should stop when aborted', async () => {
    const controller = new AbortController();
    const parsing = parseMPO(MPO, { signal: controller.signal });
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

    for (const attributes of [{ src: MPO }, { src: `${MPO}?size=full#picture` }, { src: MPO, type: 'mpo' }]) {
      it(`should display ${JSON.stringify(attributes)}`, async () => {
        const stereoData = await display(attributes);

        expect(stereoData.leftEye.width).to.equal(1824);
        expect(stereoData.leftEye === stereoData.rightEye).to.be.false;
        expect(element.hasAttribute('type')).to.equal('type' in attributes);
      });
    }

    it('should display an empty scene for type="mpo" on a regular picture', async () => {
      const stereoData = await display({ src: LEFT, type: 'mpo' });

      expect(stereoData.leftEye.width).to.equal(10);
    });
  });
});
