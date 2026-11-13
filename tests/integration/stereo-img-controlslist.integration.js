import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

/** Create an element and return the controls it displays. */
async function controlsFor(controlslist) {
  const element = document.createElement('stereo-img');
  if (controlslist !== undefined) {
    element.setAttribute('controlslist', controlslist);
  }
  document.body.appendChild(element);
  await new Promise(resolve => setTimeout(resolve, 50));

  const flatModeButton = element.shadowRoot.querySelector('#flatModeButton');
  const controls = {
    vr: !!element.shadowRoot.querySelector('#VRButton'),
    flatModes: flatModeButton ? Array.from(flatModeButton.querySelectorAll('button'), button => button.getAttribute('aria-label')) : [],
  };
  element.remove();
  return controls;
}

describe('stereo-img controlslist', () => {
  it('should display all controls by default', async () => {
    const controls = await controlsFor(undefined);
    expect(controls.vr).to.be.true;
    expect(controls.flatModes).to.deep.equal(['left view', 'right view', 'wiggle view', 'anaglyph view']);
  });

  it('should only display the listed controls', async () => {
    const controls = await controlsFor('left anaglyph');
    expect(controls.vr).to.be.false;
    expect(controls.flatModes).to.deep.equal(['left view', 'anaglyph view']);
  });

  it('should accept any whitespace and letter case between tokens', async () => {
    const controls = await controlsFor('  VR\tLeft\n right ');
    expect(controls.vr).to.be.true;
    expect(controls.flatModes).to.deep.equal(['left view', 'right view']);
  });

  it('should not match tokens that only contain the name of a control', async () => {
    const controls = await controlsFor('novr leftover upright');
    expect(controls.vr).to.be.false;
    expect(controls.flatModes).to.deep.equal([]);
  });
});
