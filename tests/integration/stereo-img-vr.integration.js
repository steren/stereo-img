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

/** Create an element and wait for its "Enter VR" button. */
async function createElement() {
  const element = document.createElement('stereo-img');
  element.style.width = '400px';
  element.style.height = '300px';
  document.body.appendChild(element);
  await waitFor(() => vrButton(element)?.textContent === 'ENTER VR', 'the "Enter VR" button');
  return element;
}

/** Collect the errors of the page while the callback runs. */
async function collectErrors(callback) {
  const errors = [];
  const onError = event => errors.push(event.reason?.message || event.message);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  try {
    await callback();
  } finally {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
  }
  return errors;
}

describe('stereo-img in VR', function () {
  this.timeout(30000);

  const elements = [];

  afterEach(async () => {
    for (const element of elements.splice(0)) {
      if (isPresenting(element)) {
        await element.renderer.xr.getSession().end();
      }
      element.remove();
    }
    await wait(50);
  });

  it('should enter and exit VR', async () => {
    const element = await createElement();
    elements.push(element);

    vrButton(element).click();
    await waitFor(() => isPresenting(element), 'the VR session');
    expect(vrButton(element).textContent).to.equal('EXIT VR');

    vrButton(element).click();
    await waitFor(() => !isPresenting(element), 'the end of the VR session');
    expect(vrButton(element).textContent).to.equal('ENTER VR');
  });

  it('should move VR to another element of the page', async () => {
    const first = await createElement();
    const second = await createElement();
    elements.push(first, second);
    vrButton(first).click();
    await waitFor(() => isPresenting(first), 'the VR session of the first element');

    const errors = await collectErrors(async () => {
      vrButton(second).click();
      await waitFor(() => isPresenting(second), 'the VR session of the second element');
    });

    expect(errors).to.deep.equal([]);
    expect(isPresenting(first)).to.be.false;
    expect(vrButton(first).textContent).to.equal('ENTER VR');
    expect(vrButton(second).textContent).to.equal('EXIT VR');
  });

  it('should let each element enter VR in turn', async () => {
    const first = await createElement();
    const second = await createElement();
    elements.push(first, second);

    for (const element of [first, second, first]) {
      vrButton(element).click();
      await waitFor(() => isPresenting(element), 'the VR session');
      expect(elements.filter(isPresenting).length).to.equal(1);
    }

    vrButton(first).click();
    await waitFor(() => !isPresenting(first), 'the end of the VR session');
    expect(vrButton(first).textContent).to.equal('ENTER VR');
    expect(vrButton(second).textContent).to.equal('ENTER VR');
  });

  it('should keep drawing frames while in VR', async () => {
    const element = await createElement();
    elements.push(element);
    vrButton(element).click();
    await waitFor(() => isPresenting(element), 'the VR session');

    const frame = element.renderer.info.render.frame;
    await waitFor(() => element.renderer.info.render.frame > frame + 5, 'frames in VR');
  });
});
