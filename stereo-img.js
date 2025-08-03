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
import { parseStereo, parseStereoPair } from './parsers/stereo-parser/stereo-parser.js';
import { parseAnaglyph } from './parsers/anaglyph-parser/anaglyph-parser.js';
import { parseDepth } from './parsers/depth-parser/depth-parser.js';
import exifr from './vendor/exifr/full.esm.js';

import * as THREE from './vendor/three/three.module.min.js';
import { VRButton } from './lib/VRButton.js';
import { OrbitControls  } from './lib/OrbitControls.js';
import { AnaglyphEffect } from './lib/AnaglyphEffect.js';
import { flatModeButton } from './lib/flatModeButton.js';


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

    get controlslist() {
      return this.getAttribute('controlslist');
    }
    set controlslist(val) {
      if (val) {
        this.setAttribute('controlslist', val);
      } else {
        this.removeAttribute('controlslist');
      }
    }

    get flat() {
      return this.getAttribute('flat');
    }
    set flat(val) {
      if (val) {
        this.setAttribute('flat', val);
      } else {
        this.removeAttribute('flat');
      }
      this.updateflatMode();
    }

    get wiggle() {
      console.warn('<stereo-img>: The "wiggle" attribute is deprecated. Use the "flat" attribute with a value of "wiggle" instead.');
      return this.getAttribute('wiggle');
    }
    set wiggle(val) {
      console.warn('<stereo-img>: The "wiggle" attribute is deprecated. Use the "flat" attribute with a value of "wiggle" instead.');
      if (val) {
        this.setAttribute('wiggle', val);
      } else {
        this.removeAttribute('wiggle');
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

    get srcRight() {
      return this.getAttribute('src-right');
    }
    set srcRight(val) {
      if (val) {
        this.setAttribute('src-right', val);
      } else {
        this.removeAttribute('src-right');
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
            projection: this.projection,
          });

        } else if(this.type === 'anaglyph') {
          this.stereoData = await parseAnaglyph(this.src, {
            angle: this.angle,
            projection: this.projection,
          });

        } else if(this.type === 'depth') {
          this.stereoData = await parseDepth(this.src);

        } else if(this.type === 'pair' || (!this.type && this.srcRight)) {
          if(this.srcRight) {
            const righturl = this.srcRight;
            this.type = 'pair';
            this.stereoData = await parseStereoPair(this.src, righturl, {
              type: this.type,
              angle: this.angle,
              projection: this.projection,
            });
          } else {
            console.error('<stereo-img> type "pair" is missing the "src-right" attribute for the right eye image.');
            this.stereoData = await parseStereo(this.src, {
              angle: this.angle,
              projection: this.projection,
            });
          }

        } else {
          // No type specified

          // if url ends with `PORTRAIT.jpg` assume type = depth
          if (this.src.toUpperCase().endsWith('PORTRAIT.JPG')) {
            this.stereoData = await parseDepth(this.src);
          } else {
            // try to read XMP metadata to see if VR Photo, otherwise assume stereo-style (e.g. "left right")
            // Read XMP metadata
            const exif = await exifr.parse(this.src, {
              xmp: true,
              multiSegment: true,
              mergeOutput: false,
              ihdr: true, //unclear why we need this, but if not enabled, some VR180 XMP Data are not parsed
            });

            if (exif?.GImage?.Data) {
              // GImage XMP for left eye found, assume VR Photo
              this.stereoData = await parseVR(this.src);
            } else {
              // no left eye found, assume stereo (e.g. left-right)
              console.info('<stereo-img> does not have a "type" attribute and image does not have XMP metadata of a VR picture.  Use "type" attribute to specify the type of stereoscopic image. Assuming stereo image of the "left-right" family.');
              this.stereoData = await parseStereo(this.src, {
                angle: this.angle,
                projection: this.projection,
              });
            }
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
     * When called, the element should wiggle between the left and right eye images
     * @param {Boolean} toggle: if true, enable wiggle, if false, disable wiggle
     */
    toggleWiggle(toggle) {
      let intervalMilliseconds = 1000 / 10;
      let layer = 1;
      
      // Clear any existing interval first
      if (this.wiggleIntervalID) {
        clearInterval(this.wiggleIntervalID);
        this.wiggleIntervalID = null; // Reset the ID
      }

      if(toggle) {
        // Store the new interval ID
        this.wiggleIntervalID = setInterval(() => {
          layer = layer === 1 ? 2 : 1;
          this.camera.layers.set(layer);
        }, intervalMilliseconds);
      } 
      // No need for an else block, as clearing is handled at the beginning
    } 

    /**
     * 
     * @param {String} eye: "left" or "right"
     */
    async createEye(eye, debug) {
      const radius = 10; // 500
      const depth = radius / 5;
      const planeSegments = this.stereoData.depth ? 256 : 1;
      const sphereWidthSegments = 60;
      const sphereHeightSegments = 40;

      const eyeNumber = eye === "left" ? 1 : 2;
      let imageData = eye === "left" ? this.stereoData.leftEye : this.stereoData.rightEye;

      // if max texture size supported by the GPU is below the eye image size, resize the image
      const maxTextureSize = this.renderer.capabilities.maxTextureSize;
      if (imageData.width > maxTextureSize || imageData.height > maxTextureSize) {
        const newWidth = Math.min(imageData.width, maxTextureSize);
        const newHeight = Math.min(imageData.height, maxTextureSize);
        console.warn(`Image size (${imageData.width}x${imageData.height}) exceeds max texture size (${maxTextureSize}x${maxTextureSize}). Resizing to ${newWidth}x${newHeight}.`);
        const canvas = document.createElement("canvas");
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext("2d");
        const imageBitmap = await createImageBitmap(imageData);
        ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
        imageData = ctx.getImageData(0, 0, newWidth, newHeight);
      }

      const texture = new THREE.Texture(imageData);
      texture.needsUpdate = true;
      texture.colorSpace = THREE.SRGBColorSpace;

      let geometry;
      // if angle is less than Pi / 2, use a plane, otherwise use a sphere
      if(this.stereoData.phiLength < Math.PI / 2) {
        const imageWidth = imageData.width;
        const imageHeight = imageData.height;
        const aspectRatio = imageWidth / imageHeight;

        const planeWidth = radius * 2;
        const planeHeight = planeWidth / aspectRatio;
        const planeDistance = radius;

        geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, planeSegments, planeSegments);
        // Put the plane in front of the camera (rotate and translate it)
        geometry.rotateY(-Math.PI / 2);
        geometry.translate(planeDistance, 0, 0);
      } else {
        geometry = new THREE.SphereGeometry(radius, sphereWidthSegments, sphereHeightSegments, -1 * this.stereoData.phiLength / 2, this.stereoData.phiLength, this.stereoData.thetaStart, this.stereoData.thetaLength);
        // invert the geometry on the x-axis so that all of the faces point inward
        geometry.scale(-1, 1, 1);
      }

      if (this.stereoData.projection === 'fisheye') {
        // by default, the sphere UVs are equirectangular
        // re-set the UVs of the sphere to be compatible with a fisheye image
        // to do so, we use the spatial positions of the vertices
        if(this.stereoData.phiLength !== Math.PI || this.stereoData.thetaLength !== Math.PI) {
          console.warn('Fisheye projection is only well supported for 180° stereoscopic images.');
        }
  
        const normals = geometry.attributes.normal.array;
        const uvs = geometry.attributes.uv.array;
        for (let i = 0, l = normals.length / 3; i < l; i++) {
  
          const x = normals[i * 3 + 0];
          const y = normals[i * 3 + 1];
          const z = normals[i * 3 + 2];
  
          // TODO: understand and check this line of math. It is taken from https://github.com/mrdoob/three.js/blob/f32e6f14046b5affabe35a0f42f0cad7b5f2470e/examples/webgl_panorama_dualfisheye.html
          var correction = (y == 0 && z == 0) ? 1 : (Math.acos(x) / Math.sqrt(y * y + z * z)) * (2 / Math.PI);
          // We expect that the left/right eye images have already been cropped of any black border.
          // Therefore, UVs expand the whole u and v axis 
          uvs[ i * 2 + 0 ] = z * 0.5 * correction + 0.5;
          uvs[ i * 2 + 1 ] = y * 0.5 * correction + 0.5;
          }
      }

      const material = new THREE.MeshStandardMaterial({ 
        map: texture,
        displacementScale: -1 * depth,
        displacementBias: depth / 2,
        flatShading: true,
      });
      if(this.stereoData.depth) {
        material.displacementMap = new THREE.Texture(this.stereoData.depth);
        material.displacementMap.needsUpdate = true;
        // material.displacementMap.colorSpace = THREE.SRGBColorSpace;
      }

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

    async initialize3DScene() {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color( 0x101010 );
      const light = new THREE.AmbientLight( 0xffffff, 3 );
      light.layers.enable(1);
      light.layers.enable(2);
      this.scene.add( light );

      await this.createEye("left");
      await this.createEye("right");

      this.updateflatMode();
    }

    updateflatMode() {
      const flatMode = this.getAttribute('flat');

      if (flatMode === 'left') {
        this.toggleWiggle(false);
        this.renderer.setAnimationLoop(() => {
          this.camera.layers.set(1);
          this.renderer.render(this.scene, this.camera);
        });
      } else if (flatMode === 'right') {
        this.toggleWiggle(false);
        this.renderer.setAnimationLoop(() => {
          this.camera.layers.set(2);
          this.renderer.render(this.scene, this.camera);
        });
      } else if (flatMode === 'anaglyph') {
        this.toggleWiggle(false);
        this.renderer.setAnimationLoop(() => {
          this.anaglyphEffect.render(this.scene, this.camera);
        });
      } else { // 'wiggle' is the default
        this.toggleWiggle(true);
        this.renderer.setAnimationLoop(() => {
          this.renderer.render(this.scene, this.camera);
        });
      }
    }

    async parseImageAndInitialize3DScene() {
      await this.parse();
      await this.initialize3DScene();
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

      this.renderer = new THREE.WebGLRenderer();
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.xr.enabled = true;
      this.renderer.setSize(this.clientWidth, this.clientHeight);
      this.shadowRoot.appendChild(this.renderer.domElement);

      this.anaglyphEffect = new AnaglyphEffect(this.renderer);
      this.anaglyphEffect.setSize(this.clientWidth, this.clientHeight);

      if (this.debug) {
        console.log(`Max Texture Size: ${this.renderer.capabilities.maxTextureSize}`);
      }

      // TODO: Should we use component size instead?
      this.camera = new THREE.PerspectiveCamera( 70, this.clientWidth / this.clientHeight, 1, 2000 );
      this.camera.layers.enable( 1 );

      const controls = new OrbitControls( this.camera, this.renderer.domElement );
      this.camera.position.set(0, 0, 0.1);
      controls.update();

      this.updateButtons();

      await this.parseImageAndInitialize3DScene();

      this.animate();

      // Listen for component resize
      const resizeObserver = new ResizeObserver(() => {
        this.renderer.setSize(this.clientWidth, this.clientHeight);
        this.camera.aspect = this.clientWidth / this.clientHeight;
        this.camera.updateProjectionMatrix();
        this.anaglyphEffect.setSize(this.clientWidth, this.clientHeight);
      });

      resizeObserver.observe(this);
    }

    static get observedAttributes() {
      return ['controlslist', 'flat'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (oldValue === newValue) {
        return;
      }
      if (name === 'controlslist') {
        this.updateButtons();
      }
      if (name === 'flat') {
        this.updateflatMode();
      }
    }

    updateButtons() {
      // Remove existing buttons first to avoid duplicates
      const vrButton = this.shadowRoot.querySelector('#VRButton');
      const flatButton = this.shadowRoot.querySelector('#flatModeButton');
      if (vrButton) vrButton.remove();
      if (flatButton) flatButton.remove();

      const controlslist = this.getAttribute('controlslist') || 'vr wiggle left right anaglyph';
      const availableFlatModes = ['left', 'right', 'wiggle', 'anaglyph'].filter(mode => controlslist.includes(mode));

      if (controlslist.includes('vr')) {
          this.shadowRoot.appendChild(VRButton.createButton(this.renderer));
      }

      // Only show the flatModeButton if there is more than one mode to cycle through.
      if (availableFlatModes.length > 1) {
          this.shadowRoot.appendChild(flatModeButton.createButton(this));
      }
    }


    constructor() {
      super();
      this.wiggleIntervalID = null; // Initialize the interval ID property
      this.init();
    }

  }

window.customElements.define('stereo-img', StereoImg);

