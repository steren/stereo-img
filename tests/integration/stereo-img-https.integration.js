import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';
import { VRButton } from '../../lib/VRButton.js';

/** Collect the console warnings emitted while the callback runs. */
async function collectWarnings(callback) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await callback();
  } finally {
    console.warn = original;
  }
  return warnings;
}

/** Run the callback as if the page was not served over HTTPS: browsers then hide WebXR. */
async function onInsecurePage(callback) {
  const xr = Object.getOwnPropertyDescriptor(Navigator.prototype, 'xr');
  const secure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
  delete Navigator.prototype.xr;
  Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
  try {
    await callback();
  } finally {
    Object.defineProperty(Navigator.prototype, 'xr', xr);
    if (secure) {
      Object.defineProperty(window, 'isSecureContext', secure);
    } else {
      delete window.isSecureContext;
    }
  }
}

function addElement(attributes = {}) {
  const element = document.createElement('stereo-img');
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.body.appendChild(element);
  return element;
}

describe('stereo-img on a page without HTTPS', function () {
  this.timeout(30000);

  const elements = [];

  beforeEach(() => {
    VRButton.insecurePageWarned = false;
  });

  afterEach(() => {
    elements.splice(0).forEach(element => element.remove());
  });

  it('should explain once why VR is not available', async () => {
    const warnings = await collectWarnings(() => onInsecurePage(async () => {
      elements.push(addElement(), addElement());
      await new Promise(resolve => setTimeout(resolve, 100));
    }));

    const aboutHttps = warnings.filter(warning => warning.includes('HTTPS'));
    expect(aboutHttps.length).to.equal(1);
    expect(aboutHttps[0]).to.include('VR is not available');
    for (const element of elements) {
      expect(element.shadowRoot.querySelector('#VRButton')).to.not.exist;
      // the rest of the component works
      expect(element.shadowRoot.querySelector('#flatModeButton')).to.exist;
    }
  });

  it('should not warn when the VR button is not wanted', async () => {
    const warnings = await collectWarnings(() => onInsecurePage(async () => {
      elements.push(addElement({ controlslist: 'left right' }));
      await new Promise(resolve => setTimeout(resolve, 100));
    }));

    expect(warnings.filter(warning => warning.includes('HTTPS')).length).to.equal(0);
  });

  it('should not warn on a secure page', async () => {
    expect(window.isSecureContext).to.be.true;

    const warnings = await collectWarnings(async () => {
      elements.push(addElement());
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(warnings.filter(warning => warning.includes('HTTPS')).length).to.equal(0);
    expect(elements[0].shadowRoot.querySelector('#VRButton')).to.exist;
  });
});
