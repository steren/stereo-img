import { expect } from '@esm-bundle/chai';
import { parseStereo } from '../../parsers/stereo-parser/stereo-parser.js';
import { verticalOffset } from '../../lib/verticalOffset.js';

describe('Stereo Parser', () => {
  it('should parse a standard side-by-side image', async () => {
    const url = '/examples/Panasonic-DMC-GX8.jpg';

    const image = await loadImage(url);
    const result = await parseStereo(url, {});

    expect(result.projection).to.not.exist;
    expect(result.phiLength).to.be.closeTo(1.081, 0.001);
    expect(result.thetaLength).to.be.closeTo(0.811, 0.001);
    expect(result.leftEye.width).to.equal(image.width / 2);
    expect(result.leftEye.height).to.equal(image.height);
    expect(result.rightEye.width).to.equal(image.width / 2);
    expect(result.rightEye.height).to.equal(image.height);
  }).timeout(10000);

  it('should parse an unprocessed Canon fisheye image', async () => {
    const url = '/examples/canon-eos-r5-dual-fisheye.jpg';

    const result = await parseStereo(url, {});

    expect(result.projection).to.equal('fisheye');
    expect(result.phiLength).to.equal(Math.PI);
    expect(result.thetaLength).to.equal(Math.PI);
    expect(result.leftEye.width).to.equal(3700);
    expect(result.leftEye.height).to.equal(3700);
    expect(result.rightEye.width).to.equal(3700);
    expect(result.rightEye.height).to.equal(3700);
  }).timeout(10000);

  it('should put both eyes of an unprocessed Canon fisheye image at the same height', async () => {
    // On this picture, the circle of the left eye is 18 pixels lower than the one of the right eye.
    const result = await parseStereo('/examples/canon-eos-r5-dual-fisheye.jpg', {});

    const offset = verticalOffset(middle(result.leftEye), middle(result.rightEye));
    expect(Math.abs(offset)).to.be.below(2);
  }).timeout(10000);

  it('should parse a processed Canon fisheye image', async () => {
    const url = '/examples/canon-eos-r5-dual-fisheye-processed.jpg';

    const image = await loadImage(url);
    const result = await parseStereo(url, {});

    expect(result.phiLength).to.equal(Math.PI);
    expect(result.thetaLength).to.equal(Math.PI);
    expect(result.leftEye.width).to.equal(image.width / 2);
    expect(result.leftEye.height).to.equal(image.height);
    expect(result.rightEye.width).to.equal(image.width / 2);
    expect(result.rightEye.height).to.equal(image.height);
  }).timeout(10000);
});

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** The middle of a picture: a square, of a share of its width. */
function middle(imageData, share = 0.3) {
  const side = Math.round(imageData.width * share);
  const left = Math.round((imageData.width - side) / 2);
  const top = Math.round((imageData.height - side) / 2);
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    const start = ((top + y) * imageData.width + left) * 4;
    data.set(imageData.data.subarray(start, start + side * 4), y * side * 4);
  }
  return { data, width: side, height: side };
}
