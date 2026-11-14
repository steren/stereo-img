import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(condition, description, timeout = 30000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await wait(20);
  }
}

/**
 * A side by side picture: shapes on a colour for the left eye, the same shapes on another colour for the right eye.
 * @returns {Promise<string>} its URL
 */
async function makePicture(leftColor = 'rgb(200, 60, 40)', rightColor = 'rgb(40, 60, 200)', eyeWidth = 320, eyeHeight = 240) {
  const canvas = document.createElement('canvas');
  canvas.width = eyeWidth * 2;
  canvas.height = eyeHeight;
  const ctx = canvas.getContext('2d');
  [leftColor, rightColor].forEach((color, eye) => {
    ctx.fillStyle = color;
    ctx.fillRect(eye * eyeWidth, 0, eyeWidth, eyeHeight);
    ctx.fillStyle = 'rgb(240, 240, 200)';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(eye * eyeWidth + eyeWidth * (0.15 + i * 0.14), eyeHeight * (0.3 + (i % 3) * 0.2), eyeHeight / 12, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(blob);
}

describe('stereo-img that starts on interaction', function () {
  this.timeout(120000);

  const elements = [];

  afterEach(async () => {
    for (const element of elements.splice(0)) {
      element.remove();
      element.renderer?.setAnimationLoop(null);
    }
    await wait(20);
  });

  /** Add an element to the page, without waiting for anything. */
  function add(attributes, width = 200, height = 150) {
    const element = document.createElement('stereo-img');
    element.style.display = 'inline-block';
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    for (const [name, value] of Object.entries({ start: 'interaction', ...attributes })) {
      if (value !== null) {
        element.setAttribute(name, value);
      }
    }
    document.body.appendChild(element);
    elements.push(element);
    return element;
  }

  const stills = element => [...element.shadowRoot.querySelectorAll('canvas.still')];
  const shownStill = element => stills(element).find(still => still.style.visibility !== 'hidden');
  const hasStill = element => stills(element).length > 0;
  const isStarted = element => !!element.renderer;
  const isDisplayed = element => isStarted(element) && element.stereoData && !element.loadingIndicator.visible && !hasStill(element);

  /** Add an element and wait for its still. */
  async function addWithStill(attributes, width, height) {
    const element = add(attributes, width, height);
    await waitFor(() => hasStill(element), 'the still');
    return element;
  }

  /** What a viewer does: point at the element with a mouse. */
  const pointAt = element => element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));

  /** The average colour of a canvas, and its pixels. */
  function pixelsOf(canvas) {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, copy.width, copy.height).data;
  }

  function averageColor(canvas) {
    const data = pixelsOf(canvas);
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      sum[0] += data[i];
      sum[1] += data[i + 1];
      sum[2] += data[i + 2];
    }
    return sum.map(value => Math.round(value / (data.length / 4)));
  }

  /** How different two canvases of the same size are, on average, on a scale of 255. */
  function difference(a, b) {
    const first = pixelsOf(a);
    const second = pixelsOf(b);
    if (first.length !== second.length) {
      return Infinity;
    }
    let sum = 0;
    for (let i = 0; i < first.length; i++) {
      sum += Math.abs(first[i] - second[i]);
    }
    return sum / first.length;
  }

  /** What a started element shows, now. */
  function frameOf(element) {
    element._renderFrame();
    const copy = document.createElement('canvas');
    copy.width = element.renderer.domElement.width;
    copy.height = element.renderer.domElement.height;
    copy.getContext('2d').drawImage(element.renderer.domElement, 0, 0);
    return copy;
  }

  /** The hidden elements that draw stills: there should be one. */
  const drawers = () => [...document.body.children].filter(child => child.shadowRoot?.querySelector('stereo-img'));

  const isRed = color => color[0] > color[2] + 60;
  const isBlue = color => color[2] > color[0] + 60;

  it('shows a still of the picture, without WebGL', async () => {
    const element = await addWithStill({ src: await makePicture(), type: 'left-right' });

    expect(isStarted(element)).to.equal(false);
    expect(element.shadowRoot.querySelectorAll('canvas').length).to.equal(1);
    expect(element.shadowRoot.querySelector('#VRButton')).to.equal(null);
    expect(element.shadowRoot.querySelector('#flatModeButton')).to.equal(null);
    // the left eye
    expect(isRed(averageColor(shownStill(element))), `colour of the still: ${averageColor(shownStill(element))}`).to.equal(true);
  });

  it('still starts by itself without the attribute', async () => {
    const element = add({ start: null, src: await makePicture(), type: 'left-right' });

    expect(isStarted(element)).to.equal(true);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
    expect(hasStill(element)).to.equal(false);
  });

  it('uses one WebGL context for the stills of a page full of pictures', async () => {
    const src = await makePicture();
    const many = Array.from({ length: 24 }, () => add({ src, type: 'left-right' }, 100, 75));

    await waitFor(() => many.every(hasStill), 'the stills');

    expect(many.some(isStarted)).to.equal(false);
    expect(many.every(element => isRed(averageColor(shownStill(element))))).to.equal(true);
    expect(drawers().length).to.equal(1);
    // what draws the stills is not one of the pictures of the page
    expect(document.querySelectorAll('stereo-img').length).to.equal(24);
  });

  for (const [description, attributes] of [
    ['a flat picture', { type: 'left-right' }],
    ['the right eye', { type: 'left-right', flat: 'right' }],
    ['an anaglyph', { type: 'left-right', flat: 'anaglyph' }],
    ['a picture of 180 degrees', { type: 'left-right', angle: '180' }],
    ['a moved picture', { type: 'left-right', 'disparity-adjustment': '10' }],
  ]) {
    it(`shows in the still what the started element shows: ${description}`, async () => {
      const element = await addWithStill({ src: await makePicture(), ...attributes }, 240, 180);
      const still = shownStill(element);

      pointAt(element);
      await waitFor(() => isDisplayed(element), 'the picture in 3D');

      expect(difference(still, frameOf(element)), 'average difference').to.be.below(1);
    });
  }

  for (const type of ['pointerenter', 'pointerdown', 'touchstart']) {
    it(`starts on ${type}`, async () => {
      const element = await addWithStill({ src: await makePicture(), type: 'left-right' });

      element.dispatchEvent(type === 'touchstart' ? new Event(type) : new PointerEvent(type, { pointerType: 'mouse' }));

      // at once: the canvas of WebGL under the still, which hides that the picture is loading again
      expect(isStarted(element)).to.equal(true);
      expect(hasStill(element)).to.equal(true);
      await waitFor(() => isDisplayed(element), 'the picture in 3D');
      expect(element.shadowRoot.querySelector('#flatModeButton')).to.not.equal(null);
    });
  }

  it('starts once, whatever the viewer does next', async () => {
    const element = await addWithStill({ src: await makePicture(), type: 'left-right' });

    pointAt(element);
    const renderer = element.renderer;
    element.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse' }));
    element.dispatchEvent(new Event('touchstart'));
    await waitFor(() => isDisplayed(element), 'the picture in 3D');
    pointAt(element);

    expect(element.renderer).to.equal(renderer);
    expect(element.shadowRoot.querySelectorAll('canvas').length).to.equal(1);
  });

  it('starts an element whose still is not drawn yet', async () => {
    const element = add({ src: await makePicture(), type: 'left-right' });

    pointAt(element);

    expect(isStarted(element)).to.equal(true);
    await waitFor(() => isDisplayed(element), 'the picture in 3D');
    await wait(300);
    expect(hasStill(element)).to.equal(false);
  });

  it('keeps four elements started: the ones used the longest ago show a still again', async () => {
    const src = await makePicture();
    const six = Array.from({ length: 6 }, () => add({ src, type: 'left-right' }));
    await waitFor(() => six.every(hasStill), 'the stills');

    for (const element of six) {
      pointAt(element);
      await waitFor(() => isDisplayed(element), 'the picture in 3D');
    }

    expect(six.map(isStarted)).to.deep.equal([false, false, true, true, true, true]);
    // the first ones show what they were showing
    for (const element of six.slice(0, 2)) {
      expect(hasStill(element)).to.equal(true);
      expect(element.shadowRoot.querySelectorAll('canvas').length).to.equal(1);
      expect(element.shadowRoot.querySelector('#flatModeButton')).to.equal(null);
      expect(isRed(averageColor(shownStill(element)))).to.equal(true);
    }

    // and start again when asked, in place of the one used the longest ago
    pointAt(six[0]);
    await waitFor(() => isDisplayed(six[0]), 'the first picture in 3D, again');
    expect(six.map(isStarted)).to.deep.equal([true, false, false, true, true, true]);
  });

  it('does not stop an element that the viewer keeps using', async () => {
    const src = await makePicture();
    const five = Array.from({ length: 5 }, () => add({ src, type: 'left-right' }));
    await waitFor(() => five.every(hasStill), 'the stills');
    for (const element of five.slice(0, 4)) {
      pointAt(element);
      await waitFor(() => isDisplayed(element), 'the picture in 3D');
    }

    // back to the first one, then on to a fifth
    five[0].dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse' }));
    pointAt(five[4]);
    await waitFor(() => isDisplayed(five[4]), 'the fifth picture in 3D');

    expect(five.map(isStarted)).to.deep.equal([true, false, true, true, true]);
  });

  it('shows the view of the viewer in the still of an element that was stopped', async () => {
    const src = await makePicture();
    const five = Array.from({ length: 5 }, () => add({ src, type: 'left-right' }));
    await waitFor(() => five.every(hasStill), 'the stills');
    pointAt(five[0]);
    await waitFor(() => isDisplayed(five[0]), 'the first picture in 3D');
    // the viewer looks at the right eye
    five[0].setAttribute('flat', 'right');
    const frame = frameOf(five[0]);

    for (const element of five.slice(1)) {
      pointAt(element);
      await waitFor(() => isDisplayed(element), 'the picture in 3D');
    }

    expect(isStarted(five[0])).to.equal(false);
    expect(isBlue(averageColor(shownStill(five[0])))).to.equal(true);
    expect(difference(shownStill(five[0]), frame), 'average difference').to.be.below(1);
  });

  it('draws the still again when the picture changes', async () => {
    const element = await addWithStill({ src: await makePicture(), type: 'left-right' });
    const before = shownStill(element);

    element.setAttribute('src', await makePicture('rgb(40, 200, 60)', 'rgb(40, 60, 200)'));
    await waitFor(() => hasStill(element) && shownStill(element) !== before, 'the new still');

    expect(isStarted(element)).to.equal(false);
    expect(stills(element).length).to.equal(1);
    const color = averageColor(shownStill(element));
    expect(color[1] > color[0] + 60, `colour of the still: ${color}`).to.equal(true);
  });

  it('draws the still again when the eye to show changes', async () => {
    const element = await addWithStill({ src: await makePicture(), type: 'left-right' });
    const before = shownStill(element);

    element.setAttribute('flat', 'right');
    await waitFor(() => hasStill(element) && shownStill(element) !== before, 'the new still');

    expect(isBlue(averageColor(shownStill(element)))).to.equal(true);
  });

  it('wiggles without WebGL', async () => {
    const element = await addWithStill({ src: await makePicture(), type: 'left-right', flat: 'wiggle' });

    expect(stills(element).length).to.equal(2);
    const seen = new Set();
    const start = Date.now();
    while (Date.now() - start < 1000) {
      seen.add(isRed(averageColor(shownStill(element))) ? 'left' : 'right');
      await wait(30);
    }
    expect([...seen].sort()).to.deep.equal(['left', 'right']);
    expect(isStarted(element)).to.equal(false);

    // and keeps wiggling once started
    pointAt(element);
    await waitFor(() => isDisplayed(element), 'the picture in 3D');
    expect(element.wiggleIntervalID).to.not.equal(null);
  });

  it('shows the still again if the browser takes the GPU away from a started element', async () => {
    const element = await addWithStill({ src: await makePicture(), type: 'left-right' });
    pointAt(element);
    await waitFor(() => isDisplayed(element), 'the picture in 3D');

    // what three.js says about it is not for this test
    const original = console.log;
    console.log = () => {};
    try {
      element.renderer.forceContextLoss();
      await waitFor(() => !isStarted(element), 'the element to stop');
    } finally {
      console.log = original;
    }

    expect(hasStill(element)).to.equal(true);
    expect(isRed(averageColor(shownStill(element)))).to.equal(true);

    pointAt(element);
    await waitFor(() => isDisplayed(element), 'the picture in 3D, again');
  });

  it('draws the stills of the other elements when one is removed before its turn', async () => {
    const src = await makePicture();
    const first = add({ src, type: 'left-right' });
    const second = add({ src, type: 'left-right' });
    const third = add({ src, type: 'left-right' });

    second.remove();
    await waitFor(() => hasStill(first) && hasStill(third), 'the stills');

    expect(hasStill(second)).to.equal(false);
    // back on the page, it gets its still
    document.body.appendChild(second);
    await waitFor(() => hasStill(second), 'the still of the element that came back');
  });

  it('keeps its still when it is moved on the page', async () => {
    const element = await addWithStill({ src: await makePicture(), type: 'left-right' });
    const still = shownStill(element);

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.appendChild(element);
    await wait(100);

    expect(shownStill(element)).to.equal(still);
    expect(isStarted(element)).to.equal(false);
    container.remove();
  });

  it('draws the still of an element when it gets a size', async () => {
    const element = add({ src: await makePicture(), type: 'left-right' });
    element.style.display = 'none';
    await wait(500);
    expect(hasStill(element)).to.equal(false);

    element.style.display = 'inline-block';
    await waitFor(() => hasStill(element), 'the still');
  });

  it('draws the still again when the element changes shape', async () => {
    const element = await addWithStill({ src: await makePicture(), type: 'left-right' }, 200, 150);
    const before = shownStill(element);
    expect(before.width / before.height).to.be.closeTo(200 / 150, 0.02);

    element.style.height = '300px';
    await waitFor(() => hasStill(element) && shownStill(element) !== before, 'the new still');

    expect(shownStill(element).width / shownStill(element).height).to.be.closeTo(200 / 300, 0.02);
  });

  it('shows a dark still for a picture that cannot be loaded, and says why', async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    let element;
    try {
      element = await addWithStill({ src: '/examples/does-not-exist.jpg' });
    } finally {
      console.error = original;
    }

    expect(errors.some(error => error.includes('does-not-exist.jpg'))).to.equal(true);
    expect(averageColor(shownStill(element)).every(value => value < 40)).to.equal(true);
  });

  it('draws the stills of photos', async () => {
    const photos = [
      add({ src: '/examples/calf-left-right.jpg' }),
      add({ src: '/examples/vr180-lenovo-mirage.vr.jpg' }),
      add({ src: '/examples/Pixel7Pro.PORTRAIT.jpg' }),
    ];

    await waitFor(() => photos.every(hasStill), 'the stills');

    for (const element of photos) {
      const color = averageColor(shownStill(element));
      expect(color.some(value => value > 40), `colour of the still of ${element.getAttribute('src')}: ${color}`).to.equal(true);
    }
  });
});
