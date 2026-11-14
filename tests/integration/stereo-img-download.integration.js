import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(condition, description, timeout = 40000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await wait(20);
  }
}

let count = 0;
/** A URL of a picture that no other test uses, to count the requests made for it. */
const unique = path => `${path}?download=${++count}`;

/** The number of requests made for a URL. */
const requestsFor = url => performance.getEntriesByType('resource').filter(entry => entry.name.endsWith(url)).length;

describe('stereo-img download', function () {
  this.timeout(60000);

  let element;

  afterEach(() => {
    element?.remove();
    element?.renderer?.setAnimationLoop(null);
    element = null;
  });

  /** Display a picture and wait for it. */
  async function display(attributes) {
    element = document.createElement('stereo-img');
    element.style.width = '400px';
    element.style.height = '300px';
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
    return element.stereoData;
  }

  const eyeWidth = stereoData => stereoData.leftEye.width ?? stereoData.leftEye.naturalWidth;

  for (const [description, path, attributes, width] of [
    ['a VR photo, detected', '/examples/vr180-lenovo-mirage.vr.jpg', {}, 3016],
    ['a side by side picture, detected', '/examples/Panasonic-DMC-GX8.jpg', {}, 1824],
    ['a regular picture, detected', '/examples/Panasonic-DMC-GX8-left.jpg', {}, 1824],
    ['a Multi-Picture Format file, detected', '/examples/Panasonic-DMC-GX8.mpo', {}, 1824],
    ['a VR photo', '/examples/vr180-lenovo-mirage.vr.jpg', { type: 'vr' }, 3016],
    ['a side by side picture', '/examples/Panasonic-DMC-GX8.jpg', { type: 'left-right' }, 1824],
    ['a regular picture', '/examples/Panasonic-DMC-GX8-left.jpg', { type: 'mono' }, 1824],
    ['an anaglyph', '/examples/persepolis.anaglyph.jpg', { type: 'anaglyph' }, 943],
    ['a picture with a depth map', '/examples/Pixel7Pro.PORTRAIT.jpg', { type: 'depth' }, 3072],
  ]) {
    it(`should download ${description} once`, async () => {
      const src = unique(path);

      const stereoData = await display({ src, ...attributes });

      expect(eyeWidth(stereoData)).to.equal(width);
      await wait(200);
      expect(requestsFor(src)).to.equal(1);
    });
  }

  it('should download each picture of a pair once', async () => {
    const src = unique('/examples/Panasonic-DMC-GX8-left.jpg');
    const srcRight = unique('/examples/Panasonic-DMC-GX8-right.jpg');

    const stereoData = await display({ src, 'src-right': srcRight });

    expect(stereoData.leftEye === stereoData.rightEye).to.be.false;
    await wait(200);
    expect(requestsFor(src)).to.equal(1);
    expect(requestsFor(srcRight)).to.equal(1);
  });

  it('should release the temporary URLs it creates', async () => {
    const created = [];
    const revoked = [];
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = object => {
      const url = createObjectURL.call(URL, object);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = url => {
      revoked.push(url);
      revokeObjectURL.call(URL, url);
    };
    try {
      for (const attributes of [
        { src: '/examples/Panasonic-DMC-GX8.jpg' },
        { src: '/examples/Panasonic-DMC-GX8.mpo' },
        { src: '/examples/vr180-lenovo-mirage.vr.jpg' },
        { src: '/examples/Pixel7Pro.PORTRAIT.jpg' },
        { src: '/examples/persepolis.anaglyph.jpg', type: 'anaglyph' },
        { src: '/examples/does-not-exist.jpg' },
      ]) {
        created.length = 0;
        revoked.length = 0;
        await display(attributes);
        await wait(100);
        expect(created.length, JSON.stringify(attributes)).to.equal(new Set(created).size);
        expect(created.filter(url => !revoked.includes(url)), JSON.stringify(attributes)).to.deep.equal([]);
        element.remove();
        element.renderer.setAnimationLoop(null);
      }
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });

  it('should leave a blob URL given as "src" usable', async () => {
    const response = await fetch('/examples/Panasonic-DMC-GX8.jpg');
    const src = URL.createObjectURL(await response.blob());
    try {
      const first = await display({ src, type: 'left-right' });
      expect(first.leftEye.width).to.equal(1824);

      // the same URL is read again when the type changes
      element.setAttribute('type', 'mono');
      await waitFor(() => element.stereoData !== first && !element.loadingIndicator.visible, 'the picture, parsed again');

      expect(element.stereoData.leftEye.width).to.equal(3648);
      expect((await fetch(src)).ok).to.be.true;
    } finally {
      URL.revokeObjectURL(src);
    }
  });

  for (const [format, path, width] of [['Multi-Picture Format', '/examples/Panasonic-DMC-GX8.mpo', 1824], ['Leia Image Format', '/examples/leia_lume_pad2.jpg', 4656]]) {
    it(`should detect a ${format} file from its content, whatever its name`, async () => {
      const response = await fetch(path);
      const src = URL.createObjectURL(await response.blob());
      try {
        const stereoData = await display({ src });

        expect(stereoData.leftEye.width).to.equal(width);
        expect(stereoData.leftEye === stereoData.rightEye).to.be.false;
      } finally {
        URL.revokeObjectURL(src);
      }
    });
  }

  it('should not take a regular picture holding previews for a stereo one', async () => {
    // A JPEG followed by a second image is not enough: the index of the file must describe a stereo pair.
    const stereoData = await display({ src: unique('/examples/Pixel7Pro.PORTRAIT.jpg'), type: 'mono' });

    expect(stereoData.leftEye === stereoData.rightEye).to.be.true;
  });

  it('should still recognise a camera from the name of the file', async () => {
    const stereoData = await display({ src: unique('/examples/GOPR0.left-right.jpg'), type: 'left-right' });

    expect(stereoData.phiLength * 180 / Math.PI).to.be.closeTo(122.6, 0.01);
  });

  it('should stop the download of a picture that is replaced', async () => {
    const signals = [];
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (typeof url === 'string' && url.includes('/examples/')) {
        signals.push({ url, signal: options?.signal });
      }
      return originalFetch(url, options);
    };
    try {
      const first = unique('/examples/kandao-qoocam-ego.jpg');
      const second = unique('/examples/persepolis.anaglyph.jpg');
      element = document.createElement('stereo-img');
      element.setAttribute('type', 'mono');
      element.setAttribute('src', first);
      document.body.appendChild(element);
      await waitFor(() => signals.length === 1, 'the first download');

      element.setAttribute('src', second);
      await waitFor(() => element.stereoData?.leftEye.width === 943 && !element.loadingIndicator.visible, 'the second picture');

      expect(signals.map(({ url }) => url)).to.deep.equal([first, second]);
      expect(signals[0].signal.aborted).to.be.true;
      expect(signals[1].signal.aborted).to.be.false;
    } finally {
      window.fetch = originalFetch;
    }
  });
});
