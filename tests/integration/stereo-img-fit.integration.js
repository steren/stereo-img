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

/**
 * A side by side picture with nothing dark in it.
 * @param {number} eyeWidth - width of the picture of one eye
 * @param {number} eyeHeight - height of the picture of one eye
 * @returns {Promise<string>} its URL
 */
async function makePicture(eyeWidth, eyeHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = eyeWidth * 2;
  canvas.height = eyeHeight;
  const ctx = canvas.getContext('2d');
  for (const offset of [0, eyeWidth]) {
    const gradient = ctx.createLinearGradient(offset, 0, offset + eyeWidth, eyeHeight);
    gradient.addColorStop(0, 'rgb(120, 200, 90)');
    gradient.addColorStop(1, 'rgb(90, 120, 220)');
    ctx.fillStyle = gradient;
    ctx.fillRect(offset, 0, eyeWidth, eyeHeight);
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(blob);
}

describe('stereo-img fills the element with the picture', function () {
  this.timeout(60000);

  let element;
  let canvas;

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
    canvas = element.renderer.domElement;
    // draw at one pixel per CSS pixel, whatever the screen
    element.renderer.setPixelRatio(1);
    element.renderer.setSize(width, height);
  }

  /**
   * Draw what each eye sees, over a background of a colour that no picture has,
   * and count the pixels of that colour along the edges of the element.
   */
  function marginPixels() {
    const { width, height } = canvas;
    const background = element.scene.background;
    element.scene.background = background.clone().setRGB(1, 0, 1);
    // what surrounds the picture is not the picture
    const surroundings = element.surroundings;
    if (surroundings) {
      surroundings.visible = false;
    }
    const gl = element.renderer.getContext();
    let margin = 0;
    const countMagenta = (x, y, w, h) => {
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 200 && pixels[i + 1] < 60 && pixels[i + 2] > 200) {
          margin++;
        }
      }
    };
    try {
      for (const eye of [1, 2]) {
        element.camera.layers.set(eye);
        element.renderer.render(element.scene, element.camera);
        countMagenta(0, 0, width, 1);
        countMagenta(0, height - 1, width, 1);
        countMagenta(0, 0, 1, height);
        countMagenta(width - 1, 0, 1, height);
      }
    } finally {
      element.scene.background = background;
      element.camera.layers.set(1);
      if (surroundings) {
        surroundings.visible = true;
      }
    }
    return margin;
  }

  function pointer(type, x, y) {
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, bubbles: true,
      clientX: rect.left + rect.width / 2 + x, clientY: rect.top + rect.height / 2 + y,
    }));
  }

  /** Drag the picture by a distance, in several steps. */
  function drag(x, y) {
    pointer('pointerdown', 0, 0);
    for (let step = 1; step <= 10; step++) {
      pointer('pointermove', x * step / 10, y * step / 10);
    }
    pointer('pointerup', x, y);
  }

  const wheel = deltaY => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));

  /** Push the view as far as it goes in every direction, and zoom in and out: the picture must always fill the element. */
  function expectNoMarginWhateverTheGesture() {
    expect(marginPixels(), 'at first').to.equal(0);
    for (const [x, y] of [[-3000, 0], [3000, 0], [0, -3000], [0, 3000], [3000, 3000], [-3000, -3000], [-3000, 3000], [70, -40]]) {
      drag(x, y);
      expect(marginPixels(), `after dragging by ${x}, ${y}`).to.equal(0);
    }
    for (const deltaY of [-600, 2000, -200, 2000]) {
      wheel(deltaY);
      expect(marginPixels(), `after turning the wheel by ${deltaY}`).to.equal(0);
      drag(-3000, 3000);
      expect(marginPixels(), `after turning the wheel by ${deltaY} and dragging`).to.equal(0);
    }
  }

  for (const [description, eyeWidth, eyeHeight, width, height] of [
    ['a picture wider than the element', 400, 200, 400, 300],
    ['a picture taller than the element', 200, 400, 400, 300],
    ['a picture of the shape of the element', 400, 300, 400, 300],
    ['a picture in a wide element', 400, 300, 480, 160],
    ['a picture in a tall element', 400, 300, 200, 420],
  ]) {
    it(`should fill the element with ${description}`, async () => {
      await display({ type: 'left-right', src: await makePicture(eyeWidth, eyeHeight) }, width, height);

      expectNoMarginWhateverTheGesture();
    });
  }

  it('should show a picture of the shape of the element entirely', async () => {
    await display({ type: 'left-right', src: await makePicture(400, 300) });

    // On a plane 20 units wide seen from 10 units, the whole height of a 4:3 picture takes a vertical field of view of 73.7 degrees.
    // The view starts at 70 degrees, and zooms out to all of the picture.
    expect(element.camera.fov).to.equal(70);
    wheel(2000);
    expect(element.camera.fov).to.be.closeTo(73.74, 0.01);
  });

  it('should zoom in on a picture that is wider than the element, to fill it', async () => {
    await display({ type: 'left-right', src: await makePicture(400, 200) });

    // the height of a 2:1 picture takes 53.1 degrees
    expect(element.camera.fov).to.be.closeTo(53.13, 0.01);
    // Its sides are out of view at first: a third of its half width, on each side.
    // They can be dragged into view, the camera staying in front of the picture.
    drag(-3000, 0);
    expect(element.controls.mode).to.equal('pan');
    expect(element.camera.position.x).to.be.closeTo(10 / 3, 0.01);
    expect(element.camera.getWorldDirection(element.camera.position.clone()).z).to.be.closeTo(-1, 1e-6);
    drag(3000, 0);
    expect(element.camera.position.x).to.be.closeTo(-10 / 3, 0.01);
  });

  it('should move a flat picture with the pointer', async () => {
    await display({ type: 'left-right', src: await makePicture(400, 300) });
    // zoom in, to have room to move
    wheel(-600);
    expect(element.camera.fov).to.equal(40);
    const Vector3 = element.camera.position.constructor;
    const project = point => {
      element.camera.updateMatrixWorld(true);
      const projected = point.clone().project(element.camera);
      return { x: projected.x * 200, y: -projected.y * 150 };
    };
    // the point of the picture that is displayed 30 pixels right of the middle of the element
    element.camera.updateMatrixWorld(true);
    const direction = new Vector3(30 / 200, 0, 0.5).unproject(element.camera).sub(element.camera.position);
    const grabbed = element.camera.position.clone().addScaledVector(direction, -10 / direction.z);

    pointer('pointerdown', 30, 0);
    pointer('pointermove', -20, 25);
    pointer('pointerup', -20, 25);

    // it followed the pointer, and the camera still looks straight ahead
    expect(project(grabbed).x).to.be.closeTo(-20, 0.5);
    expect(project(grabbed).y).to.be.closeTo(25, 0.5);
    expect(element.camera.getWorldDirection(new Vector3()).z).to.be.closeTo(-1, 1e-6);
  });

  for (const [description, attributes] of [
    ['a part of a sphere', { type: 'left-right', angle: '120' }],
    ['half a sphere', { type: 'left-right', angle: '180' }],
    ['a regular picture on half a sphere', { type: 'mono', angle: '180' }],
    ['pictures moved apart', { type: 'left-right', 'disparity-adjustment': '12' }],
    ['pictures moved closer on a sphere', { type: 'left-right', angle: '120', 'disparity-adjustment': '-20' }],
  ]) {
    it(`should fill the element with ${description}`, async () => {
      await display({ src: await makePicture(400, 300), ...attributes });

      expectNoMarginWhateverTheGesture();
    });
  }

  for (const [description, attributes] of [
    ['a panorama that is not as tall as the view', { src: '/examples/pixel3xl.PANO.jpg' }],
    ['a VR180 photo', { src: '/examples/vr180-lenovo-mirage.vr.jpg' }],
    ['a VR180 photo that is tilted', { src: '/examples/vr180-lenovo-pitch-roll.vr.jpg' }],
    ['a picture with relief', { src: '/examples/Pixel7Pro.PORTRAIT.jpg' }],
    ['a fisheye picture', { src: '/examples/canon-eos-r5-dual-fisheye.jpg' }],
  ]) {
    it(`should fill the element with ${description}`, async () => {
      await display(attributes);

      expectNoMarginWhateverTheGesture();
    });
  }

  it('should leave a full sphere free', async () => {
    await display({ type: 'mono', angle: '360', src: await makePicture(400, 200) });

    expect(element.camera.fov).to.equal(70);
    wheel(2000);
    expect(element.camera.fov).to.equal(100);
    for (let i = 0; i < 6; i++) {
      drag(-3000, 0);
    }
    expect(element.controls.lon).to.be.greaterThan(360);
    expect(marginPixels()).to.equal(0);
  });

  it('should keep filling the element when its shape changes', async () => {
    await display({ type: 'left-right', src: await makePicture(400, 300) });
    wheel(2000);
    drag(-3000, -3000);

    element.style.width = '300px';
    element.style.height = '420px';
    await waitFor(() => canvas.style.width === '300px', 'the element to be resized');
    element.renderer.setPixelRatio(1);
    element.renderer.setSize(300, 420);

    expect(marginPixels()).to.equal(0);
    expectNoMarginWhateverTheGesture();
  });

  it('should look at the middle of a picture that is not in front', async () => {
    // a band of the sphere, well above the horizon
    await display({ type: 'left-right', angle: '120', src: await makePicture(400, 100) });
    const data = element.stereoData;
    data.thetaStart = 20 * Math.PI / 180;
    await element.initialize3DScene();
    element.controls.reset(70, element._pictureCenter());

    // the band goes from 40 to 70 degrees above the horizon
    expect(element.controls.lat).to.be.closeTo(55, 0.5);
    expect(marginPixels()).to.equal(0);
  });
});
