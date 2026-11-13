import { expect } from '@esm-bundle/chai';
import { XRDevice, metaQuest3 } from 'iwer';
import { parseVR } from '../../parsers/vr-parser/vr-parser.js';
import '../../stereo-img.js';

// There is no VR headset here: emulate one.
const xrDevice = new XRDevice(metaQuest3);
xrDevice.installRuntime({ forceInstall: true });

// A panorama taken with Google Camera, with the sound recorded while taking it.
const WITH_SOUND = '/examples/pixel3xl.PANO.jpg';
const OTHER_WITH_SOUND = '/examples/pixel5.PANO.jpg';
const WITHOUT_SOUND = '/examples/vr180-lenovo-mirage.vr.jpg';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(condition, description, timeout = 30000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await wait(20);
  }
}

describe('stereo-img sound', function () {
  this.timeout(60000);

  let element;
  let playing;
  const { play, pause } = HTMLMediaElement.prototype;

  beforeEach(() => {
    // Tests cannot play sound for real: browsers require a gesture of the user. Record what would play.
    playing = new Set();
    HTMLMediaElement.prototype.play = function () {
      playing.add(this);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      playing.delete(this);
      return pause.call(this);
    };
  });

  afterEach(async () => {
    HTMLMediaElement.prototype.play = play;
    HTMLMediaElement.prototype.pause = pause;
    if (element?.renderer.xr.isPresenting) {
      await element.renderer.xr.getSession().end();
    }
    element?.remove();
    element?.renderer?.setAnimationLoop(null);
    element = null;
  });

  async function display(attributes) {
    element = document.createElement('stereo-img');
    element.style.width = '400px';
    element.style.height = '300px';
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
  }

  async function change(attributes) {
    const previous = element.stereoData;
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    await waitFor(() => element.stereoData !== previous && !element.loadingIndicator.visible, 'the next picture');
  }

  const soundButton = () => element.shadowRoot.querySelector('#soundButton');
  const vrButton = () => element.shadowRoot.querySelector('#VRButton');

  async function enterVR() {
    await waitFor(() => vrButton()?.textContent === 'ENTER VR', 'the "Enter VR" button');
    vrButton().click();
    await waitFor(() => element.renderer.xr.isPresenting, 'the VR session');
  }

  async function exitVR() {
    vrButton().click();
    await waitFor(() => !element.renderer.xr.isPresenting, 'the end of the VR session');
  }

  describe('in the VR parser', () => {
    it('should extract the sound of a panorama, as a type that browsers play', async () => {
      const result = await parseVR(WITH_SOUND);

      expect(result.audio.startsWith('data:audio/mp4;base64,')).to.be.true;
    });

    it('should extract a sound that plays', async function () {
      const audio = new Audio();
      if (!audio.canPlayType('audio/mp4; codecs="mp4a.40.2"')) {
        // this browser has no AAC decoder
        this.skip();
      }
      audio.src = (await parseVR(WITH_SOUND)).audio;

      await new Promise((resolve, reject) => {
        audio.onloadedmetadata = resolve;
        audio.onerror = () => reject(new Error(`cannot read the sound: ${audio.error?.message}`));
      });

      expect(audio.duration).to.be.closeTo(9.87, 0.1);
    });

    it('should find no sound in a picture without sound', async () => {
      const result = await parseVR(WITHOUT_SOUND);

      expect(result.audio).to.equal(undefined);
    });
  });

  it('should offer to play the sound of a picture that has one', async () => {
    await display({ src: WITH_SOUND });

    expect(element.audio).to.exist;
    expect(element.audio.loop).to.be.true;
    expect(soundButton()).to.exist;
    expect(soundButton().getAttribute('aria-label')).to.equal('Sound');
    expect(soundButton().getAttribute('aria-pressed')).to.equal('false');
    // nothing plays until asked
    expect(playing.size).to.equal(0);
  });

  it('should play and stop the sound with the button', async () => {
    await display({ src: WITH_SOUND });

    soundButton().click();
    expect(playing.has(element.audio)).to.be.true;
    expect(soundButton().getAttribute('aria-pressed')).to.equal('true');

    soundButton().click();
    expect(playing.size).to.equal(0);
    expect(soundButton().getAttribute('aria-pressed')).to.equal('false');
  });

  it('should have no sound button for a picture without sound', async () => {
    await display({ src: WITHOUT_SOUND });

    expect(element.audio).to.not.exist;
    expect(soundButton()).to.not.exist;
  });

  it('should have no sound button when "controlslist" leaves it out', async () => {
    await display({ src: WITH_SOUND, controlslist: 'vr left right' });
    expect(soundButton()).to.not.exist;

    element.setAttribute('controlslist', 'vr sound');
    expect(soundButton()).to.exist;
  });

  it('should stop the sound when a picture without sound replaces the picture', async () => {
    await display({ src: WITH_SOUND });
    soundButton().click();
    expect(playing.size).to.equal(1);

    await change({ src: WITHOUT_SOUND });

    expect(playing.size).to.equal(0);
    expect(element.audio).to.not.exist;
    expect(soundButton()).to.not.exist;
  });

  it('should keep playing with the sound of the next picture', async () => {
    await display({ src: WITH_SOUND });
    soundButton().click();
    const first = element.audio;

    await change({ src: OTHER_WITH_SOUND });

    expect(element.audio).to.not.equal(first);
    expect([...playing]).to.deep.equal([element.audio]);
    expect(soundButton().getAttribute('aria-pressed')).to.equal('true');
  });

  it('should stay silent when the browser refuses to play', async () => {
    await display({ src: WITH_SOUND });
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('play() failed because the user did not interact with the document first', 'NotAllowedError'));

    soundButton().click();
    await wait(50);

    expect(element.soundOn).to.be.false;
    expect(soundButton().getAttribute('aria-pressed')).to.equal('false');
  });

  it('should stop the sound when the element is removed', async () => {
    await display({ src: WITH_SOUND });
    soundButton().click();
    expect(playing.size).to.equal(1);

    element.remove();

    expect(playing.size).to.equal(0);
  });

  it('should play the sound in VR, and stop when leaving', async () => {
    await display({ src: WITH_SOUND });

    await enterVR();
    expect([...playing]).to.deep.equal([element.audio]);
    expect(soundButton().getAttribute('aria-pressed')).to.equal('true');

    await exitVR();
    expect(playing.size).to.equal(0);
    expect(soundButton().getAttribute('aria-pressed')).to.equal('false');
  });

  it('should keep playing after VR when the sound was already on', async () => {
    await display({ src: WITH_SOUND });
    soundButton().click();

    await enterVR();
    await exitVR();

    expect([...playing]).to.deep.equal([element.audio]);
  });

  it('should not play the sound in VR when the element is muted', async () => {
    await display({ src: WITH_SOUND, muted: '' });
    expect(element.muted).to.be.true;

    await enterVR();
    expect(playing.size).to.equal(0);

    // the user can still ask for it
    soundButton().click();
    expect(playing.size).to.equal(1);
  });

  it('should reflect the "muted" property', async () => {
    await display({ src: WITHOUT_SOUND });

    element.muted = true;
    expect(element.hasAttribute('muted')).to.be.true;
    element.muted = false;
    expect(element.hasAttribute('muted')).to.be.false;
  });
});
