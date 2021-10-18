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

      this.animate();
    }

    initialize3DScene() {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color( 0x101010 );

      const loader = new THREE.TextureLoader();

      const texture = loader.load('demo.left-right.jpg');

			// left eye

      const geometry1 = new THREE.SphereGeometry( 500, 60, 40 );
      // invert the geometry on the x-axis so that all of the faces point inward
      geometry1.scale( - 1, 1, 1 );
      const uvs1 = geometry1.attributes.uv.array;
      for ( let i = 0; i < uvs1.length; i += 2 ) {
        uvs1[ i ] *= 0.5;
      }

      const material1 = new THREE.MeshBasicMaterial( { map: texture } );

      const mesh1 = new THREE.Mesh( geometry1, material1 );
      mesh1.rotation.y = - Math.PI / 2;
      mesh1.layers.set( 1 ); // display in left eye only
      this.scene.add( mesh1 );


      // right eye

      const geometry2 = new THREE.SphereGeometry( 500, 60, 40 );
      geometry2.scale( - 1, 1, 1 );

      const uvs2 = geometry2.attributes.uv.array;

      for ( let i = 0; i < uvs2.length; i += 2 ) {
        uvs2[ i ] *= 0.5;
        uvs2[ i ] += 0.5;
      }

      const material2 = new THREE.MeshBasicMaterial( { map: texture } );

      const mesh2 = new THREE.Mesh( geometry2, material2 );
      mesh2.rotation.y = - Math.PI / 2;
      mesh2.layers.set( 2 ); // display in right eye only
      this.scene.add( mesh2 );
    }


    constructor() {
      super();

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

      this.initialize3DScene();

      this.renderer = new THREE.WebGLRenderer();
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.xr.enabled = true;
      this.shadowRoot.appendChild(this.renderer.domElement);

      // TODO: Should we use component size instead?
      this.camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 1, 2000 );
      this.camera.layers.enable( 1 );

      this.shadowRoot.appendChild(VRButton.createButton(this.renderer));

      this.parse();
    }

  }

window.customElements.define('stereo-img', StereoImg);

