import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

describe('stereo-img width and height attributes', () => {
  let element;
  let style;

  afterEach(() => {
    element?.remove();
    style?.remove();
    element = null;
    style = null;
  });

  // Without "src", the element does not start: only its size is tested.
  function makeElement(attributes) {
    element = document.createElement('stereo-img');
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    return element;
  }

  it('sizes the element from the attributes', () => {
    makeElement({ width: '300', height: '150' });
    const rect = element.getBoundingClientRect();
    expect(rect.width).to.equal(300);
    expect(rect.height).to.equal(150);
  });

  it('follows changes of the attributes', () => {
    makeElement({ width: '300', height: '150' });
    element.setAttribute('height', '200');
    expect(element.getBoundingClientRect().height).to.equal(200);
    element.removeAttribute('width');
    element.removeAttribute('height');
    expect(element.getBoundingClientRect().width).to.equal(document.body.clientWidth);
  });

  it('lets the CSS of the page win, keeping the aspect ratio', () => {
    style = document.createElement('style');
    style.textContent = 'stereo-img.fluid { width: 400px; height: auto; }';
    document.head.appendChild(style);
    makeElement({ width: '200', height: '100', class: 'fluid' });
    const rect = element.getBoundingClientRect();
    expect(rect.width).to.equal(400);
    expect(rect.height).to.equal(200);
  });
});
