import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

describe('stereo-img component', () => {
  it('should construct the element without throwing an error (React/createElement compatibility)', () => {
    let element;
    expect(() => {
      element = document.createElement('stereo-img');
    }).to.not.throw();

    expect(element).to.be.an.instanceOf(HTMLElement);
    // When constructed but not connected, renderer should not exist yet (as per spec, no side effects)
    expect(element.renderer).to.not.exist;
  });

  it('should initialize when appended to the DOM', async () => {
    const element = document.createElement('stereo-img');
    document.body.appendChild(element);

    // Give it a brief moment to run connectedCallback / init
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(element.shadowRoot).to.exist;
    expect(element.shadowRoot.querySelector('style')).to.exist;
    expect(element.renderer).to.exist;

    // Clean up
    element.remove();
  });
});
