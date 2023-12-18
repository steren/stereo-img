// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { parseVR } from './parsers/vr-parser/vr-parser.js';
import { parseStereo } from './parsers/stereo-parser/stereo-parser.js';
import { parseAnaglyph } from './parsers/anaglyph-parser/anaglyph-parser.js';
import exifr from 'exifr';

import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { OrbitControls  } from 'three/examples/jsm/controls/OrbitControls.js';


class StereoImg extends HTMLElement {

    get type() {
      return this.getAttribute('type');
    }
    set type(val) {
      if (val) {
        this.setAttribute('type', val);
      } else {
        this.removeAttribute('type');
      }
    }

    get angle() {
      return this.getAttribute('angle');
    }
    set angle(val) {
      if (val) {
        this.setAttribute('angle', val);
      } else {
        this.removeAttribute('angle');
      }
    }

    get debug() {
      return this.getAttribute('debug');
    }
    set debug(val) {
      if (val) {
        this.setAttribute('debug', val);
      } else {
        this.removeAttribute('debug');
      }
    }

    get projection() {
      return this.getAttribute('projection');
    }
    set projection(val) {
      if (val) {
        this.setAttribute('projection', val);
      } else {
        this.removeAttribute('projection');
      }
    }

    get src() {
      return this.getAttribute('src');
    }
    set src(val) {
      if (val) {
        this.setAttribute('src', val);
      } else {
        this.removeAttribute('src');
      }

      // use setTimeout to ensure all DOM updates have finished, it's indeed common to update both src= and type= at the same time.
      // There is probably a cleaner way to do this.
      let that = this;
      window.setTimeout(() => {
        that.parseImageAndInitialize3DScene();
      }, 0);
    }

    animate() {
      this.renderer.setAnimationLoop( () => {
        this.renderer.render( this.scene, this.camera );
      } );
    }
  
    async parse() {
      if(this.src) {
        if(this.type === 'vr180' || this.type === 'vr') {
          this.stereoData = await parseVR(this.src);
        } else if(this.type === 'left-right' || this.type === 'right-left' || this.type === 'bottom-top' || this.type === 'top-bottom') {
          this.stereoData = await parseStereo(this.src, {
            type: this.type,
            angle: this.angle,
          });
        } else if(this.type === 'anaglyph') {
          this.stereoData = await parseAnaglyph(this.src, {
            angle: this.angle,
          });
        } else {
          // Read XMP metadata
          const exif = await exifr.parse(this.src, {
            xmp: true,
            multiSegment: true,
            mergeOutput: false,
            ihdr: true, //unclear why we need this, but if not enabled, some VR180 XMP Data are not parsed
          });

          if (exif?.GImage?.Data) {
            // XMP for left eye found, assume VR Photo
            this.stereoData = await parseVR(this.src);
          } else {
            // no left eye found, assume left-right
            console.warn('<stereo-img> does not have a "type" attribute and image does not have XMP metadata of a VR picture.  Use "type" attribute to specify the type of stereoscopic image. Assuming left-right stereo image.');
            this.stereoData = await parseStereo(this.src, {
              angle: this.angle,
            });
          }
        }
      } else {
        // no src attribute. Use fake stereo data to render a black sphere
        this.stereoData = {
          leftEye: new ImageData(10, 10),
          rightEye: new ImageData(10, 10),
          phiLength: 0,
          thetaStart: 0,
          thetaLength: 0
        };
      }
    }

    /**
     * 
     * @param {String} eye: "left" or "right"
     */
    createEye(eye, debug) {
      const radius = 10; // 500

      const eyeNumber = eye === "left" ? 1 : 2;
      const imageData = eye === "left" ? this.stereoData.leftEye : this.stereoData.rightEye;

      // left eye
      const texture = new THREE.Texture(imageData);
      texture.needsUpdate = true;

      // TODO: Screen size should depend on image aspect ratio, camera fov...
      const geometry = new THREE.SphereGeometry(radius, 60, 40, -1 * this.stereoData.phiLength / 2, this.stereoData.phiLength, this.stereoData.thetaStart, this.stereoData.thetaLength);
      // invert the geometry on the x-axis so that all of the faces point inward
      geometry.scale(-1, 1, 1);

      if (this.projection === 'fisheye' || this.stereoData.projection === 'fisheye') {
        // by default, the sphere UVs are equirectangular
        // re-set the UVs of the sphere to be compatible with a fisheye image
        // to do so, we use the spatial positions of the vertices
        if(this.angle != "180") {
          console.warn('Fisheye projection is only well supported for 180° stereoscopic images.');
        }

        const imageWidth = imageData.width;
        const imageHeight = imageData.height;
  
        const normals = geometry.attributes.normal.array;
        const uvs = geometry.attributes.uv.array;
        for (let i = 0, l = normals.length / 3; i < l; i++) {
  
          const x = normals[i * 3 + 0];
          const y = normals[i * 3 + 1];
          const z = normals[i * 3 + 2];
  
          // TODO: understand and check this line of math. It is taken from https://github.com/mrdoob/three.js/blob/f32e6f14046b5affabe35a0f42f0cad7b5f2470e/examples/webgl_panorama_dualfisheye.html
          var correction = (y == 0 && z == 0) ? 1 : (Math.acos(x) / Math.sqrt(y * y + z * z)) * (2 / Math.PI);
          // UVs expand the whole x axis
          uvs[ i * 2 + 0 ] = z * 0.5 * correction + 0.5;
          // fisheye images usually use the full width of the image, but not the full height
          uvs[ i * 2 + 1 ] = y * 0.5 * imageWidth / imageHeight * correction + 0.5;
  
        }
      }

      const material = new THREE.MeshBasicMaterial({ map: texture });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.reorder('YXZ');
      mesh.rotation.y = Math.PI / 2;
      mesh.rotation.x = this.stereoData.roll || 0;
      mesh.rotation.z = this.stereoData.pitch || 0;
      mesh.layers.set(eyeNumber); // display in left/right eye only
      this.scene.add(mesh);

      if(this.debug) {
        const wireframe = new THREE.WireframeGeometry(geometry);
        const line = new THREE.LineSegments(wireframe);
        line.material.depthTest = false;
        line.material.opacity = 0.25;
        line.material.transparent = true;
        line.rotation.reorder('YXZ');
        line.rotation.y = Math.PI / 2;
        line.rotation.x = this.stereoData.roll || 0;
        line.rotation.z = this.stereoData.pitch || 0;
        line.layers.set(eyeNumber);
        this.scene.add(line);
      }
    }

    initialize3DScene() {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color( 0x101010 );

      this.createEye("left");
      this.createEye("right");
    }

    async parseImageAndInitialize3DScene() {
      await this.parse();
      this.initialize3DScene();
    }

    async init() {
      if (this.debug) {
        console.log('Debug mode enabled');
        this.debug = true;
      }
      

      this.attachShadow({mode: 'open'});
      this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          contain: content;
        }
      </style>
      `;

      // TODO: should we also read width and height attributes and resize element accordingly?
      if(this.clientHeight === 0) {
        const aspectRatio = 4 / 3;
        this.style.height = this.clientWidth / aspectRatio + "px";
      }

      await this.parseImageAndInitialize3DScene();

      this.renderer = new THREE.WebGLRenderer();
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.xr.enabled = true;
      this.renderer.setSize(this.clientWidth, this.clientHeight);
      this.shadowRoot.appendChild(this.renderer.domElement);

      // TODO: Should we use component size instead?
      this.camera = new THREE.PerspectiveCamera( 70, this.clientWidth / this.clientHeight, 1, 2000 );
      this.camera.layers.enable( 1 );

      const controls = new OrbitControls( this.camera, this.renderer.domElement );
      this.camera.position.set(0, 0, 0.1);
      controls.update();

      this.shadowRoot.appendChild(VRButton.createButton(this.renderer));

      this.animate();

      // Listen for component resize
      const resizeObserver = new ResizeObserver(() => {
        this.renderer.setSize(this.clientWidth, this.clientHeight);
        this.camera.aspect = this.clientWidth / this.clientHeight;
        this.camera.updateProjectionMatrix();
      });

      resizeObserver.observe(this);
    }


    constructor() {
      super();
      this.init();
    }

  }

window.customElements.define('stereo-img', StereoImg);

