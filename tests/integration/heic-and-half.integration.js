import { expect } from '@esm-bundle/chai';
import { parseHEIC } from '../../parsers/heic-parser/heic-parser.js';
import '../../stereo-img.js';

const VISION_PRO = '/examples/vision-pro.HEIC';
// The side by side Panasonic DMC-GX8 picture, squeezed to 960 by 720 pixels: each view is 480 by 720.
const HALF_SIDE_BY_SIDE = '/tests/integration/fixtures/Panasonic-DMC-GX8_HSBS.jpg';

async function waitFor(condition, description, timeout = 30000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/** Average difference between the pixels of two pictures of the same size, from 0 to 255. */
function difference(a, b) {
  let total = 0;
  for (let i = 0; i < a.data.length; i += 4 * 97) {
    total += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  }
  return total / 3 / Math.ceil(a.data.length / (4 * 97));
}

/** Average brightness of a picture, from 0 to 255. */
function brightness({ data }) {
  let total = 0;
  for (let i = 0; i < data.length; i += 4 * 101) {
    total += data[i] + data[i + 1] + data[i + 2];
  }
  return total / 3 / Math.ceil(data.length / (4 * 101));
}

describe('HEIC Parser', function () {
  this.timeout(60000);

  it('decodes both views of an Apple Vision Pro spatial photo', async () => {
    const result = await parseHEIC(VISION_PRO);
    expect(result.leftEye.width).to.equal(2560);
    expect(result.leftEye.height).to.equal(2560);
    expect(result.rightEye.width).to.equal(2560);
    expect(result.rightEye.height).to.equal(2560);
    // real pictures, of the same scene, seen from two places
    expect(brightness(result.leftEye)).to.be.within(10, 245);
    const views = difference(result.leftEye, result.rightEye);
    expect(views).to.be.above(0.5);
    expect(views).to.be.below(60);
    // square pictures, from the 18 mm (35 mm equivalent) focal length of the Exif data
    expect(result.phiLength).to.be.closeTo(result.thetaLength, 1e-9);
    expect(result.phiLength * 180 / Math.PI).to.be.within(60, 90);
  });

  it('decodes the stereo pair of an iPhone spatial photo, not its primary picture', async () => {
    // The file also holds a 5712 by 4284 picture, the one displayed by other apps. The left view is its third picture.
    const result = await parseHEIC('/examples/iphone-spatial.HEIC');
    expect([result.leftEye.width, result.leftEye.height]).to.deep.equal([2688, 2016]);
    expect([result.rightEye.width, result.rightEye.height]).to.deep.equal([2688, 2016]);
    const views = difference(result.leftEye, result.rightEye);
    expect(views).to.be.above(0.5);
    expect(views).to.be.below(60);
    expect(result.phiLength / result.thetaLength).to.be.closeTo(4 / 3, 0.05);
  });

  it('is detected without the "type" attribute', async () => {
    const element = document.createElement('stereo-img');
    element.setAttribute('src', VISION_PRO);
    document.body.appendChild(element);
    try {
      await waitFor(() => element.stereoData?.leftEye?.width === 2560, 'the HEIC picture to be parsed');
      expect(element.stereoData.leftEye).to.not.equal(element.stereoData.rightEye);
      expect(element.hasAttribute('type')).to.be.false;
    } finally {
      element.remove();
    }
  });
});

describe('Half side by side pictures', function () {
  this.timeout(30000);

  for (const [description, attributes] of [
    ['with type="half-left-right"', { type: 'half-left-right' }],
    ['detected from "HSBS" in the file name', {}],
  ]) {
    it(`give each eye its width back, ${description}`, async () => {
      const element = document.createElement('stereo-img');
      for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
      }
      element.setAttribute('src', HALF_SIDE_BY_SIDE);
      document.body.appendChild(element);
      try {
        await waitFor(() => element.stereoData?.leftEye?.width > 10, 'the picture to be parsed');
        const { leftEye, rightEye, phiLength, thetaLength } = element.stereoData;
        expect([leftEye.width, leftEye.height]).to.deep.equal([960, 720]);
        expect([rightEye.width, rightEye.height]).to.deep.equal([960, 720]);
        // a 4:3 view, not a 2:3 one
        expect(phiLength / thetaLength).to.be.within(1.2, 1.45);
      } finally {
        element.remove();
      }
    });
  }

  it('detects the half side by side picture of Spatialify from its file name', async () => {
    const element = document.createElement('stereo-img');
    element.setAttribute('src', '/examples/spatialify-iphone_HSBS.jpg');
    document.body.appendChild(element);
    try {
      await waitFor(() => element.stereoData?.leftEye?.width > 10, 'the picture to be parsed');
      // 4032 by 3024 pixels: each eye gets the 4:3 view of the iPhone back
      expect([element.stereoData.leftEye.width, element.stereoData.leftEye.height]).to.deep.equal([4032, 3024]);
      expect(element.stereoData.phiLength / element.stereoData.thetaLength).to.be.within(1.2, 1.45);
    } finally {
      element.remove();
    }
  });

  it('keeps a full side by side picture as it is with type="left-right"', async () => {
    const element = document.createElement('stereo-img');
    element.setAttribute('type', 'left-right');
    element.setAttribute('src', HALF_SIDE_BY_SIDE);
    document.body.appendChild(element);
    try {
      await waitFor(() => element.stereoData?.leftEye?.width > 10, 'the picture to be parsed');
      expect(element.stereoData.leftEye.width).to.equal(480);
    } finally {
      element.remove();
    }
  });
});
