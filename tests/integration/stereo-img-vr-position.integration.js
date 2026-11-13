import { expect } from '@esm-bundle/chai';
import { XRDevice, metaQuest3 } from 'iwer';
import '../../stereo-img.js';

// There is no VR headset here: emulate one.
const xrDevice = new XRDevice(metaQuest3);
xrDevice.installRuntime({ forceInstall: true });

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

const vrButton = element => element.shadowRoot.querySelector('#VRButton');
const isPresenting = element => element.renderer.xr.isPresenting;

describe('stereo-img keeps the viewer in the middle of the picture in VR', function () {
  this.timeout(60000);

  let element;

  /** Display a picture. */
  async function display(attributes) {
    element = document.createElement('stereo-img');
    element.style.width = '400px';
    element.style.height = '300px';
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
    await waitFor(() => vrButton(element)?.textContent === 'ENTER VR', 'the "Enter VR" button');
  }

  /** Wait for the headset to draw some frames. */
  async function frames(count = 3) {
    for (let i = 0; i < count; i++) {
      await new Promise(resolve => element.renderer.xr.getSession().requestAnimationFrame(resolve));
    }
  }

  async function enterVR() {
    vrButton(element).click();
    await waitFor(() => isPresenting(element), 'the VR session');
    await frames();
  }

  async function exitVR() {
    await element.renderer.xr.getSession().end();
    await waitFor(() => !isPresenting(element), 'the end of the VR session');
  }

  /** Put the head of the viewer somewhere in the room, in metres: to their right, above the floor, behind where they started. */
  async function moveHead(x, y, z) {
    xrDevice.position.set(x, y, z);
    await frames();
  }

  /** Where the head of the viewer is: between their eyes, as the scene sees them. */
  function head() {
    const [left, right] = element.renderer.xr.getCamera().cameras;
    return ['x', 'y', 'z'].map(axis => (left.position[axis] + right.position[axis]) / 2);
  }

  /** Where the middle of what the picture is drawn around is: the centre of a sphere, the point 10 in front of a flat picture. */
  function pictureOrigin() {
    element.stereoImageGroup.updateMatrixWorld(true);
    const { x, y, z } = element.stereoImageGroup.getWorldPosition(element.camera.position.clone());
    return [x, y, z];
  }

  function expectClose(actual, expected, description) {
    const close = actual.every((value, i) => Math.abs(value - expected[i]) < 1e-4);
    expect(close, `${description}: ${actual.map(value => value.toFixed(3))} instead of ${expected.map(value => value.toFixed(3))}`).to.equal(true);
  }

  beforeEach(() => {
    xrDevice.position.set(0, 1.6, 0);
    xrDevice.quaternion.set(0, 0, 0, 1);
  });

  afterEach(async () => {
    if (element) {
      if (isPresenting(element)) {
        await exitVR();
      }
      element.remove();
      element.renderer?.setAnimationLoop(null);
      element = null;
    }
    await wait(50);
  });

  it('puts the viewer at the centre of a picture that surrounds them', async () => {
    await display({ src: '/examples/vr180-lenovo-mirage.vr.jpg' });

    await enterVR();

    // standing: the head is 1.6 above the floor
    expectClose(head(), [0, 1.6, 0], 'the head');
    expectClose(pictureOrigin(), head(), 'the centre of the picture');
  });

  it('puts a flat picture straight in front of the viewer, at the height of their eyes', async () => {
    await display({ src: '/examples/calf-left-right.jpg' });

    await enterVR();

    expectClose(pictureOrigin(), [0, 1.6, 0], 'what the picture is in front of');
    // the middle of the picture is 10 in front of it
    const mesh = element.stereoImageGroup.children.find(object => object.isMesh);
    mesh.geometry.computeBoundingBox();
    const middle = mesh.geometry.boundingBox.getCenter(element.camera.position.clone()).applyMatrix4(mesh.matrixWorld);
    expectClose([middle.x, middle.y, middle.z], [0, 1.6, -10], 'the middle of the picture');
  });

  it('keeps the viewer at the centre when they move', async () => {
    await display({ src: '/examples/vr180-lenovo-mirage.vr.jpg' });
    await enterVR();

    for (const position of [[0.4, 1.2, -0.7], [-1.5, 0.3, 2], [0, 1.8, 0]]) {
      await moveHead(...position);

      expectClose(head(), position, 'the head');
      expectClose(pictureOrigin(), position, 'the centre of the picture');
    }
  });

  it('does not turn the picture with the head', async () => {
    await display({ src: '/examples/vr180-lenovo-mirage.vr.jpg' });
    await enterVR();
    const before = element.stereoImageGroup.getWorldQuaternion(element.camera.quaternion.clone());

    // look to the left, 90 degrees
    xrDevice.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
    await frames();

    const after = element.stereoImageGroup.getWorldQuaternion(element.camera.quaternion.clone());
    expect(after.angleTo(before)).to.be.below(1e-6);
    expect(element.renderer.xr.getCamera().quaternion.angleTo(before)).to.be.closeTo(Math.PI / 2, 1e-3);
    expectClose(pictureOrigin(), [0, 1.6, 0], 'the centre of the picture');
  });

  it('leaves a picture with relief where it is when the viewer moves, to show its sides', async () => {
    await display({ src: '/examples/Pixel7Pro.PORTRAIT.jpg' });
    expect(element.stereoData.depth, 'depth map').to.exist;

    await enterVR();
    // placed in front of where the viewer was at first
    expectClose(pictureOrigin(), [0, 1.6, 0], 'what the picture is in front of');

    await moveHead(0.3, 1.5, -0.2);

    expectClose(head(), [0.3, 1.5, -0.2], 'the head');
    expectClose(pictureOrigin(), [0, 1.6, 0], 'what the picture is in front of');
  });

  it('places a picture loaded during the session where the viewer is', async () => {
    await display({ src: '/examples/vr180-lenovo-mirage.vr.jpg' });
    await enterVR();
    await moveHead(0.5, 1.1, 0.4);

    // a picture with relief: placed once
    let before = element.stereoData;
    element.setAttribute('src', '/examples/Pixel7Pro.PORTRAIT.jpg');
    await waitFor(() => element.stereoData !== before && !element.loadingIndicator.visible, 'the picture with relief');
    await frames();
    expectClose(pictureOrigin(), [0.5, 1.1, 0.4], 'what the picture with relief is in front of');
    await moveHead(0, 1.6, 0);
    expectClose(pictureOrigin(), [0.5, 1.1, 0.4], 'what the picture with relief is in front of, after a move');

    // a picture without relief: follows again
    before = element.stereoData;
    element.setAttribute('src', '/examples/calf-left-right.jpg');
    await waitFor(() => element.stereoData !== before && !element.loadingIndicator.visible, 'the flat picture');
    await frames();
    expectClose(pictureOrigin(), [0, 1.6, 0], 'what the flat picture is in front of');
    await moveHead(-0.2, 1.4, 0.1);
    expectClose(pictureOrigin(), [-0.2, 1.4, 0.1], 'what the flat picture is in front of, after a move');
  });

  it('shows that a picture is loading in front of the viewer', async () => {
    await display({ src: '/examples/vr180-lenovo-mirage.vr.jpg' });
    await enterVR();
    await moveHead(0.5, 1.1, 0.4);

    const { x, y, z } = element.loadingIndicator.position;
    expectClose([x, y, z], [0.5, 1.1, -0.6], 'the loading indicator');
  });

  it('puts everything back when leaving VR', async () => {
    await display({ src: '/examples/calf-left-right.jpg' });
    const fov = element.camera.fov;
    await enterVR();
    await moveHead(0.5, 1.1, 0.4);

    await exitVR();
    await wait(100);

    expectClose(pictureOrigin(), [0, 0, 0], 'what the picture is in front of');
    const { x, y, z } = element.loadingIndicator.position;
    expectClose([x, y, z], [0, 0, -1], 'the loading indicator');
    // the view of the element is the one from before
    expectClose([element.camera.position.x, element.camera.position.y, element.camera.position.z], [0, 0, 0], 'the camera');
    expect(element.camera.fov).to.be.closeTo(fov, 0.01);
    expect(element.controls.isAllowed(0, 0, element.camera.fov)).to.equal(true);
  });
});
