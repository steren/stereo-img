import { expect } from '@esm-bundle/chai';
import { parseDepth } from '../../parsers/depth-parser/depth-parser.js';

describe('Depth Parser', () => {
  it('should parse a Pixel portrait image', async () => {
    const url = '/examples/Pixel7Pro.PORTRAIT.jpg';

    const result = await parseDepth(url);

    expect(result.leftEye.naturalWidth).to.equal(3072);
    expect(result.leftEye.naturalHeight).to.equal(4080);
    expect(result.rightEye === result.leftEye).to.be.true;
    // the depth map has the same shape as the picture, at a lower resolution
    expect(result.depth.naturalWidth).to.be.greaterThan(0);
    expect(result.depth.naturalWidth / result.depth.naturalHeight).to.be.closeTo(3072 / 4080, 0.01);
  }).timeout(20000);
});
