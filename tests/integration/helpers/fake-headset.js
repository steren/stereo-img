// A VR headset for the tests: just enough of WebXR for the component, and for three.js, to start a session and draw frames.
// There is no headset where the tests run, and the browser refuses VR sessions without one.

import * as THREE from '../../../vendor/three/three.module.min.js';

/** One half of the canvas for each eye. */
class FakeLayer {
  constructor(session, gl) {
    // null is the canvas itself
    this.framebuffer = null;
    this.framebufferWidth = gl.drawingBufferWidth;
    this.framebufferHeight = gl.drawingBufferHeight;
  }

  getViewport(view) {
    const width = this.framebufferWidth / 2;
    return { x: view.eye === 'left' ? 0 : width, y: 0, width, height: this.framebufferHeight };
  }
}

class FakeSession extends EventTarget {
  constructor(headset) {
    super();
    this.headset = headset;
    this.renderState = {};
    this.inputSources = [];
    this.environmentBlendMode = 'opaque';
    this.ended = false;
  }

  updateRenderState(state) {
    Object.assign(this.renderState, state);
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
