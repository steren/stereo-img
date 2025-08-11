import { expect } from '@esm-bundle/chai';
import { parseVR } from '../../parsers/vr-parser/vr-parser.js';

describe('VR Parser', () => {
  it('should parse a VR180 image', async () => {

    const url = '/examples/vr180-lenovo-mirage.vr.jpg';
    const result = await parseVR(url);

    expect(result.leftEye).to.exist;
    const leftEyeImage = await loadImage(url);
    expect(leftEyeImage.width).to.equal(3016);
    expect(leftEyeImage.height).to.equal(3016);

    expect(result.rightEye).to.exist;
    const rightEyeImage = await loadImage(result.rightEye);
    expect(rightEyeImage.width).to.equal(leftEyeImage.width);
    expect(rightEyeImage.height).to.equal(leftEyeImage.height);
  }).timeout(5000);

  it('should parse pitch and roll from a VR180 image', async () => {
    const url = 'examples/vr180-lenovo-pitch-roll.vr.jpg';
    const result = await parseVR(url);

    expect(result.pitch).to.be.closeTo(0.5222936881968275, 0.0001);
    expect(result.roll).to.be.closeTo(0.9743192862443497, 0.0001);
  });
});

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
