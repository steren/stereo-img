// TODO: only load the module that corresponds to "type"
import { parseVR180 } from './modules/vr180-parser/vr180-parser.js';
import { parseStereo } from './modules/stereo-parser/stereo-parser.js';

// TODO: Decide how to load three.js.
import * as THREE from 'https://cdn.skypack.dev/three@0.133.1';
import { VRButton } from 'https://cdn.skypack.dev/three@0.133.1/examples/jsm/webxr/VRButton.js';


class StereoImg extends HTMLElement {

    /**
     * type attribute: "left-right" (default), "top-bottom", "vr180"
     */
    get type() {
      return this.getAttribute('type');
    }
    set type(val) {
      // Reflect the value of the open property as an HTML attribute.
      if (val) {
        this.setAttribute('type', val);
      } else {
        this.removeAttribute('type');
      }
    }

    get src() {
      return this.getAttribute('src');
    }
    set src(val) {
      // Reflect the value of the open property as an HTML attribute.
      if (val) {
        this.setAttribute('src', val);
      } else {
        this.removeAttribute('src');
      }
    }

    animate() {
      this.renderer.setAnimationLoop( () => {
        this.renderer.render( this.scene, this.camera );
      } );
    }
  
    async parse() {
      if(this.type === 'vr180') {
        this.stereoData = await parseVR180(this.src);
      } else if(this.type === 'left-right') {
        this.stereoData = await parseStereo(this.src);
      }
      console.log(this.stereoData);
    }

    initialize3DScene() {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color( 0x101010 );

			// left eye

      const texture1 = new THREE.Texture(this.stereoData.leftEye);
      texture1.needsUpdate = true;

      // TODO: Screen size should depend on image aspect ratio, camera fov...
      const geometry1 = new THREE.SphereGeometry( 500, 60, 40, Math.PI, this.stereoData.phiLength, this.stereoData.thetaStart, this.stereoData.thetaLength);
      // invert the geometry on the x-axis so that all of the faces point inward
      geometry1.scale( - 1, 1, 1 );

      const material1 = new THREE.MeshBasicMaterial( { map: texture1 } );

      const mesh1 = new THREE.Mesh( geometry1, material1 );
      mesh1.layers.set( 1 ); // display in left eye only
      this.scene.add( mesh1 );


      // right eye

      const texture2 = new THREE.Texture(this.stereoData.rightEye);
      texture2.needsUpdate = true;

      const geometry2 = new THREE.SphereGeometry( 500, 60, 40, Math.PI, this.stereoData.phiLength, this.stereoData.thetaStart, this.stereoData.thetaLength);
      geometry2.scale( - 1, 1, 1 );

      const material2 = new THREE.MeshBasicMaterial( { map: texture2 } );

      const mesh2 = new THREE.Mesh( geometry2, material2 );
      mesh2.layers.set( 2 ); // display in right eye only
      this.scene.add( mesh2 );
    }

    async init() {
      this.attachShadow({mode: 'open'});
      this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          contain: content;
        }
        canvas {
          width: 100%;
        }
      </style>
    `;

      this.addEventListener('click', () => {
        this.pause = !this.pause;
      });

      await this.parse();
      this.initialize3DScene();

      this.renderer = new THREE.WebGLRenderer();
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.xr.enabled = true;
      this.shadowRoot.appendChild(this.renderer.domElement);

      // TODO: Should we use component size instead?
      this.camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 1, 2000 );
      this.camera.layers.enable( 1 );

      this.shadowRoot.appendChild(VRButton.createButton(this.renderer));

      this.animate();
    }


    constructor() {
      super();
      this.init();
    }

  }

window.customElements.define('stereo-img', StereoImg);

