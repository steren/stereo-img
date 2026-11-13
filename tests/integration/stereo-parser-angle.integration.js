import { expect } from '@esm-bundle/chai';
import { parseStereo } from '../../parsers/stereo-parser/stereo-parser.js';

describe('Stereo Parser angle', () => {
  // The Exif data of this picture identifies an Insta360 Evo, a 180° camera.
  const url = '/examples/insta360evo.jpg';

  it('should infer the angle from the image metadata when no angle is given', async () => {
    const result = await parseStereo(url, {});

    expect(result.phiLength).to.equal(Math.PI);
  }).timeout(20000);

  it('should prefer an explicit angle over the image metadata', async () => {
    const result = await parseStereo(url, { angle: '90' });

    expect(result.phiLength).to.be.closeTo(Math.PI / 2, 0.0001);
  }).timeout(20000);
});
