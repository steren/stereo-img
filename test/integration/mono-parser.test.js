import { expect } from '@esm-bundle/chai';
import { parseMono } from '../../parsers/mono-parser/mono-parser.js';

describe('Mono Parser', () => {
  it('should parse a mono image', async () => {
    const url = '/examples/Panasonic-DMC-GX8-left.jpg';

    const image = await loadImage(url);
    const result = await parseMono(url, {});

    expect(result.leftEye).to.be.an.instanceof(ImageData);
    expect(result.rightEye).to.be.an.instanceof(ImageData);
    expect(result.leftEye.width).to.equal(image.width);
    expect(result.leftEye.height).to.equal(image.height);
    expect(result.rightEye.width).to.equal(image.width);
    expect(result.rightEye.height).to.equal(image.height);
    expect(result.phiLength).to.be.a('number');
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