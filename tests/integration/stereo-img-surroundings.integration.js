import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

async function waitFor(condition, description, timeout = 30000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

const SKY = [40, 80, 240];
const SAND = [200, 160, 40];
const css = color => `rgb(${color.join(', ')})`;

/**
 * A side by side picture: for each eye, a band of one colour at the top, grey in the middle, a band of another colour at the bottom.
 * @param {Array<number>} top - colour of the top band
 * @param {Array<number>} bottom - colour of the bottom band
 * @param {Object} [options]
 * @param {boolean} [options.disc] - each eye is a disc on a black background, as a fisheye lens gives
 * @returns {Promise<string>} its URL
 */
async function makePicture(top, bottom, { eyeWidth = 200, eyeHeight = 150, disc = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = eyeWidth * 2;
  canvas.height = eyeHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const offset of [0, eyeWidth]) {
    ctx.save();
    if (disc) {
      ctx.beginPath();
      ctx.ellipse(offset + eyeWidth / 2, eyeHeight / 2, eyeWidth / 2, eyeHeight / 2, 0, 0, 2 * Math.PI);
      ctx.clip();
    }
    ctx.fillStyle = 'rgb(128, 128, 128)';
    ctx.fillRect(offset, 0, eyeWidth, eyeHeight);
    ctx.fillStyle = css(top);
    ctx.fillRect(offset, 0, eyeWidth, eyeHeight * 0.3);
    ctx.fillStyle = css(bottom);
    ctx.fillRect(offset, eyeHeight * 0.7, eyeWidth, eyeHeight * 0.3);
    ctx.restore();
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(blob);
}

describe('stereo-img surrounds the picture with the colours of its edges', function () {
  this.timeout(60000);

  let element;

  afterEach(() => {
    element?.remove();
    element?.renderer?.setAnimationLoop(null);
    element = null;
  });

  async function display(attributes, width = 400, height = 300) {
    element = document.createElement('stereo-img');
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
    element.renderer.setPixelRatio(1);
    element.renderer.setSize(width, height);
    // the tests place the camera themselves
    element.renderer.setAnimationLoop(null);
  }

  /**
   * The colour drawn in the middle of the element when the camera, in the middle of the scene, looks in a direction.
   * @param {number} azimuth - degrees to the right of the middle of the picture
   * @param {number} elevation - degrees above the horizon
   * @param {number} [eye] - 1 for the left eye, 2 for the right eye
   */
  function colorTowards(azimuth, elevation, eye = 1) {
    const camera = element.camera;
    const radians = degrees => degrees * Math.PI / 180;
    // the middle of the picture is towards -z
    camera.position.set(0, 0, 0);
    camera.lookAt(
      Math.sin(radians(azimuth)) * Math.cos(radians(elevation)),
      Math.sin(radians(elevation)),
      -Math.cos(radians(azimuth)) * Math.cos(radians(elevation)),
    );
    camera.updateMatrixWorld();
    camera.layers.set(eye);
    element.renderer.render(element.scene, camera);
    camera.layers.set(1);

    const gl = element.renderer.getContext();
    const pixel = new Uint8Array(4);
    gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel.slice(0, 3)];
  }

  const dimmed = color => color.map(value => Math.max(16, Math.round(value / 2)));

  function expectColor(actual, expected, description, tolerance = 3) {
    const close = actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance);
    expect(close, `${description}: ${actual} instead of ${expected}`).to.equal(true);
  }

  /** Tell if a colour is somewhere between two others, and is neither of them. */
  function expectBetween(actual, first, second, description) {
    const between = actual.every((value, i) => value >= Math.min(first[i], second[i]) - 3 && value <= Math.max(first[i], second[i]) + 3);
    const distance = other => Math.max(...actual.map((value, i) => Math.abs(value - other[i])));
    expect(between && distance(first) > 10 && distance(second) > 10, `${description}: ${actual} is not between ${first} and ${second}`).to.equal(true);
  }

  it('takes the colours of the top and of the bottom of the picture, dimmed', async () => {
    await display({ src: await makePicture(SKY, SAND), type: 'left-right' });

    expectColor(element.surroundingsColors.top, dimmed(SKY), 'above the picture', 1);
    expectColor(element.surroundingsColors.bottom, dimmed(SAND), 'below the picture', 1);
  });

  it('draws these colours around a flat picture', async () => {
    await display({ src: await makePicture(SKY, SAND), type: 'left-right' });

    // the picture is 20 wide and 15 high, 10 away: it goes up to 37 degrees above the horizon and 45 degrees to the side
    expectColor(colorTowards(0, 30), SKY, 'the picture itself, near its top', 12);
    expectColor(colorTowards(0, 45), dimmed(SKY), 'above the picture');
    expectColor(colorTowards(0, 85), dimmed(SKY), 'far above the picture');
    expectColor(colorTowards(0, -45), dimmed(SAND), 'below the picture');
    expectColor(colorTowards(180, 60), dimmed(SKY), 'above, behind the viewer');
    expectColor(colorTowards(180, -60), dimmed(SAND), 'below, behind the viewer');
  });

  it('goes from one colour to the other beside the picture', async () => {
    await display({ src: await makePicture(SKY, SAND), type: 'left-right' });

    expectBetween(colorTowards(70, 0), dimmed(SKY), dimmed(SAND), 'to the right of the picture');
    expectBetween(colorTowards(-70, 0), dimmed(SKY), dimmed(SAND), 'to the left of the picture');
    expectBetween(colorTowards(180, 0), dimmed(SKY), dimmed(SAND), 'behind the viewer');

    // nearer to the colour of the top next to the top of the picture, and to the colour of the bottom next to its bottom
    const distance = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
    const high = colorTowards(70, 25);
    const low = colorTowards(70, -25);
    expect(distance(high, dimmed(SKY)) < distance(high, dimmed(SAND)), `to the right, high: ${high}`).to.equal(true);
    expect(distance(low, dimmed(SAND)) < distance(low, dimmed(SKY)), `to the right, low: ${low}`).to.equal(true);
  });

  it('draws the same surroundings for both eyes', async () => {
    await display({ src: await makePicture(SKY, SAND), type: 'left-right' });

    for (const [azimuth, elevation] of [[0, 60], [0, -60], [120, 10]]) {
      expect(colorTowards(azimuth, elevation, 2), `towards ${azimuth}, ${elevation}`).to.deep.equal(colorTowards(azimuth, elevation, 1));
    }
    expectColor(colorTowards(0, 60, 2), dimmed(SKY), 'above the picture, for the right eye');
  });

  it('spreads the colours over the whole height behind a picture of 180 degrees', async () => {
    await display({ src: await makePicture(SKY, SAND, { eyeWidth: 256, eyeHeight: 256 }), type: 'left-right', angle: '180' });

    expectColor(element.surroundingsColors.top, dimmed(SKY), 'the colour of the top', 1);
    expectColor(element.surroundingsColors.bottom, dimmed(SAND), 'the colour of the bottom', 1);

    // the picture is in front
    expectColor(colorTowards(0, 60), SKY, 'the picture, in front', 12);
    // behind the viewer, the colours only meet the colours of the edges at the very top and the very bottom
    expectBetween(colorTowards(180, 45), dimmed(SKY), dimmed(SAND), 'behind, 45 degrees up');
    expectBetween(colorTowards(180, -45), dimmed(SKY), dimmed(SAND), 'behind, 45 degrees down');
    expectColor(colorTowards(180, 88), dimmed(SKY), 'behind, at the top', 6);
    expectColor(colorTowards(180, -88), dimmed(SAND), 'behind, at the bottom', 6);
  });

  it('ignores the black around the disc of a fisheye picture', async () => {
    await display({ src: await makePicture(SKY, SAND, { eyeWidth: 256, eyeHeight: 256, disc: true }), type: 'left-right', angle: '180', projection: 'fisheye' });

    expectColor(element.surroundingsColors.top, dimmed(SKY), 'the colour of the top', 4);
    expectColor(element.surroundingsColors.bottom, dimmed(SAND), 'the colour of the bottom', 4);
  });

  it('follows the picture', async () => {
    await display({ src: await makePicture(SKY, SAND), type: 'left-right' });
    const before = element.stereoData;

    element.setAttribute('src', await makePicture([240, 40, 40], [40, 200, 40]));
    await waitFor(() => element.stereoData !== before && !element.loadingIndicator.visible, 'the second picture');
    element.renderer.setAnimationLoop(null);

    expectColor(element.surroundingsColors.top, [120, 20, 20], 'the colour of the top', 1);
    expectColor(element.surroundingsColors.bottom, [20, 100, 20], 'the colour of the bottom', 1);
    expectColor(colorTowards(0, 60), [120, 20, 20], 'above the picture');
    expectColor(colorTowards(0, -60), [20, 100, 20], 'below the picture');
  });

  it('stays dark around a dark picture', async () => {
    await display({ src: await makePicture([0, 0, 0], [0, 0, 0]), type: 'left-right' });

    expect(element.surroundingsColors).to.deep.equal({ top: [16, 16, 16], bottom: [16, 16, 16] });
    for (const [azimuth, elevation] of [[0, 60], [0, -60], [90, 0], [180, 0]]) {
      expectColor(colorTowards(azimuth, elevation), [16, 16, 16], `towards ${azimuth}, ${elevation}`, 1);
    }
  });

  it('is dark around an element without a picture', async () => {
    element = document.createElement('stereo-img');
    element.style.width = '400px';
    element.style.height = '300px';
    document.body.appendChild(element);
    await waitFor(() => element.surroundings, 'the scene');
    element.renderer.setPixelRatio(1);
    element.renderer.setSize(400, 300);
    element.renderer.setAnimationLoop(null);
    element.loadingIndicator.visible = false;

    expect(element.surroundingsColors).to.deep.equal({ top: [16, 16, 16], bottom: [16, 16, 16] });
    expectColor(colorTowards(0, 0), [16, 16, 16], 'in front', 1);
  });

  it('is dark around a picture that cannot be loaded', async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
      await display({ src: await makePicture(SKY, SAND), type: 'left-right' });
      const before = element.stereoData;
      element.setAttribute('src', '/examples/does-not-exist.jpg');
      await waitFor(() => element.stereoData !== before && !element.loadingIndicator.visible, 'the missing picture');
    } finally {
      console.error = original;
    }

    expect(errors.length).to.be.greaterThan(0);
    expect(element.surroundingsColors).to.deep.equal({ top: [16, 16, 16], bottom: [16, 16, 16] });
  });

  it('takes the colours of a photo, whatever the kind of picture', async () => {
    // a depth picture is drawn from an image element, the others from pixels
    for (const [src, type] of [
      ['/examples/Pixel7Pro.PORTRAIT.jpg', null],
      ['/examples/calf-left-right.jpg', null],
      ['/examples/canon-eos-r5-dual-fisheye.jpg', null],
      ['/examples/Panasonic-DMC-GX8-left.jpg', 'pair'],
    ]) {
      const attributes = { src };
      if (type === 'pair') {
        attributes['src-right'] = '/examples/Panasonic-DMC-GX8-right.jpg';
      }
      await display(attributes);

      const { top, bottom } = element.surroundingsColors;
      expect(top.concat(bottom).some(value => value > 16), `${src}: ${top} and ${bottom}`).to.equal(true);
      expect(top.concat(bottom).every(value => value >= 16 && value <= 128), `${src}: ${top} and ${bottom}`).to.equal(true);

      element.remove();
      element = null;
    }
  });
});
