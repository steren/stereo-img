// A VR headset for the tests: just enough of WebXR for the component, and for three.js, to start a session, draw frames
// and hear about controllers and hands.
// There is no headset where the tests run, and the browser refuses VR sessions without one.

import * as THREE from '../../../vendor/three/three.module.min.js';

/** One half of the canvas for each eye. */
class FakeLayer {
  constructor(session, gl) {
    // null is the canvas itself
    this.framebuffer = null;
    this.framebufferWidth = gl.drawingBufferWidth;
    this.framebufferHeight = gl.drawingBufferHeight;
    session.showFullScreen(gl.canvas);
  }

  getViewport(view) {
    const width = this.framebufferWidth / 2;
    return { x: view.eye === 'left' ? 0 : width, y: 0, width, height: this.framebufferHeight };
  }
}

/** What a hand holds or does: a controller with a trigger and a thumbstick, or the hand itself, which pinches. */
class FakeInput {
  constructor(headset, handedness, isHand) {
    this.headset = headset;
    this.pressed = false;
    /** What a session tells about it: an XRInputSource. */
    this.inputSource = { handedness, targetRayMode: 'tracked-pointer' };
    if (isHand) {
      this.inputSource.profiles = ['generic-hand'];
      this.inputSource.hand = new Map();
    } else {
      this.inputSource.profiles = ['generic-trigger-squeeze-thumbstick'];
      // the standard layout: a touchpad on the first two axes, a thumbstick on the next two
      this.inputSource.gamepad = { mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: [{ pressed: false, touched: false, value: 0 }] };
    }
  }

  /** Press the trigger of the controller, or pinch the fingers of the hand. */
  press() {
    if (!this.pressed) {
      this.pressed = true;
      this._tell('selectstart');
    }
  }

  /** Release it: that is when a session says that something was selected. */
  release() {
    if (this.pressed) {
      this.pressed = false;
      this._tell('select');
      this._tell('selectend');
    }
  }

  /** Put the thumbstick of the controller at a position: from -1 on the left or at the top to 1 on the right or at the bottom. */
  moveThumbstick(x, y = 0) {
    this.inputSource.gamepad.axes[2] = x;
    this.inputSource.gamepad.axes[3] = y;
  }

  _tell(type) {
    const session = this.headset.session;
    // out of VR, nobody listens to the controllers
    if (session && session.inputSources.includes(this.inputSource)) {
      const event = new Event(type);
      event.inputSource = this.inputSource;
      session.dispatchEvent(event);
    }
  }
}

class FakeSession extends EventTarget {
  constructor(headset) {
    super();
    this.headset = headset;
    this.renderState = {};
    this.environmentBlendMode = 'opaque';
    this.ended = false;
  }

  /** What the viewer has in their hands, or their hands. */
  get inputSources() {
    const { left, right } = this.headset.input === 'hands' ? this.headset.hands : this.headset.controllers;
    return [left.inputSource, right.inputSource];
  }

  updateRenderState(state) {
    Object.assign(this.renderState, state);
  }

  /**
   * Take the canvas out of the page to show it over everything, as the runtimes that draw VR on the screen
   * of a phone do. When the session ends they leave it there, or drop it: they do not know where it was.
   */
  showFullScreen(canvas) {
    this.screen = document.createElement('div');
    this.screen.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:1000';
    this.screen.appendChild(canvas);
    document.body.appendChild(this.screen);
  }

  async requestReferenceSpace() {
    return {};
  }

  /** Frames come at the pace of the page, with where the head is. */
  requestAnimationFrame(callback) {
    return window.requestAnimationFrame(time => {
      if (!this.ended) {
        callback(time, { session: this, getViewerPose: () => this.headset.pose() });
      }
    });
  }

  cancelAnimationFrame(id) {
    window.cancelAnimationFrame(id);
  }

  async end() {
    if (this.ended) {
      throw new DOMException('The session has already ended.', 'InvalidStateError');
    }
    this.ended = true;
    this.headset.session = null;
    this.screen?.remove();
    const event = new Event('end');
    event.session = this;
    this.dispatchEvent(event);
  }
}

class FakeHeadset extends EventTarget {
  constructor() {
    super();
    /** The session in progress, if any. */
    this.session = null;
    /** Where the head is in the room, in metres: standing, 1.6 above the floor. */
    this.position = new THREE.Vector3(0, 1.6, 0);
    /** Which way the head is turned. */
    this.quaternion = new THREE.Quaternion();
    /** What the headset follows: the 'controllers' that the viewer holds, or their bare 'hands'. */
    this.input = 'controllers';
    this.controllers = { left: new FakeInput(this, 'left', false), right: new FakeInput(this, 'right', false) };
    this.hands = { left: new FakeInput(this, 'left', true), right: new FakeInput(this, 'right', true) };
  }

  // What the page sees: navigator.xr

  async isSessionSupported(mode) {
    return mode === 'immersive-vr';
  }

  async requestSession() {
    // as browsers do: one immersive session at a time
    if (this.session) {
      throw new DOMException('There is already an active, immersive XRSession.', 'InvalidStateError');
    }
    this.session = new FakeSession(this);
    return this.session;
  }

  /** Where the head is and what each eye sees, as a frame of WebXR tells it. */
  pose() {
    const head = new THREE.Matrix4().compose(this.position, this.quaternion, new THREE.Vector3(1, 1, 1));
    const canvas = this.session.renderState.baseLayer;
    const aspect = canvas.framebufferWidth / 2 / canvas.framebufferHeight;
    const projection = new THREE.PerspectiveCamera(90, aspect, 0.1, 2000).projectionMatrix;
    // the eyes are 64 millimetres apart
    const views = [['left', -0.032], ['right', 0.032]].map(([eye, offset]) => {
      const matrix = head.clone().multiply(new THREE.Matrix4().makeTranslation(offset, 0, 0));
      return { eye, projectionMatrix: projection.toArray(), transform: { matrix: matrix.toArray() } };
    });
    return { views, transform: { position: this.position.clone(), orientation: this.quaternion.clone(), matrix: head.toArray() } };
  }
}

/**
 * Make the page believe that it has a VR headset. To call before any element is created.
 * @returns {FakeHeadset} the headset, to see its session and to move its head
 */
export function installFakeHeadset() {
  const headset = new FakeHeadset();
  Object.defineProperty(navigator, 'xr', { value: headset, configurable: true });
  window.XRWebGLLayer = FakeLayer;
  // three.js prefers this other way to draw when the browser has it: it needs a real session
  window.XRWebGLBinding = undefined;
  WebGL2RenderingContext.prototype.makeXRCompatible = async () => {};
  return headset;
}
