import { expect } from '@esm-bundle/chai';
import { parseStereo } from '../../parsers/stereo-parser/stereo-parser.js';

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
    expect(result.leftEye.width).to.equal(3750);
    expect(result.leftEye.height).to.equal(3750);
    expect(result.rightEye.width).to.equal(3750);
    expect(result.rightEye.height).to.equal(3750);
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