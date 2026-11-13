import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const LEFT_EYE = 1;
const RIGHT_EYE = 2;
const WIDTH = 400;
const HEIGHT = 300;

async function waitFor(condition, description, timeout = 20000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/**
 * A side by side picture where each eye is dark grey with a white vertical bar in its middle.
 * (Not black: a picture with black corners and a black middle is taken for a fisheye one.)
 * @returns {Promise<string>} its URL
 */
async function makePicture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(60, 60, 60)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'white';
  ctx.fillRect(256 - 8, 0, 16, canvas.height);
  ctx.fillRect(768 - 8, 0, 16, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(blob);
}

describe('stereo-img disparity-adjustment', function () {
  this.timeout(30000);

  let element;

  afterEach(() => {
    element?.remove();
    element?.renderer?.setAnimationLoop(null);
  });

  /** Display the picture with the given attributes. */
  async function display(attributes = {}) {
    element = document.createElement('stereo-img');
    element.style.width = `${WIDTH}px`;
    element.style.height = `${HEIGHT}px`;
    element.setAttribute('type', 'left-right');
    element.setAttribute('src', await makePicture());
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
    // draw at one pixel per CSS pixel, whatever the screen
    element.renderer.setPixelRatio(1);
    element.renderer.setSize(WIDTH, HEIGHT);
  }

  /**
   * Draw what an eye sees and find the bar.
   * @returns {number} the horizontal position of the middle of the bar, in pixels from the middle of the element
   */
  function barPosition(eye) {
    element.camera.layers.set(eye);
    element.renderer.render(element.scene, element.camera);
    const gl = element.renderer.getContext();
    const row = new Uint8Array(WIDTH * 4);
    gl.readPixels(0, HEIGHT / 2, WIDTH, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
    const bright = [];
    for (let x = 0; x < WIDTH; x++) {
      if (row[x * 4] > 128) {
        bright.push(x);
      }
    }
    expect(bright.length, 'pixels of the bar').to.be.greaterThan(0);
    return (bright[0] + bright[bright.length - 1]) / 2 - (WIDTH - 1) / 2;
  }

  // The view zooms in to keep both pictures filling the element, so pixels are counted from the field of view in use.
  /** Distance from the middle of the element, in pixels, for one unit of distance at one unit from the viewer. */
  const focal = () => HEIGHT / 2 / Math.tan(element.camera.fov * Math.PI / 360);
  /** On screen, a fraction of the width of a flat picture: 20 units wide, seen from 10 units. */
  const onPlane = fraction => fraction * 20 / 10 * focal();
  /** On screen, where a direction turned by some degrees from straight ahead is. */
  const onSphere = degrees => Math.tan(degrees * Math.PI / 180) * focal();

  it('should show both pictures at the same place by default', async () => {
    await display();

    expect(barPosition(LEFT_EYE)).to.be.closeTo(0, 1);
    expect(barPosition(RIGHT_EYE)).to.be.closeTo(0, 1);
  });

  it('should move the pictures closer together with a negative value', async () => {
    await display({ 'disparity-adjustment': '-20' });

    // each picture moves by 10% of its width
    expect(barPosition(LEFT_EYE)).to.be.closeTo(onPlane(0.1), 2);
    expect(barPosition(RIGHT_EYE)).to.be.closeTo(-onPlane(0.1), 2);
  });

  it('should move the pictures apart with a positive value', async () => {
    await display({ 'disparity-adjustment': '10' });

    expect(barPosition(LEFT_EYE)).to.be.closeTo(-onPlane(0.05), 2);
    expect(barPosition(RIGHT_EYE)).to.be.closeTo(onPlane(0.05), 2);
  });

  it('should turn the pictures that are on a sphere', async () => {
    await display({ angle: '180', 'disparity-adjustment': '-20' });

    // each picture turns by 10% of 180 degrees
    expect(barPosition(LEFT_EYE)).to.be.closeTo(onSphere(18), 3);
    expect(barPosition(RIGHT_EYE)).to.be.closeTo(-onSphere(18), 3);
  });

  it('should follow the attribute without loading the picture again', async () => {
    await display();
    const stereoData = element.stereoData;
    const group = element.stereoImageGroup;

    element.setAttribute('disparity-adjustment', '-20');
    expect(barPosition(LEFT_EYE)).to.be.closeTo(onPlane(0.1), 2);

    element.disparityAdjustment = 10;
    expect(element.getAttribute('disparity-adjustment')).to.equal('10');
    expect(barPosition(LEFT_EYE)).to.be.closeTo(-onPlane(0.05), 2);

    element.disparityAdjustment = 0;
    expect(barPosition(LEFT_EYE)).to.be.closeTo(0, 1);

    element.removeAttribute('disparity-adjustment');
    expect(element.disparityAdjustment).to.equal(null);
    expect(barPosition(RIGHT_EYE)).to.be.closeTo(0, 1);

    expect(element.stereoData === stereoData).to.be.true;
    expect(element.stereoImageGroup === group).to.be.true;
  });

  it('should keep the adjustment when another picture is displayed', async () => {
    await display({ 'disparity-adjustment': '-20' });
    const previous = element.stereoData;

    element.setAttribute('src', await makePicture());
    await waitFor(() => element.stereoData !== previous && !element.loadingIndicator.visible, 'the second picture');

    expect(barPosition(LEFT_EYE)).to.be.closeTo(onPlane(0.1), 2);
    expect(barPosition(RIGHT_EYE)).to.be.closeTo(-onPlane(0.1), 2);
  });

  it('should ignore a value that is not a number', async () => {
    await display({ 'disparity-adjustment': 'a lot' });

    expect(barPosition(LEFT_EYE)).to.be.closeTo(0, 1);
  });

  it('should also move the wireframes of the debug mode', async () => {
    await display({ debug: 'true', 'disparity-adjustment': '-20' });

    const positions = element.stereoImageGroup.children.map(object => object.position.x);
    expect(positions).to.deep.equal([2, 2, -2, -2]);
  });
});
