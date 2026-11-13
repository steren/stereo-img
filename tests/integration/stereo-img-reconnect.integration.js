import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function createElement() {
  const element = document.createElement('stereo-img');
  element.style.width = '400px';
  element.style.height = '300px';
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
    element = createElement();
    document.body.appendChild(element);
    await wait(200);
    const counter = countFrames(element);
    await wait(200);
    expect(counter.frames).to.be.greaterThan(0);

    element.remove();
    await wait(50);
    const framesWhenRemoved = counter.frames;
    await wait(200);

    expect(counter.frames).to.equal(framesWhenRemoved);
  });

  it('should render again when added back', async () => {
    element = createElement();
    document.body.appendChild(element);
    await wait(200);
    const counter = countFrames(element);

    element.remove();
    await wait(50);
    const framesWhenRemoved = counter.frames;
    document.body.appendChild(element);
    await wait(200);

    expect(counter.frames).to.be.greaterThan(framesWhenRemoved);
  });

  it('should wiggle again when added back', async () => {
    element = createElement();
    element.setAttribute('flat', 'wiggle');
    document.body.appendChild(element);
    await wait(200);
    expect(element.wiggleIntervalID).to.exist;

    element.remove();
    expect(element.wiggleIntervalID).to.not.exist;

    document.body.appendChild(element);
    await wait(50);
    expect(element.wiggleIntervalID).to.exist;
  });

  it('should follow size changes when added back', async () => {
    element = createElement();
    document.body.appendChild(element);
    await wait(200);
    expect(element.renderer.domElement.style.width).to.equal('400px');

    element.remove();
    document.body.appendChild(element);
    element.style.width = '200px';
    await wait(200);

    expect(element.renderer.domElement.style.width).to.equal('200px');
  });

  it('should not start rendering when removed before the picture is loaded', async () => {
    element = createElement();
    element.setAttribute('src', '/examples/Panasonic-DMC-GX8-left.jpg');
    document.body.appendChild(element);
    const counter = countFrames(element);
    element.remove();

    const start = Date.now();
    while (!element.stereoData && Date.now() - start < 15000) {
      await wait(50);
    }
    await wait(200);

    expect(element.stereoData).to.exist;
    expect(counter.frames).to.equal(0);
  }).timeout(20000);
});
