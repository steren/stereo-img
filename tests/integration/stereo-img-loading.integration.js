import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const MONO = '/examples/Panasonic-DMC-GX8-left.jpg';

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

const isLoaded = element => !!element.stereoData && !element.loadingIndicator.visible;

/** Create an element and wait for its initial picture to be displayed. */
async function createElement(attributes = {}) {
  const element = document.createElement('stereo-img');
  element.style.width = '400px';
  element.style.height = '300px';
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.body.appendChild(element);
  await waitFor(() => isLoaded(element), 'the initial picture');
  return element;
}

/** Change an attribute and wait for the element to be done loading. */
async function change(element, name, value) {
  const previous = element.stereoData;
  element.setAttribute(name, value);
  await waitFor(() => element.stereoData !== previous && isLoaded(element), `${name}="${value}"`);
}

describe('stereo-img loading', () => {
  let element;

  afterEach(() => {
    element?.remove();
  });

  it('should stop loading and clear the picture when the image does not exist', async () => {
    element = await createElement({ src: MONO, type: 'mono' });
    expect(element.stereoData.leftEye.width).to.be.greaterThan(10);

    await change(element, 'src', '/examples/does-not-exist.jpg');

    expect(element.loadingIndicator.visible).to.be.false;
    expect(element.stereoData.leftEye.width).to.equal(10);
    expect(element.stereoImageGroup.children.length).to.equal(2);
  }).timeout(20000);

  it('should stop loading when a "vr" picture has no right eye', async () => {
    element = await createElement({ src: MONO, type: 'mono' });

    await change(element, 'type', 'vr');

    expect(element.loadingIndicator.visible).to.be.false;
    expect(element.stereoData.leftEye.width).to.equal(10);
  }).timeout(20000);

  it('should display a picture again after a failure', async () => {
    element = await createElement({ src: '/examples/does-not-exist.jpg', type: 'mono' });
    expect(element.stereoData.leftEye.width).to.equal(10);

    await change(element, 'src', MONO);

    expect(element.stereoData.leftEye.width).to.be.greaterThan(10);
  }).timeout(20000);

  describe('when attributes change while a picture is loading', () => {
    const LEFT_RIGHT = '/examples/Panasonic-DMC-GX8.jpg';
    const SMALL = '/examples/persepolis.anaglyph.jpg';

    /** Replace the parser of the element by one that completes when the test decides. */
    function controlParsing() {
      const parses = [];
      element.parse = function (signal) {
        const src = this.getAttribute('src');
        return new Promise((resolve, reject) => {
          parses.push({
            src,
            signal,
            finish: () => resolve({ ...emptyStereoData(), src }),
            fail: reject,
          });
        });
      };
      return parses;
    }

    /** Set "src" and wait for its parsing to start. */
    async function startLoading(parses, src) {
      const count = parses.length;
      element.setAttribute('src', src);
      await waitFor(() => parses.length === count + 1, `the parsing of ${src} to start`);
    }

    /** Collect what is reported with console.error while the callback runs. */
    async function collectErrors(callback) {
      const original = console.error;
      const errors = [];
      console.error = (...args) => errors.push(args);
      try {
        await callback();
      } finally {
        console.error = original;
      }
      return errors;
    }

    it('should cancel the load in progress and start the new one right away', async () => {
      element = await createElement();
      const parses = controlParsing();

      await startLoading(parses, 'first.jpg');
      expect(parses[0].signal.aborted).to.be.false;

      // The second parse starts although the first one is not done.
      await startLoading(parses, 'second.jpg');

      expect(parses[0].signal.aborted).to.be.true;
      expect(parses[1].signal.aborted).to.be.false;
      expect(element.loadingIndicator.visible).to.be.true;
    }).timeout(20000);

    it('should display the latest picture when the cancelled one finishes last', async () => {
      element = await createElement();
      const parses = controlParsing();
      await startLoading(parses, 'first.jpg');
      await startLoading(parses, 'second.jpg');

      parses[1].finish();
      await waitFor(() => element.stereoData.src === 'second.jpg' && isLoaded(element), 'the latest picture');
      parses[0].finish();
      await wait(100);

      expect(element.stereoData.src).to.equal('second.jpg');
      expect(element.loadingIndicator.visible).to.be.false;
    }).timeout(20000);

    it('should never display the cancelled picture when it finishes first', async () => {
      element = await createElement();
      const initial = element.stereoData;
      const parses = controlParsing();
      await startLoading(parses, 'first.jpg');
      await startLoading(parses, 'second.jpg');

      parses[0].finish();
      await wait(100);
      expect(element.stereoData === initial).to.be.true;
      expect(element.loadingIndicator.visible).to.be.true;

      parses[1].finish();
      await waitFor(() => element.stereoData.src === 'second.jpg' && isLoaded(element), 'the latest picture');
    }).timeout(20000);

    it('should not report the failure of a cancelled load', async () => {
      element = await createElement();
      const initial = element.stereoData;
      const parses = controlParsing();

      const errors = await collectErrors(async () => {
        await startLoading(parses, 'first.jpg');
        await startLoading(parses, 'second.jpg');
        parses[0].fail(parses[0].signal.reason);
        await wait(100);
        // the picture displayed before is not replaced by an empty scene
        expect(element.stereoData === initial).to.be.true;

        parses[1].finish();
        await waitFor(() => element.stereoData.src === 'second.jpg' && isLoaded(element), 'the latest picture');
      });

      expect(errors.length).to.equal(0);
    }).timeout(20000);

    it('should report the failure of the latest load', async () => {
      element = await createElement();
      const parses = controlParsing();

      const errors = await collectErrors(async () => {
        await startLoading(parses, 'first.jpg');
        await startLoading(parses, 'second.jpg');
        parses[0].finish();
        parses[1].fail(new Error('broken picture'));
        await waitFor(() => isLoaded(element), 'the load to end');
      });

      expect(errors.length).to.equal(1);
      expect(element.stereoData.src).to.equal(undefined);
      expect(element.stereoData.leftEye.width).to.equal(10);
    }).timeout(20000);

    it('should only display the last of several quick changes', async () => {
      element = await createElement();
      const parses = controlParsing();
      await startLoading(parses, 'first.jpg');
      await startLoading(parses, 'second.jpg');
      await startLoading(parses, 'third.jpg');

      expect(parses.map(parse => parse.signal.aborted)).to.deep.equal([true, true, false]);
      parses[1].finish();
      parses[2].finish();
      parses[0].finish();
      await waitFor(() => isLoaded(element), 'the latest picture');
      await wait(100);

      expect(element.stereoData.src).to.equal('third.jpg');
    }).timeout(20000);

    it('should finish building a scene before building the next one', async () => {
      element = await createElement();
      const parses = controlParsing();
      // Hold the first scene while it is being built.
      const buildScene = element.initialize3DScene.bind(element);
      let scenes = 0;
      let release;
      const held = new Promise(resolve => { release = resolve; });
      element.initialize3DScene = async () => {
        if (++scenes === 1) {
          await held;
        }
        return buildScene();
      };

      await startLoading(parses, 'first.jpg');
      parses[0].finish();
      await waitFor(() => scenes === 1, 'the first scene to be started');
      await startLoading(parses, 'second.jpg');
      parses[1].finish();
      await wait(100);
      // the second picture waits for the first scene
      expect(scenes).to.equal(1);
      expect(element.stereoData.src).to.equal('first.jpg');

      release();
      await waitFor(() => element.stereoData.src === 'second.jpg' && isLoaded(element), 'the latest picture');
      expect(scenes).to.equal(2);
      expect(element.stereoImageGroup.children.length).to.equal(2);
    }).timeout(20000);

    it('should parse once when several attributes change together', async () => {
      element = await createElement();
      const parses = controlParsing();

      element.setAttribute('src', 'first.jpg');
      element.setAttribute('type', 'left-right');
      element.setAttribute('angle', '180');
      await wait(100);

      expect(parses.length).to.equal(1);
      parses[0].finish();
      await waitFor(() => isLoaded(element), 'the picture');
    }).timeout(20000);

    it('should display the latest of two real pictures set in a row', async () => {
      const small = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = SMALL;
      });
      element = await createElement({ type: 'mono' });

      // a large picture, replaced as soon as it starts loading
      element.setAttribute('src', LEFT_RIGHT);
      await wait(0);
      element.setAttribute('src', SMALL);
      await waitFor(() => element.stereoData.leftEye.width === small.width && isLoaded(element), 'the small picture');

      // leave time for the first picture to finish loading, would it not be cancelled
      await wait(1500);
      expect(element.stereoData.leftEye.width).to.equal(small.width);
      expect(element.loadingIndicator.visible).to.be.false;
    }).timeout(30000);
  });
});

function emptyStereoData() {
  return {
    leftEye: new ImageData(10, 10),
    rightEye: new ImageData(10, 10),
    phiLength: 0,
    thetaStart: 0,
    thetaLength: 0,
  };
}
