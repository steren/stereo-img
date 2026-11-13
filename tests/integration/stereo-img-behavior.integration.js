import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

const SMALL = '/examples/persepolis.anaglyph.jpg';
const OTHER_SMALL = '/examples/wikipedia.anaglyph.jpg';
const MONO = '/examples/Panasonic-DMC-GX8-left.jpg';
const MONO_RIGHT = '/examples/Panasonic-DMC-GX8-right.jpg';
const LEFT_RIGHT = '/examples/Panasonic-DMC-GX8.jpg';
const TOP_BOTTOM = '/examples/walrus-360.top-bottom.jpg';
const VR180 = '/examples/vr180-lenovo-mirage.vr.jpg';
const PORTRAIT = '/examples/Pixel7Pro.PORTRAIT.jpg';

// Camera layer masks: the left eye is drawn on layer 1, the right eye on layer 2.
const LEFT_EYE = 1 << 1;
const RIGHT_EYE = 1 << 2;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(condition, description, timeout = 20000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await wait(20);
  }
}

/** True when a picture is parsed and both of its eyes are in the scene. */
const isDisplayed = element => !!element.stereoData
  && !element.loadingIndicator.visible
  && element.stereoImageGroup?.children.length >= 2;

/** Wait for the element to be done displaying a picture. */
async function displayed(element) {
  await waitFor(() => isDisplayed(element), 'the picture to be displayed');
  // Let a parse triggered by the previous one start, if any, then wait for it too.
  await wait(100);
  await waitFor(() => isDisplayed(element), 'the picture to be displayed');
}

/** Change attributes, then wait for the new picture to be displayed. */
async function update(element, attributes) {
  const previous = element.stereoData;
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, value);
    }
  }
  await waitFor(() => element.stereoData !== previous, 'the picture to be parsed again');
  await displayed(element);
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Identities and types are compared outside of chai: on failure, chai would
// serialize whole images in its error message.
const sameImageInBothEyes = element => element.stereoData.leftEye === element.stereoData.rightEye;
const eyesAreImageData = element => element.stereoData.leftEye instanceof ImageData && element.stereoData.rightEye instanceof ImageData;
const geometryTypes = element => element.stereoImageGroup.children.map(child => child.geometry.type);

describe('stereo-img', () => {
  let element;

  /** Create an element, add it to the page and wait for its picture to be displayed. */
  async function create(attributes = {}, style = { width: '400px', height: '300px' }) {
    element = document.createElement('stereo-img');
    Object.assign(element.style, style);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    await displayed(element);
    return element;
  }

  afterEach(() => {
    if (element) {
      element.remove();
      // Stop drawing frames for an element that is not used anymore.
      element.renderer?.setAnimationLoop(null);
      element = null;
    }
  });

  describe('type detection', () => {
    it('should detect a VR photo from its metadata', async () => {
      await create({ src: VR180 });

      expect(element.stereoData.leftEye === VR180).to.be.true;
      expect(typeof element.stereoData.rightEye).to.equal('string');
      expect(element.stereoData.rightEye.startsWith('data:image/jpg;base64,')).to.be.true;
      expect(element.stereoData.phiLength).to.be.closeTo(Math.PI, 0.001);
      expect(geometryTypes(element)).to.deep.equal(['SphereGeometry', 'SphereGeometry']);
    }).timeout(30000);

    it('should detect a side by side picture', async () => {
      const image = await loadImage(LEFT_RIGHT);
      await create({ src: LEFT_RIGHT });

      expect(eyesAreImageData(element)).to.be.true;
      expect(sameImageInBothEyes(element)).to.be.false;
      expect(element.stereoData.leftEye.width).to.equal(image.width / 2);
      expect(element.stereoData.rightEye.width).to.equal(image.width / 2);
      expect(element.stereoData.leftEye.height).to.equal(image.height);
    }).timeout(30000);

    it('should detect a picture that is not stereoscopic', async () => {
      const image = await loadImage(MONO);
      await create({ src: MONO });

      expect(sameImageInBothEyes(element)).to.be.true;
      expect(element.stereoData.leftEye.width).to.equal(image.width);
      expect(geometryTypes(element)).to.deep.equal(['PlaneGeometry', 'PlaneGeometry']);
    }).timeout(30000);

    it('should detect a portrait picture with a depth map from its file name', async () => {
      await create({ src: PORTRAIT });

      expect(element.stereoData.depth instanceof HTMLImageElement).to.be.true;
      expect(element.stereoData.depth.naturalWidth).to.be.greaterThan(0);
      expect(sameImageInBothEyes(element)).to.be.true;
      expect(element.stereoImageGroup.children.every(child => !!child.material.displacementMap)).to.be.true;
    }).timeout(30000);

    it('should use "src-right" as the right eye', async () => {
      const left = await loadImage(MONO);
      const right = await loadImage(MONO_RIGHT);
      await create({ src: MONO, 'src-right': MONO_RIGHT });

      expect(eyesAreImageData(element)).to.be.true;
      expect(sameImageInBothEyes(element)).to.be.false;
      expect(element.stereoData.leftEye.width).to.equal(left.width);
      expect(element.stereoData.rightEye.width).to.equal(right.width);
    }).timeout(30000);

    it('should display an empty scene without "src"', async () => {
      await create();

      expect(element.stereoData.leftEye.width).to.equal(10);
      expect(element.stereoImageGroup.children.length).to.equal(2);
    });
  });

  describe('"type" attribute', () => {
    it('should split a "top-bottom" picture and use its angle', async () => {
      const image = await loadImage(TOP_BOTTOM);
      await create({ src: TOP_BOTTOM, type: 'top-bottom', angle: '360' });

      expect(element.stereoData.leftEye.width).to.equal(image.width);
      expect(element.stereoData.leftEye.height).to.equal(image.height / 2);
      expect(element.stereoData.phiLength).to.equal(Math.PI * 2);
      expect(element.stereoData.thetaLength).to.equal(Math.PI);
      expect(geometryTypes(element)).to.deep.equal(['SphereGeometry', 'SphereGeometry']);
    }).timeout(30000);

    it('should split the colors of an "anaglyph" picture', async () => {
      const image = await loadImage(SMALL);
      await create({ src: SMALL, type: 'anaglyph' });

      expect(eyesAreImageData(element)).to.be.true;
      expect(sameImageInBothEyes(element)).to.be.false;
      expect(element.stereoData.leftEye.width).to.equal(image.width);
      // each eye is a grey picture
      const [red, green, blue] = element.stereoData.leftEye.data;
      expect(red).to.equal(green);
      expect(green).to.equal(blue);
    }).timeout(30000);

    it('should display the same picture in both eyes for "mono"', async () => {
      await create({ src: LEFT_RIGHT, type: 'mono' });

      expect(sameImageInBothEyes(element)).to.be.true;
    }).timeout(30000);

    it('should swap the eyes of a "right-left" picture', async () => {
      await create({ src: LEFT_RIGHT, type: 'left-right' });
      const leftRight = { left: element.stereoData.leftEye.data.slice(0, 400), right: element.stereoData.rightEye.data.slice(0, 400) };

      await update(element, { type: 'right-left' });
      const rightLeft = { left: element.stereoData.leftEye.data.slice(0, 400), right: element.stereoData.rightEye.data.slice(0, 400) };

      expect(rightLeft.left.join()).to.equal(leftRight.right.join());
      expect(rightLeft.right.join()).to.equal(leftRight.left.join());
      expect(leftRight.left.join()).to.not.equal(leftRight.right.join());
    }).timeout(30000);
  });

  describe('attribute changes', () => {
    it('should display the new picture when "src" changes', async () => {
      const other = await loadImage(OTHER_SMALL);
      await create({ src: SMALL, type: 'mono' });
      expect(element.stereoData.leftEye.width).to.not.equal(other.width);

      await update(element, { src: OTHER_SMALL });

      expect(element.stereoData.leftEye.width).to.equal(other.width);
    }).timeout(30000);

    it('should parse the same picture again when "type" changes', async () => {
      await create({ src: LEFT_RIGHT, type: 'mono' });
      expect(sameImageInBothEyes(element)).to.be.true;

      await update(element, { type: 'left-right' });

      expect(sameImageInBothEyes(element)).to.be.false;
    }).timeout(30000);

    it('should parse the same picture again when "angle" changes', async () => {
      await create({ src: LEFT_RIGHT, type: 'left-right' });
      expect(element.stereoData.phiLength).to.be.lessThan(Math.PI / 2);
      expect(geometryTypes(element)).to.deep.equal(['PlaneGeometry', 'PlaneGeometry']);

      await update(element, { angle: '180' });

      expect(element.stereoData.phiLength).to.equal(Math.PI);
      expect(geometryTypes(element)).to.deep.equal(['SphereGeometry', 'SphereGeometry']);
    }).timeout(30000);

    it('should display an empty scene when "src" is removed', async () => {
      await create({ src: SMALL, type: 'mono' });

      await update(element, { src: null });

      expect(element.stereoData.leftEye.width).to.equal(10);
    }).timeout(30000);

    it('should display the wireframe of the geometry in "debug" mode', async () => {
      await create({ src: SMALL, type: 'mono' });
      expect(element.stereoImageGroup.children.length).to.equal(2);

      const previous = element.stereoData;
      element.setAttribute('debug', 'true');
      await waitFor(() => element.stereoData !== previous && element.stereoImageGroup?.children.length === 4, 'the wireframes');

      expect(element.stereoImageGroup.children.map(child => child.type)).to.deep.equal(['Mesh', 'LineSegments', 'Mesh', 'LineSegments']);
    }).timeout(30000);

    it('should reflect properties to attributes', async () => {
      await create();
      const properties = {
        src: 'src',
        srcRight: 'src-right',
        type: 'type',
        angle: 'angle',
        projection: 'projection',
        flat: 'flat',
        controlslist: 'controlslist',
        debug: 'debug',
      };

      for (const [property, attribute] of Object.entries(properties)) {
        expect(element[property], property).to.equal(null);

        // values that do not trigger the loading of a picture
        const value = property === 'flat' ? 'right' : property === 'controlslist' ? 'vr' : 'value';
        element[property] = value;
        expect(element.getAttribute(attribute), attribute).to.equal(value);
        expect(element[property], property).to.equal(value);

        element[property] = null;
        expect(element.hasAttribute(attribute), attribute).to.be.false;
      }
    });
  });

  describe('scene', () => {
    it('should display each eye on its own layer', async () => {
      await create({ src: LEFT_RIGHT, type: 'left-right' });

      expect(element.stereoImageGroup.children.map(child => child.layers.mask)).to.deep.equal([LEFT_EYE, RIGHT_EYE]);
    }).timeout(30000);

    it('should use a plane for a narrow angle of view and a sphere for a wide one', async () => {
      await create({ src: SMALL, type: 'mono', angle: '60' });
      expect(geometryTypes(element)).to.deep.equal(['PlaneGeometry', 'PlaneGeometry']);

      await update(element, { angle: '120' });
      expect(geometryTypes(element)).to.deep.equal(['SphereGeometry', 'SphereGeometry']);
    }).timeout(30000);

    it('should apply the roll and pitch of a VR photo', async () => {
      await create({ src: '/examples/vr180-lenovo-pitch-roll.vr.jpg', type: 'vr' });

      expect(element.stereoData.roll).to.be.closeTo(0.974, 0.001);
      expect(element.stereoData.pitch).to.be.closeTo(0.522, 0.001);
      for (const mesh of element.stereoImageGroup.children) {
        expect(mesh.rotation.x).to.equal(element.stereoData.roll);
        expect(mesh.rotation.z).to.equal(element.stereoData.pitch);
      }
    }).timeout(30000);
  });

  describe('"flat" attribute', () => {
    /** Wait for the element to draw some frames. They can be late when the browser is busy with other test files. */
    async function frames(count = 3) {
      const frame = element.renderer.info.render.frame;
      await waitFor(() => element.renderer.info.render.frame >= frame + count, 'frames to be drawn');
    }

    /** Collect the eyes the camera looks at while a few frames are drawn. */
    async function eyesSeen() {
      await frames();
      const seen = new Set();
      const frame = element.renderer.info.render.frame;
      while (element.renderer.info.render.frame < frame + 5) {
        seen.add(element.camera.layers.mask);
        await wait(10);
      }
      seen.add(element.camera.layers.mask);
      return [...seen].sort();
    }

    it('should display the left eye by default', async () => {
      await create();

      expect(await eyesSeen()).to.deep.equal([LEFT_EYE]);
      expect(element.wiggleIntervalID).to.not.exist;
    });

    it('should display the right eye with "right"', async () => {
      await create({ flat: 'right' });

      expect(await eyesSeen()).to.deep.equal([RIGHT_EYE]);
    });

    it('should alternate between both eyes with "wiggle"', async () => {
      await create({ flat: 'wiggle' });

      expect(element.wiggleIntervalID).to.exist;
      const seen = new Set();
      await waitFor(() => seen.add(element.camera.layers.mask).size === 2, 'both eyes to be displayed');
      expect([...seen].sort()).to.deep.equal([LEFT_EYE, RIGHT_EYE]);
    });

    it('should stop alternating when leaving "wiggle"', async () => {
      await create({ flat: 'wiggle' });

      element.setAttribute('flat', 'left');

      expect(element.wiggleIntervalID).to.not.exist;
      expect(await eyesSeen()).to.deep.equal([LEFT_EYE]);
    });

    it('should render with the anaglyph effect with "anaglyph"', async () => {
      await create();
      let anaglyphFrames = 0;
      const render = element.anaglyphEffect.render.bind(element.anaglyphEffect);
      element.anaglyphEffect.render = (...args) => {
        anaglyphFrames++;
        return render(...args);
      };
      await frames();
      expect(anaglyphFrames).to.equal(0);

      element.setAttribute('flat', 'anaglyph');
      await waitFor(() => anaglyphFrames > 2, 'anaglyph frames');

      element.setAttribute('flat', 'left');
      await wait(50);
      const framesWhenLeft = anaglyphFrames;
      await wait(200);
      expect(anaglyphFrames).to.equal(framesWhenLeft);
    });

    it('should follow the "flat" property', async () => {
      await create();

      element.flat = 'right';

      expect(element.getAttribute('flat')).to.equal('right');
      expect(await eyesSeen()).to.deep.equal([RIGHT_EYE]);
    });
  });

  describe('controls', () => {
    const vrButton = () => element.shadowRoot.querySelector('#VRButton');
    const flatButtons = () => Array.from(element.shadowRoot.querySelectorAll('#flatModeButton button'));
    const flatButtonLabels = () => flatButtons().map(button => button.getAttribute('aria-label'));
    const highlighted = () => flatButtons().filter(button => button.style.background !== 'transparent').map(button => button.getAttribute('aria-label'));

    it('should display the VR button and all the flat modes by default', async () => {
      await create();

      expect(vrButton()).to.exist;
      expect(flatButtonLabels()).to.deep.equal(['left view', 'right view', 'wiggle view', 'anaglyph view']);
    });

    it('should only display the controls listed in "controlslist"', async () => {
      await create({ controlslist: 'left right' });

      expect(vrButton()).to.not.exist;
      expect(flatButtonLabels()).to.deep.equal(['left view', 'right view']);
    });

    it('should not display flat mode buttons when there is nothing to choose from', async () => {
      await create({ controlslist: 'vr left' });

      expect(vrButton()).to.exist;
      expect(flatButtonLabels()).to.deep.equal([]);
    });

    it('should update the controls when "controlslist" changes', async () => {
      await create();

      element.setAttribute('controlslist', 'wiggle anaglyph');
      expect(vrButton()).to.not.exist;
      expect(flatButtonLabels()).to.deep.equal(['wiggle view', 'anaglyph view']);

      element.removeAttribute('controlslist');
      expect(vrButton()).to.exist;
      expect(flatButtonLabels().length).to.equal(4);
      // no duplicates
      expect(element.shadowRoot.querySelectorAll('#VRButton').length).to.equal(1);
      expect(element.shadowRoot.querySelectorAll('#flatModeButton').length).to.equal(1);
    });

    it('should change the flat mode when a button is clicked', async () => {
      await create();
      expect(highlighted()).to.deep.equal(['left view']);

      flatButtons().find(button => button.getAttribute('aria-label') === 'right view').click();
      await wait(50);

      expect(element.getAttribute('flat')).to.equal('right');
      expect(highlighted()).to.deep.equal(['right view']);
    });

    it('should highlight the button of the current flat mode', async () => {
      await create({ flat: 'anaglyph' });

      expect(highlighted()).to.deep.equal(['anaglyph view']);
    });
  });

  describe('size', () => {
    it('should default to a 4:3 aspect ratio when it has no height', async () => {
      await create({}, { width: '400px' });

      expect(element.clientHeight).to.equal(300);
      expect(element.renderer.domElement.style.width).to.equal('400px');
      expect(element.renderer.domElement.style.height).to.equal('300px');
    });

    it('should keep the height it is given', async () => {
      await create({}, { width: '400px', height: '200px' });

      expect(element.clientHeight).to.equal(200);
      expect(element.renderer.domElement.style.height).to.equal('200px');
      expect(element.camera.aspect).to.equal(2);
    });

    it('should follow size changes', async () => {
      await create();

      element.style.width = '200px';
      element.style.height = '200px';
      await waitFor(() => element.renderer.domElement.style.width === '200px', 'the canvas to be resized');

      expect(element.renderer.domElement.style.height).to.equal('200px');
      expect(element.camera.aspect).to.equal(1);
    });
  });
});
