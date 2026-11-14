import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const PICTURES = [
  '/examples/persepolis.anaglyph.jpg',
  '/examples/wikipedia.anaglyph.jpg',
];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Set "src" and wait for the picture to be displayed. */
async function show(element, src) {
  const previous = element.stereoData;
  element.setAttribute('src', src);
  const start = Date.now();
  while (element.stereoData === previous || element.loadingIndicator.visible) {
    if (Date.now() - start > 15000) {
      throw new Error(`Timed out loading ${src}`);
    }
    await wait(20);
  }
}

/**
 * List the GPU resources used by the picture currently displayed, and track
 * which ones get disposed.
 */
function trackResources(element) {
  const resources = new Set();
  element.stereoImageGroup.traverse(object => {
    for (const resource of [object.geometry, object.material, object.material?.map]) {
      if (resource) {
        resources.add(resource);
      }
    }
  });
  const disposed = new Set();
  for (const resource of resources) {
    resource.addEventListener('dispose', () => disposed.add(resource));
  }
  return { resources, disposed };
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
      const { resources, disposed } = trackResources(element);
      // per eye: a geometry, a material and a texture (plus a wireframe and its material in debug mode)
      expect(resources.size).to.equal(debug ? 10 : 6);

      await show(element, PICTURES[1]);

      expect(disposed.size).to.equal(resources.size);
    }).timeout(40000);
  }
});
