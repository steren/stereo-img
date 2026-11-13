import { expect } from '@esm-bundle/chai';
import { XRDevice, metaQuest3 } from 'iwer';
import '../../stereo-img.js';

// There is no VR headset here: emulate one.
const xrDevice = new XRDevice(metaQuest3);
xrDevice.installRuntime({ forceInstall: true });

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

describe('stereo-img controls outside of VR', function () {
  this.timeout(30000);

  let element;
  let canvas;
  let Vector3;
  // position of the middle of the element in the page
  let middle;

  beforeEach(async () => {
    element = document.createElement('stereo-img');
    element.style.width = `${WIDTH}px`;
    element.style.height = `${HEIGHT}px`;
    // a full sphere: there is something to look at in every direction
    element.setAttribute('type', 'mono');
    element.setAttribute('angle', '360');
    element.setAttribute('src', '/examples/persepolis.anaglyph.jpg');
    document.body.appendChild(element);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
    canvas = element.renderer.domElement;
    Vector3 = element.camera.position.constructor;
    const rect = canvas.getBoundingClientRect();
    middle = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  afterEach(async () => {
    if (element.renderer.xr.isPresenting) {
      await element.renderer.xr.getSession().end();
    }
    element.remove();
    element.renderer.setAnimationLoop(null);
  });

  /** Send a pointer event to the picture, at a position given from the middle of the element. */
  function pointer(type, x, y, options = {}) {
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true, bubbles: true, cancelable: true,
      clientX: middle.x + x, clientY: middle.y + y, ...options,
    }));
  }

  function drag(from, to, options) {
    pointer('pointerdown', from.x, from.y, options);
    // in several steps, like a real gesture
    for (let step = 1; step <= 5; step++) {
      pointer('pointermove', from.x + (to.x - from.x) * step / 5, from.y + (to.y - from.y) * step / 5, options);
    }
    pointer('pointerup', to.x, to.y, options);
  }

  /** The point of the scene that is displayed at a position of the element. */
  function pointAt(x, y) {
    element.camera.updateMatrixWorld(true);
    return new Vector3(x / (WIDTH / 2), -y / (HEIGHT / 2), 0.5).unproject(element.camera);
  }

  /** The position of the element where a point of the scene is displayed. */
  function positionOf(point) {
    element.camera.updateMatrixWorld(true);
    const projected = point.clone().project(element.camera);
    return { x: projected.x * WIDTH / 2, y: -projected.y * HEIGHT / 2 };
  }

  /** Where the camera looks: x to the right, y up, z towards the viewer. */
  const direction = () => element.camera.getWorldDirection(new Vector3());

  it('should look straight at the picture at first', () => {
    expect(direction().x).to.be.closeTo(0, 1e-6);
    expect(direction().y).to.be.closeTo(0, 1e-6);
    expect(direction().z).to.be.closeTo(-1, 1e-6);
    expect(element.camera.fov).to.equal(70);
    expect(canvas.style.cursor).to.equal('grab');
  });

  it('should move the picture with the pointer when dragging sideways', () => {
    const grabbed = pointAt(60, 0);

    drag({ x: 60, y: 0 }, { x: -40, y: 0 });

    // what was under the pointer is still under it
    expect(positionOf(grabbed).x).to.be.closeTo(-40, 1);
    expect(positionOf(grabbed).y).to.be.closeTo(0, 1);
    // the picture went to the left: the camera turned to the right
    expect(direction().x).to.be.greaterThan(0.2);
  });

  it('should move the picture with the pointer when dragging up and down', () => {
    const grabbed = pointAt(0, -30);

    drag({ x: 0, y: -30 }, { x: 0, y: 50 });

    expect(positionOf(grabbed).x).to.be.closeTo(0, 1);
    expect(positionOf(grabbed).y).to.be.closeTo(50, 1);
    // the picture went down: the camera turned up
    expect(direction().y).to.be.greaterThan(0.2);
  });

  it('should follow the pointer in both directions at once', () => {
    const grabbed = pointAt(20, 10);

    drag({ x: 20, y: 10 }, { x: 90, y: -50 });

    expect(positionOf(grabbed).x).to.be.closeTo(90, 12);
    expect(positionOf(grabbed).y).to.be.closeTo(-50, 12);
  });

  it('should not move when the pointer moves without being pressed', () => {
    pointer('pointermove', 0, 0);
    pointer('pointermove', 100, 50);

    expect(direction().z).to.be.closeTo(-1, 1e-6);
  });

  it('should stop following the pointer once released', () => {
    drag({ x: 0, y: 0 }, { x: -50, y: 0 });
    const after = direction().clone();

    pointer('pointermove', 100, 100);

    expect(direction().x).to.equal(after.x);
    expect(direction().y).to.equal(after.y);
    expect(canvas.style.cursor).to.equal('grab');
  });

  it('should ignore the other buttons of the mouse', () => {
    drag({ x: 0, y: 0 }, { x: -50, y: 0 }, { button: 2 });

    expect(direction().z).to.be.closeTo(-1, 1e-6);
  });

  it('should not look further than straight up or down', () => {
    for (let i = 0; i < 10; i++) {
      drag({ x: 0, y: -100 }, { x: 0, y: 100 });
    }
    expect(Math.asin(direction().y) * 180 / Math.PI).to.be.closeTo(85, 0.01);

    for (let i = 0; i < 20; i++) {
      drag({ x: 0, y: 100 }, { x: 0, y: -100 });
    }
    expect(Math.asin(direction().y) * 180 / Math.PI).to.be.closeTo(-85, 0.01);
  });

  it('should turn all the way around', () => {
    for (let i = 0; i < 8; i++) {
      drag({ x: 100, y: 0 }, { x: -100, y: 0 });
    }

    // more than a full turn to the right
    expect(element.controls.lon).to.be.greaterThan(360);
  });

  it('should zoom with the wheel, within limits', () => {
    const wheel = deltaY => {
      const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
      canvas.dispatchEvent(event);
      return event;
    };

    const event = wheel(-100);
    expect(element.camera.fov).to.equal(65);
    // the page does not scroll
    expect(event.defaultPrevented).to.be.true;

    wheel(200);
    expect(element.camera.fov).to.equal(75);

    for (let i = 0; i < 20; i++) wheel(-500);
    expect(element.camera.fov).to.equal(20);
    for (let i = 0; i < 20; i++) wheel(500);
    expect(element.camera.fov).to.equal(100);
  });

  it('should move by the same angle whatever the zoom', () => {
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -800, bubbles: true, cancelable: true }));
    expect(element.camera.fov).to.equal(30);
    const grabbed = pointAt(60, 0);

    drag({ x: 60, y: 0 }, { x: -40, y: 0 });

    expect(positionOf(grabbed).x).to.be.closeTo(-40, 1);
  });

  it('should zoom with a pinch', () => {
    const touch = (type, id, x, y) => pointer(type, x, y, { pointerId: id, pointerType: 'touch', isPrimary: id === 1 });
    touch('pointerdown', 1, -50, 0);
    touch('pointerdown', 2, 50, 0);

    // the fingers move apart: twice the distance, half the field of view
    touch('pointermove', 1, -100, 0);
    touch('pointermove', 2, 100, 0);
    expect(element.camera.fov).to.be.closeTo(35, 0.01);
    // and the picture did not turn
    expect(direction().z).to.be.closeTo(-1, 1e-6);

    touch('pointerup', 1, -100, 0);
    touch('pointerup', 2, 100, 0);
  });

  it('should look straight at a new picture', async () => {
    drag({ x: 0, y: 0 }, { x: -80, y: 40 });
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
    const previous = element.stereoData;

    element.setAttribute('src', '/examples/wikipedia.anaglyph.jpg');
    await waitFor(() => element.stereoData !== previous && !element.loadingIndicator.visible, 'the next picture');

    expect(direction().z).to.be.closeTo(-1, 1e-6);
    expect(element.camera.fov).to.equal(70);
  });

  it('should leave the camera to the headset in VR', async () => {
    const button = () => element.shadowRoot.querySelector('#VRButton');
    await waitFor(() => button()?.textContent === 'ENTER VR', 'the "Enter VR" button');
    drag({ x: 0, y: 0 }, { x: -50, y: 0 });
    const before = element.controls.lon;
    button().click();
    await waitFor(() => element.renderer.xr.isPresenting, 'the VR session');

    drag({ x: 0, y: 0 }, { x: -50, y: 0 });
    expect(element.controls.lon).to.equal(before);

    button().click();
    await waitFor(() => !element.renderer.xr.isPresenting, 'the end of the VR session');
    drag({ x: 0, y: 0 }, { x: -50, y: 0 });
    expect(element.controls.lon).to.be.greaterThan(before);
  });

  it('should go back to the view of the element after VR', async () => {
    const button = () => element.shadowRoot.querySelector('#VRButton');
    await waitFor(() => button()?.textContent === 'ENTER VR', 'the "Enter VR" button');
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true }));
    expect(element.camera.fov).to.equal(60);

    button().click();
    await waitFor(() => element.renderer.xr.isPresenting, 'the VR session');
    // let the headset drive the camera for a few frames
    const frame = element.renderer.info.render.frame;
    await waitFor(() => element.renderer.info.render.frame > frame + 3, 'frames in VR');
    button().click();
    await waitFor(() => !element.renderer.xr.isPresenting, 'the end of the VR session');

    // same zoom, same shape, and the picture is still in the element at its size
    expect(element.camera.fov).to.equal(60);
    expect(element.camera.aspect).to.be.closeTo(WIDTH / HEIGHT, 1e-6);
    expect(canvas.parentNode).to.equal(element.shadowRoot);
    expect(canvas.getBoundingClientRect().width).to.equal(WIDTH);
    expect(canvas.getBoundingClientRect().height).to.equal(HEIGHT);
  });
});
