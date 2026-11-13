import { expect } from '@esm-bundle/chai';
import { XRDevice, metaQuest3 } from 'iwer';
import '../../stereo-img.js';

// There is no VR headset here: emulate one, with its two controllers.
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

describe('stereo-img with the controllers of a headset', function () {
  this.timeout(30000);

  let element;
  let events;

  /** Create an element, and note what it asks for. */
  async function createElement(attributes = {}) {
    element = document.createElement('stereo-img');
    element.style.width = '400px';
    element.style.height = '300px';
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    events = [];
    for (const name of ['previous', 'next']) {
      element.addEventListener(name, event => events.push([name, event.detail.input, event.detail.handedness]));
    }
    document.body.appendChild(element);
    await waitFor(() => vrButton(element)?.textContent === 'ENTER VR', 'the "Enter VR" button');
  }

  async function enterVR() {
    vrButton(element).click();
    await waitFor(() => isPresenting(element), 'the VR session');
    // the headset tells about its controllers on its first frames
    await waitFor(() => element.renderer.xr.getSession().inputSources.length === 2, 'the controllers');
  }

  async function exitVR() {
    await element.renderer.xr.getSession().end();
    await waitFor(() => !isPresenting(element), 'the end of the VR session');
  }

  /** Wait for the headset to draw some frames: it reads its controllers on each of them. */
  async function frames(count = 3) {
    for (let i = 0; i < count; i++) {
      await new Promise(resolve => element.renderer.xr.getSession().requestAnimationFrame(resolve));
    }
  }

  /** Press and release the trigger of a controller. */
  async function pullTrigger(hand) {
    xrDevice.controllers[hand].updateButtonValue('trigger', 1);
    await frames();
    xrDevice.controllers[hand].updateButtonValue('trigger', 0);
    await frames();
  }

  /** Put the thumbstick of a controller at a position. */
  async function moveThumbstick(hand, x, y = 0) {
    xrDevice.controllers[hand].updateAxes('thumbstick', x, y);
    await frames();
  }

  afterEach(async () => {
    for (const hand of ['left', 'right']) {
      xrDevice.controllers[hand].updateAxes('thumbstick', 0, 0);
      xrDevice.controllers[hand].updateButtonValue('trigger', 0);
    }
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

  it('asks for the next picture with the trigger of the right controller', async () => {
    await createElement();
    await enterVR();

    await pullTrigger('right');

    expect(events).to.deep.equal([['next', 'select', 'right']]);
  });

  it('asks for the previous picture with the trigger of the left controller', async () => {
    await createElement();
    await enterVR();

    await pullTrigger('left');

    expect(events).to.deep.equal([['previous', 'select', 'left']]);
  });

  it('asks with a pinch of the fingers, when the headset follows the hands', async () => {
    await createElement();
    xrDevice.primaryInputMode = 'hand';
    try {
      await enterVR();

      for (const hand of ['right', 'left']) {
        xrDevice.hands[hand].updatePinchValue(1);
        await frames();
        xrDevice.hands[hand].updatePinchValue(0);
        await frames();
      }
    } finally {
      xrDevice.primaryInputMode = 'controller';
    }

    expect(events).to.deep.equal([['next', 'select', 'right'], ['previous', 'select', 'left']]);
  });

  it('asks once per press', async () => {
    await createElement();
    await enterVR();

    await pullTrigger('right');
    await pullTrigger('right');
    await pullTrigger('left');

    expect(events.map(event => event[0])).to.deep.equal(['next', 'next', 'previous']);
  });

  it('asks for the next and the previous picture with a thumbstick, on either controller', async () => {
    await createElement();
    await enterVR();

    await moveThumbstick('right', 1);
    await moveThumbstick('right', 0);
    await moveThumbstick('right', -1);
    await moveThumbstick('right', 0);
    await moveThumbstick('left', 1);
    await moveThumbstick('left', 0);
    await moveThumbstick('left', -1);

    expect(events).to.deep.equal([
      ['next', 'thumbstick', 'right'],
      ['previous', 'thumbstick', 'right'],
      ['next', 'thumbstick', 'left'],
      ['previous', 'thumbstick', 'left'],
    ]);
  });

  it('asks once while a thumbstick stays pushed, and again after it came back', async () => {
    await createElement();
    await enterVR();

    await moveThumbstick('right', 1);
    await frames(10);
    await moveThumbstick('right', 0.8);
    expect(events.length).to.equal(1);

    await moveThumbstick('right', 0);
    await moveThumbstick('right', 0.9);
    expect(events.map(event => event[0])).to.deep.equal(['next', 'next']);
  });

  it('asks for nothing when a thumbstick is pushed up or down', async () => {
    await createElement();
    await enterVR();

    await moveThumbstick('right', 0, 1);
    await moveThumbstick('right', 0, 0);
    await moveThumbstick('left', 0.3, -1);

    expect(events).to.deep.equal([]);
  });

  it('lets the page hear about it from anywhere', async () => {
    await createElement();
    const heard = [];
    const listener = event => heard.push([event.type, event.target === element]);
    document.addEventListener('next', listener);
    try {
      await enterVR();
      await pullTrigger('right');
    } finally {
      document.removeEventListener('next', listener);
    }

    expect(heard).to.deep.equal([['next', true]]);
  });

  it('asks for nothing outside of VR', async () => {
    await createElement();

    xrDevice.controllers.right.updateAxes('thumbstick', 1, 0);
    xrDevice.controllers.right.updateButtonValue('trigger', 1);
    await wait(100);
    xrDevice.controllers.right.updateButtonValue('trigger', 0);
    xrDevice.controllers.right.updateAxes('thumbstick', 0, 0);
    await wait(100);

    expect(events).to.deep.equal([]);
  });

  it('asks once per press in a second VR session', async () => {
    await createElement();
    await enterVR();
    await pullTrigger('right');
    await exitVR();
    await wait(50);

    await enterVR();
    await pullTrigger('left');
    await moveThumbstick('right', 1);

    expect(events).to.deep.equal([
      ['next', 'select', 'right'],
      ['previous', 'select', 'left'],
      ['next', 'thumbstick', 'right'],
    ]);
  });

  it('stays in VR while the page changes the picture', async () => {
    await createElement({ src: '/examples/calf-left-right.jpg' });
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the first picture');
    const first = element.stereoData;
    // what a gallery does
    element.addEventListener('next', () => {
      element.setAttribute('src', '/examples/stereograph.left-right.jpg');
      element.setAttribute('type', 'left-right');
    });
    await enterVR();

    await pullTrigger('right');
    await waitFor(() => element.stereoData !== first && !element.loadingIndicator.visible, 'the second picture');

    expect(isPresenting(element)).to.equal(true);
    expect(element.stereoImageGroup.children.filter(object => object.isMesh).length).to.equal(2);
    // and the controllers still work
    await pullTrigger('left');
    expect(events.map(event => event[0])).to.deep.equal(['next', 'previous']);
  });
});
