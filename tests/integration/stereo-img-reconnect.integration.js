import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Frames and resize notifications can be late when the browser is busy with
// other test files: wait for what is expected instead of a fixed delay.
async function waitFor(condition, description, timeout = 15000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await wait(20);
  }
}

/** Create an element, add it to the page and wait for it to be initialized. */
async function createElement(attributes = {}) {
  const element = document.createElement('stereo-img');
  element.style.width = '400px';
  element.style.height = '300px';
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.body.appendChild(element);
  await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the element to be initialized');
  return element;
}

/** Count the frames drawn by the element. */
function countFrames(element) {
  const counter = { frames: 0 };
  const render = element.renderer.render.bind(element.renderer);
  element.renderer.render = (...args) => {
    counter.frames++;
    return render(...args);
  };
  return counter;
}

describe('stereo-img removed from and added back to the document', () => {
  let element;

  afterEach(() => {
    element?.remove();
  });

  it('should stop rendering while it is out of the document', async () => {
    element = await createElement();
    const counter = countFrames(element);
    await waitFor(() => counter.frames > 0, 'a first frame');

    element.remove();
    await wait(50);
    const framesWhenRemoved = counter.frames;
    await wait(300);

    expect(counter.frames).to.equal(framesWhenRemoved);
  }).timeout(20000);

  it('should render again when added back', async () => {
    element = await createElement();
    const counter = countFrames(element);
    await waitFor(() => counter.frames > 0, 'a first frame');

    element.remove();
    await wait(50);
    const framesWhenRemoved = counter.frames;
    document.body.appendChild(element);

    await waitFor(() => counter.frames > framesWhenRemoved, 'a frame after being added back');
  }).timeout(40000);

  it('should wiggle again when added back', async () => {
    element = await createElement({ flat: 'wiggle' });
    await waitFor(() => element.wiggleIntervalID, 'the wiggle to start');

    element.remove();
    expect(element.wiggleIntervalID).to.not.exist;

    document.body.appendChild(element);
    expect(element.wiggleIntervalID).to.exist;
  }).timeout(20000);

  it('should follow size changes when added back', async () => {
    element = await createElement();
    expect(element.renderer.domElement.style.width).to.equal('400px');

    element.remove();
    document.body.appendChild(element);
    element.style.width = '200px';

    await waitFor(() => element.renderer.domElement.style.width === '200px', 'the canvas to be resized');
  }).timeout(20000);

  it('should not start rendering when removed before the picture is loaded', async () => {
    element = document.createElement('stereo-img');
    element.setAttribute('src', '/examples/Panasonic-DMC-GX8-left.jpg');
    document.body.appendChild(element);
    const counter = countFrames(element);
    element.remove();

    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture to be loaded');
    await wait(300);

    expect(counter.frames).to.equal(0);
  }).timeout(20000);
});
