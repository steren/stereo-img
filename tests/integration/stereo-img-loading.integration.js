import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const MONO = '/examples/Panasonic-DMC-GX8-left.jpg';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(condition, description, timeout = 15000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await wait(20);
  }
}

const isLoaded = element => !!element.stereoData && !element.loadingIndicator.visible;

/** Create an element and wait for its initial picture to be displayed. */
async function createElement(attributes = {}) {
  const element = document.createElement('stereo-img');
  element.style.width = '400px';
  element.style.height = '300px';
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.body.appendChild(element);
  await waitFor(() => isLoaded(element), 'the initial picture');
  return element;
}

/** Change an attribute and wait for the element to be done loading. */
async function change(element, name, value) {
  const previous = element.stereoData;
  element.setAttribute(name, value);
  await waitFor(() => element.stereoData !== previous && isLoaded(element), `${name}="${value}"`);
}

describe('stereo-img loading', () => {
  let element;

  afterEach(() => {
    element?.remove();
  });

  it('should stop loading and clear the picture when the image does not exist', async () => {
    element = await createElement({ src: MONO, type: 'mono' });
    expect(element.stereoData.leftEye.width).to.be.greaterThan(10);

    await change(element, 'src', '/examples/does-not-exist.jpg');

    expect(element.loadingIndicator.visible).to.be.false;
    expect(element.stereoData.leftEye.width).to.equal(10);
    expect(element.stereoImageGroup.children.length).to.equal(2);
  }).timeout(20000);

  it('should stop loading when a "vr" picture has no right eye', async () => {
    element = await createElement({ src: MONO, type: 'mono' });

    await change(element, 'type', 'vr');

    expect(element.loadingIndicator.visible).to.be.false;
    expect(element.stereoData.leftEye.width).to.equal(10);
  }).timeout(20000);

  it('should display a picture again after a failure', async () => {
    element = await createElement({ src: '/examples/does-not-exist.jpg', type: 'mono' });
    expect(element.stereoData.leftEye.width).to.equal(10);

    await change(element, 'src', MONO);

    expect(element.stereoData.leftEye.width).to.be.greaterThan(10);
  }).timeout(20000);

  it('should display the latest picture when "src" changes while loading', async () => {
    element = await createElement();

    // Replace the parser by one that completes when the test decides.
    const parsing = [];
    element.parse = function () {
      const src = this.getAttribute('src');
      return new Promise(resolve => {
        parsing.push(() => {
          this.stereoData = { ...emptyStereoData(), src };
          resolve();
        });
      });
    };

    element.setAttribute('src', 'first.jpg');
    await wait(50);
    element.setAttribute('src', 'second.jpg');
    await wait(50);

    // Complete all pending parsers, the most recent first.
    for (let i = 0; i < 4; i++) {
      while (parsing.length) {
        parsing.pop()();
      }
      await wait(50);
    }
    await waitFor(() => isLoaded(element), 'the latest picture');

    expect(element.stereoData.src).to.equal('second.jpg');
  }).timeout(20000);
});

function emptyStereoData() {
  return {
    leftEye: new ImageData(10, 10),
    rightEye: new ImageData(10, 10),
    phiLength: 0,
    thetaStart: 0,
    thetaLength: 0,
  };
}
