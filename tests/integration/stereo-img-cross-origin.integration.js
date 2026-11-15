import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

// A second server, started by web-test-runner.config.mjs.
const OTHER_ORIGIN = 'http://localhost:8643';
const ALLOWED = `${OTHER_ORIGIN}/cors`;
const NOT_ALLOWED = `${OTHER_ORIGIN}/no-cors`;

async function waitFor(condition, description, timeout = 30000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('stereo-img pictures from another site', function () {
  this.timeout(60000);

  let element;
  let errors;
  let consoleError;

  beforeEach(() => {
    errors = [];
    consoleError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
  });

  afterEach(() => {
    console.error = consoleError;
    element?.remove();
    element?.renderer?.setAnimationLoop(null);
    element = null;
  });

  async function display(attributes) {
    element = document.createElement('stereo-img');
    element.style.width = '400px';
    element.style.height = '300px';
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
    return element.stereoData;
  }

  /** True if the element draws the picture: its left eye has a texture that the GPU accepted. */
  async function isDrawn() {
    const frame = element.renderer.info.render.frame;
    await waitFor(() => element.renderer.info.render.frame > frame + 2, 'frames');
    const texture = element.stereoImageGroup.children[0].material.map;
    return !!element.renderer.properties.get(texture).__webglTexture;
  }

  it('is really another origin', async () => {
    expect(new URL(OTHER_ORIGIN).origin).to.not.equal(location.origin);
    expect((await fetch(`${ALLOWED}/examples/persepolis.anaglyph.jpg`)).ok).to.be.true;
    let blocked = false;
    await fetch(`${NOT_ALLOWED}/examples/persepolis.anaglyph.jpg`).catch(() => { blocked = true; });
    expect(blocked).to.be.true;
  });

  for (const [description, attributes, width] of [
    ['a side by side picture', { src: `${ALLOWED}/examples/Panasonic-DMC-GX8.jpg`, type: 'left-right' }, 1824],
    ['a picture whose type is detected', { src: `${ALLOWED}/examples/Panasonic-DMC-GX8.jpg` }, 1824],
    ['a VR photo', { src: `${ALLOWED}/examples/vr180-lenovo-mirage.vr.jpg` }, 3016],
    ['an anaglyph', { src: `${ALLOWED}/examples/persepolis.anaglyph.jpg`, type: 'anaglyph' }, 943],
    ['a picture with a depth map', { src: `${ALLOWED}/examples/Pixel7Pro.PORTRAIT.jpg`, type: 'depth' }, 3072],
    ['a Multi-Picture Format file', { src: `${ALLOWED}/examples/Panasonic-DMC-GX8.mpo` }, 1824],
    ['a pair of pictures', { src: `${ALLOWED}/examples/Panasonic-DMC-GX8-left.jpg`, 'src-right': `${ALLOWED}/examples/Panasonic-DMC-GX8-right.jpg` }, 1824],
  ]) {
    it(`should display ${description} from a site that allows it`, async () => {
      const stereoData = await display(attributes);

      expect(stereoData.leftEye.width ?? stereoData.leftEye.naturalWidth).to.equal(width);
      expect(await isDrawn()).to.be.true;
      expect(errors).to.deep.equal([]);
    });
  }

  for (const [description, attributes] of [
    ['a side by side picture', { src: `${NOT_ALLOWED}/examples/Panasonic-DMC-GX8.jpg`, type: 'left-right' }],
    ['a picture whose type is detected', { src: `${NOT_ALLOWED}/examples/Panasonic-DMC-GX8.jpg` }],
    ['the right picture of a pair', { src: '/examples/Panasonic-DMC-GX8-left.jpg', 'src-right': `${NOT_ALLOWED}/examples/Panasonic-DMC-GX8-right.jpg` }],
  ]) {
    it(`should explain why it cannot display ${description} from a site that does not allow it`, async () => {
      const stereoData = await display(attributes);

      // an empty scene, and the reason in the console
      expect(stereoData.leftEye.width).to.equal(10);
      expect(element.loadingIndicator.visible).to.be.false;
      expect(errors.length).to.equal(1);
      if (attributes.src.startsWith(NOT_ALLOWED)) {
        expect(errors[0]).to.include(`The picture comes from another site (${OTHER_ORIGIN})`);
        expect(errors[0]).to.include('Access-Control-Allow-Origin');
      }
    });
  }

  it('should not mention other sites when a picture of the same site is missing', async () => {
    await display({ src: '/examples/does-not-exist.jpg' });

    expect(errors.length).to.equal(1);
    expect(errors[0]).to.not.include('another site');
  });
});
