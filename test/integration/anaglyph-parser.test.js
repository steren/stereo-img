import { expect } from '@esm-bundle/chai';
import { parseAnaglyph } from '../../parsers/anaglyph-parser/anaglyph-parser.js';

describe('Anaglyph Parser', () => {
  it('should parse an anaglyph image', async () => {
    const url = '/examples/persepolis.anaglyph.jpg';
    
    const image = await loadImage(url);
    const result = await parseAnaglyph(url);

    expect(result.leftEye).to.be.an.instanceof(ImageData);
    expect(result.rightEye).to.be.an.instanceof(ImageData);
    expect(result.leftEye.width).to.equal(image.width);
    expect(result.leftEye.height).to.equal(image.height);
    expect(result.rightEye.width).to.equal(image.width);
    expect(result.rightEye.height).to.equal(image.height);
    expect(result.phiLength).to.be.a('number');
    expect(result.thetaLength).to.be.a('number');
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