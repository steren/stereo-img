import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const PICTURES = [
  '/examples/persepolis.anaglyph.jpg',
  '/examples/wikipedia.anaglyph.jpg',
];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Set "src", wait for the picture to be parsed and for a few frames to be drawn. */
async function show(element, src) {
  const previous = element.stereoData;
  element.setAttribute('src', src);
  const start = Date.now();
  while (element.stereoData === previous || !element.stereoData?.leftEye) {
    if (Date.now() - start > 15000) {
      throw new Error(`Timed out loading ${src}`);
    }
    await wait(20);
  }
  await wait(200);
}

describe('stereo-img GPU memory', () => {
  let element;

  afterEach(() => {
    element?.remove();
  });

  for (const debug of [false, true]) {
    it(`should free the previous picture when "src" changes${debug ? ' (debug mode)' : ''}`, async () => {
      element = document.createElement('stereo-img');
      element.style.width = '400px';
      element.style.height = '300px';
      element.setAttribute('type', 'mono');
      if (debug) {
        element.setAttribute('debug', 'true');
      }
      document.body.appendChild(element);

      await show(element, PICTURES[0]);
      const { geometries, textures } = element.renderer.info.memory;
      expect(geometries).to.be.greaterThan(0);
      expect(textures).to.be.greaterThan(0);

      for (let i = 1; i <= 4; i++) {
        await show(element, PICTURES[i % PICTURES.length]);
      }

      expect(element.renderer.info.memory.geometries).to.equal(geometries);
      expect(element.renderer.info.memory.textures).to.equal(textures);
    }).timeout(60000);
  }
});
