import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const MONO = '/examples/Panasonic-DMC-GX8-left.jpg';
const MONO_RIGHT = '/examples/Panasonic-DMC-GX8-right.jpg';
const LEFT_RIGHT = '/examples/Panasonic-DMC-GX8.jpg';

async function waitFor(condition, timeout = 15000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

// Compare identities outside of chai: on failure, chai would serialize the
// whole ImageData in its error message.
const sameImageInBothEyes = element => element.stereoData.leftEye === element.stereoData.rightEye;

describe('stereo-img type detection', () => {
  let element;

  afterEach(() => {
    element?.remove();
  });

  it('should not write the detected type back to the "type" attribute', async () => {
    element = document.createElement('stereo-img');
    element.setAttribute('src', MONO);
    document.body.appendChild(element);

    await waitFor(() => element.stereoData?.leftEye?.width > 10);

    expect(sameImageInBothEyes(element)).to.be.true;
    expect(element.hasAttribute('type')).to.be.false;
  }).timeout(20000);

  it('should detect the type again when "src" changes', async () => {
    element = document.createElement('stereo-img');
    element.setAttribute('src', MONO);
    document.body.appendChild(element);
    await waitFor(() => element.stereoData?.leftEye?.width > 10);
    expect(sameImageInBothEyes(element)).to.be.true;
    const monoData = element.stereoData;

    // A mono picture followed by a side-by-side one: the second must be split in two eyes.
    element.setAttribute('src', LEFT_RIGHT);
    await waitFor(() => element.stereoData !== monoData);

    expect(sameImageInBothEyes(element)).to.be.false;
  }).timeout(40000);

  it('should not set the "type" attribute when "src-right" is used', async () => {
    element = document.createElement('stereo-img');
    element.setAttribute('src', MONO);
    element.setAttribute('src-right', MONO_RIGHT);
    document.body.appendChild(element);

    await waitFor(() => element.stereoData?.leftEye?.width > 10);

    expect(sameImageInBothEyes(element)).to.be.false;
    expect(element.hasAttribute('type')).to.be.false;
  }).timeout(20000);
});
