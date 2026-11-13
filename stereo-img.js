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

import exifr from './vendor/exifr/full.esm.js';

import * as THREE from './vendor/three/three.module.min.js';
import { VRButton } from './lib/VRButton.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { AnaglyphEffect } from './lib/AnaglyphEffect.js';
import { flatModeButton } from './lib/flatModeButton.js';
import { loadingHints } from './lib/https.js';
import { Picture } from './lib/picture.js';


/**
 * Read the metadata of a picture.
 * @param {Uint8Array} bytes - The content of the file.
 * @returns {Promise<Object>} - Its metadata, grouped by kind.
 */
function readMetadata(bytes) {
  return exifr.parse(bytes, {
    xmp: true,
    multiSegment: true,
    mergeOutput: false,
    ihdr: true, //unclear why we need this, but if not enabled, some VR180 XMP Data are not parsed
  });
}

/**
 * Tell if the metadata of a picture describes a depth map embedded in it.
 * @param {Object} exif - The metadata of the picture, as read by readMetadata.
 * @returns {boolean} - True for the two formats of Google Camera: "GDepth" and "Dynamic Depth".
 */
function describesDepthMap(exif) {
  if (exif?.GDepth?.Data) {
    return true;
  }
  // Dynamic Depth lists the images appended to the file.
  const items = [].concat(exif?.Container?.Directory || []).map(entry => entry?.Item || entry);
  return items.some(item => item?.Semantic === 'Depth' || /depthmap/i.test(item?.DataURI));
}

/**
 * Quickly tell if a file may be in the Multi-Picture Format, by looking for the name of its index ("MPF")
 * at the start of the file.
 * @param {Uint8Array} bytes - The content of the file.
 * @returns {boolean} - False if it is certainly not in that format.
 */
function mayHaveMultiPictureIndex(bytes) {
  const end = Math.min(bytes.length, 1 << 18) - 3;
  for (let i = 0; i < end; i++) {
    if (bytes[i] === 0x4d && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x46 && bytes[i + 3] === 0) {
      return true;
    }
  }
  return false;
}

// Distance between the viewer and the picture, in the 3D scene.
const PICTURE_DISTANCE = 10;
// Layers on which the pictures of each eye are drawn.
const LEFT_EYE_LAYER = 1;

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
  }

  get disparityAdjustment() {
    return this.getAttribute('disparity-adjustment');
  }
  set disparityAdjustment(val) {
    if (val || val === 0) {
      this.setAttribute('disparity-adjustment', val);
    } else {
      this.removeAttribute('disparity-adjustment');
    }
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
  }

  static get observedAttributes() {
    return ['type', 'angle', 'debug', 'projection', 'controlslist', 'flat', 'wiggle', 'src', 'src-right', 'disparity-adjustment'];
  }

  _scheduleRenderUpdate() {
    if (this._needsRenderUpdate) {
      return;
    }
    this._needsRenderUpdate = true;
    // Use a microtask to batch attribute changes.
    Promise.resolve().then(() => {
      this.parseImageAndInitialize3DScene();
      this._needsRenderUpdate = false;
    });
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue || !this.renderer) {
      return;
    }

    switch (name) {
      case 'src':
      case 'src-right':
      case 'type':
      case 'angle':
      case 'projection':
      case 'debug':
        this._scheduleRenderUpdate();
        break;
      case 'flat':
        this.updateflatMode();
        break;
      case 'controlslist':
        this.updateButtons();
        break;
      case 'disparity-adjustment':
        this.updateDisparityAdjustment();
        break;
    }
  }

  /**
   * Load an image.
   * @param {string} url - The URL of the image.
   * @param {AbortSignal} [signal] - Aborted when the image is not needed anymore.
   * @returns {Promise<HTMLImageElement>} - The loaded image.
   * @private
   */
  _loadImage(url, signal) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const onAbort = () => {
        // Stop downloading the image.
        img.onload = null;
        img.onerror = null;
        img.src = '';
        reject(signal.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      img.crossOrigin = "Anonymous";
      img.onload = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve(img);
      };
      img.onerror = (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      };
      img.src = url;
    });
  }

  /**
   * Checks if an image is stereoscopic
   * @param {string} imageUrl - The URL of the image to check.
   * @param {AbortSignal} [signal] - Aborted when the answer is not needed anymore.
   * @returns {Promise<boolean>} - True if the image is likely stereoscopic, false otherwise.
   * @private
   */
  async _isStereo(imageUrl, signal) {
    // Compare the left and right halves.
    // Renders the image to a small canvas and calculates the average pixel difference.
    const image = await this._loadImage(imageUrl, signal);

    const canvas = document.createElement('canvas');
    const width = 20;
    const height = 10;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height).data;

    let totalDiff = 0;
    const halfWidth = width / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < halfWidth; x++) {
        const leftIndex = (y * width + x) * 4;
        const rightIndex = (y * width + x + halfWidth) * 4;

        const r1 = imageData[leftIndex];
        const g1 = imageData[leftIndex + 1];
        const b1 = imageData[leftIndex + 2];

        const r2 = imageData[rightIndex];
        const g2 = imageData[rightIndex + 1];
        const b2 = imageData[rightIndex + 2];

        totalDiff += Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      }
    }

    const avgDiff = totalDiff / (halfWidth * height * 3);
    const threshold = 25;

    if (this.debug) {
      console.log(`Stereo difference: ${avgDiff}`);
    }

    return avgDiff < threshold;
  }

  animate() {
    this.renderer.setAnimationLoop(() => {
      if (this.loadingIndicator && this.loadingIndicator.visible) {
        this.loadingIndicator.rotation.y += 0.01;
        this.loadingIndicator.rotation.x += 0.01;
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  /**
   * Parse the picture described by the attributes of the element.
   * @param {AbortSignal} [signal] - Aborted when the picture is not needed anymore.
   * @returns {Promise<Object>} - The stereo data of the picture.
   * @private
   */
  async parse(signal) {
    // Read the attributes once: they can change while the picture is being parsed.
    const { src, srcRight, type, angle, projection } = this;

    if (!src) {
      // no src attribute. Use fake stereo data to render a black sphere
      return this._emptyStereoData();
    }

    // Each file is downloaded once, however many times it is read.
    const picture = new Picture(src, signal);
    const pictureRight = srcRight ? new Picture(srcRight, signal) : null;
    try {
      return await this._parsePicture(picture, pictureRight, { type, angle, projection, signal });
    } finally {
      picture.release();
      pictureRight?.release();
    }
  }

  /**
   * Parse a downloaded picture.
   * @param {Picture} picture - The picture of the "src" attribute.
   * @param {Picture} [pictureRight] - The picture of the "src-right" attribute, if any.
   * @param {Object} options - type, angle and projection attributes, and the signal to abort the parsing.
   * @returns {Promise<Object>} - The stereo data of the picture.
   * @private
   */
  async _parsePicture(picture, pictureRight, { type, angle, projection, signal }) {
    const src = picture.url;
    // Parsers read the downloaded file through this URL. They also get the URL the picture
    // comes from: its file name can tell which camera took it.
    const url = await picture.objectURL();
    const stereoOptions = { angle, projection, signal, originalUrl: src };

    if (type === 'vr180' || type === 'vr') {
      return this._parseVR(picture, signal);
    }

    if (['left-right', 'right-left', 'bottom-top', 'top-bottom', 'interlaced', 'interlaced-reverse', 'column-interlaced', 'column-interlaced-reverse'].includes(type)) {
      const { parseStereo } = await import('./parsers/stereo-parser/stereo-parser.js');
      return parseStereo(url, { ...stereoOptions, type });
    }

    if (type === 'anaglyph' || type?.startsWith('anaglyph-')) {
      const { parseAnaglyph } = await import('./parsers/anaglyph-parser/anaglyph-parser.js');
      // "anaglyph-red-cyan" names the colours of the picture, "anaglyph" lets the parser find them
      return parseAnaglyph(url, { colors: type.slice('anaglyph-'.length), angle, projection, signal });
    }

    if (type === 'depth') {
      const { parseDepth } = await import('./parsers/depth-parser/depth-parser.js');
      return parseDepth(url, { signal });
    }

    if (type === 'mono') {
      const { parseMono } = await import('./parsers/mono-parser/mono-parser.js');
      return parseMono(url, { angle, projection, signal });
    }

    if (type === 'lif') {
      const { parseLIF } = await import('./parsers/lif-parser/lif-parser.js');
      return parseLIF(url, { angle, projection, signal });
    }

    if (type === 'mpo') {
      const { parseMPO } = await import('./parsers/mpo-parser/mpo-parser.js');
      return parseMPO(url, { angle, projection, signal });
    }

    if (type === 'pair' || (!type && pictureRight)) {
      if (pictureRight) {
        const { parseStereoPair } = await import('./parsers/stereo-parser/stereo-parser.js');
        return parseStereoPair(url, await pictureRight.objectURL(), { ...stereoOptions, type: 'pair' });
      }
      console.error('<stereo-img> type "pair" is missing the "src-right" attribute for the right eye image.');
      const { parseStereo } = await import('./parsers/stereo-parser/stereo-parser.js');
      return parseStereo(url, stereoOptions);
    }

    // No type specified

    const bytes = await picture.bytes();

    // Multi-Picture Format: files of stereo cameras, usually ending with .mpo
    const isNamedMpo = /\.mpo$/i.test(src.split(/[?#]/)[0]);
    if (isNamedMpo || mayHaveMultiPictureIndex(bytes)) {
      const { parseMPO, readStereoPair } = await import('./parsers/mpo-parser/mpo-parser.js');
      // Regular pictures can use that format to hold previews: only use it for stereo pairs.
      if (isNamedMpo || readStereoPair(bytes).length === 2) {
        return parseMPO(url, { angle, projection, signal });
      }
    }

    // Leia Image Format: the file ends with a marker
    if (bytes[bytes.length - 2] === 0x1e && bytes[bytes.length - 1] === 0x1a) {
      const { parseLIF, readStereoPair } = await import('./parsers/lif-parser/lif-parser.js');
      if (readStereoPair(bytes)) {
        return parseLIF(url, { angle, projection, signal });
      }
    }

    // try to read XMP metadata to see if VR Photo, otherwise assume stereo-style (e.g. "left right")
    const exif = await readMetadata(bytes);
    signal?.throwIfAborted();

    if (describesDepthMap(exif)) {
      // Checked before VR Photos: a picture with a depth map can also hold a second image, the original picture.
      const { parseDepth } = await import('./parsers/depth-parser/depth-parser.js');
      return parseDepth(url, { signal, exif });
    }

    if (exif?.GImage?.Data) {
      // GImage XMP for left eye found, assume VR Photo
      return this._parseVR(picture, signal, exif);
    }

    // no left eye found, check if it is a stereo or mono image
    const isStereo = await this._isStereo(url, signal);

    if (isStereo) {
      console.info('<stereo-img> does not have a "type" attribute and image does not have XMP metadata of a VR picture. Use "type" attribute to specify the type of stereoscopic image. Image seems to be "left-right" stereo.');
      const { parseStereo } = await import('./parsers/stereo-parser/stereo-parser.js');
      return parseStereo(url, stereoOptions);
    }

    console.info('<stereo-img> does not have a "type" attribute and image does not have XMP metadata of a VR picture. Image does not seem to be stereoscopic. Displaying as mono.');
    const { parseMono } = await import('./parsers/mono-parser/mono-parser.js');
    return parseMono(url, { angle, projection, signal });
  }

  /**
   * Parse a VR Photo.
   * @param {Picture} picture - The picture.
   * @param {AbortSignal} [signal] - Aborted when the picture is not needed anymore.
   * @param {Object} [exif] - The metadata of the picture, when already read.
   * @returns {Promise<Object>} - The stereo data of the picture.
   * @private
   */
  async _parseVR(picture, signal, exif) {
    const { parseVR } = await import('./parsers/vr-parser/vr-parser.js');
    const url = await picture.objectURL();
    const stereoData = await parseVR(url, { signal, exif: exif || await readMetadata(await picture.bytes()) });
    if (stereoData.leftEye === url) {
      // The left eye is the picture itself: load it while the downloaded file is at hand.
      stereoData.leftEye = await this._loadImage(url, signal);
    }
    return stereoData;
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

    if (toggle) {
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
    const radius = PICTURE_DISTANCE;
    const depth = radius / 5;
    const planeSegments = this.stereoData.depth ? 256 : 1;
    const sphereWidthSegments = 60;
    const sphereHeightSegments = 40;

    const eyeNumber = eye === "left" ? 1 : 2;
    let imageData = eye === "left" ? this.stereoData.leftEye : this.stereoData.rightEye;

    if (typeof imageData === 'string') {
      const src = imageData;
      imageData = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
      });
    }

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
    if (this.stereoData.phiLength < Math.PI / 2) {
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
      if (this.stereoData.phiLength !== Math.PI || this.stereoData.thetaLength !== Math.PI) {
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
        uvs[i * 2 + 0] = z * 0.5 * correction + 0.5;
        uvs[i * 2 + 1] = y * 0.5 * correction + 0.5;
      }
    }

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      displacementScale: -1 * depth,
      displacementBias: depth / 2,
      flatShading: true,
    });
    if (this.stereoData.depth) {
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
    this.stereoImageGroup.add(mesh);

    if (this.debug) {
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
      this.stereoImageGroup.add(line);
    }
  }

  /**
   * Move the pictures of the two eyes horizontally, in opposite directions.
   *
   * The "disparity-adjustment" attribute is the distance to add between the two pictures,
   * in percent of the width of one of them. A negative value moves them closer together:
   * the left picture to the right and the right picture to the left. Each moves by half of the value.
   */
  updateDisparityAdjustment() {
    if (!this.stereoImageGroup || !this.stereoData) {
      return;
    }
    const adjustment = (parseFloat(this.getAttribute('disparity-adjustment')) || 0) / 100;
    // same rule as in createEye
    const isPlane = this.stereoData.phiLength < Math.PI / 2;

    for (const object of this.stereoImageGroup.children) {
      const isLeftEye = object.layers.isEnabled(LEFT_EYE_LAYER);
      // how far the picture of this eye moves to the right, as a fraction of its width
      const shift = (isLeftEye ? -1 : 1) * adjustment / 2;
      if (isPlane) {
        object.position.x = shift * PICTURE_DISTANCE * 2;
      } else {
        // a picture on a sphere moves by turning around the viewer
        object.rotation.y = Math.PI / 2 - shift * this.stereoData.phiLength;
      }
    }
  }

  async initialize3DScene() {
    if (this.stereoImageGroup) {
      this.scene.remove(this.stereoImageGroup);
      // Free the GPU memory used by the previous picture.
      this.stereoImageGroup.traverse(object => {
        object.geometry?.dispose();
        if (object.material) {
          object.material.map?.dispose();
          object.material.displacementMap?.dispose();
          object.material.dispose();
        }
      });
    }
    this.stereoImageGroup = new THREE.Group();
    this.scene.add(this.stereoImageGroup);

    this.scene.background = new THREE.Color(0x101010);

    await this.createEye("left");
    await this.createEye("right");

    this.updateDisparityAdjustment();

    this.updateflatMode();
  }

  updateflatMode() {
    if (!this.isConnected) {
      // Nothing to render while out of the document. connectedCallback calls this again.
      return;
    }

    const flatMode = this.getAttribute('flat');

    const animation = () => {
      if (this.loadingIndicator && this.loadingIndicator.visible) {
        this.loadingIndicator.rotation.y += 0.01;
        this.loadingIndicator.rotation.x += 0.01;
      }

      if (flatMode === 'wiggle') {
        this.renderer.render(this.scene, this.camera);
      } else if (flatMode === 'right') {
        this.camera.layers.set(2);
        this.renderer.render(this.scene, this.camera);
      } else if (flatMode === 'anaglyph') {
        this.anaglyphEffect.render(this.scene, this.camera);
      } else { // 'left' is the default
        this.camera.layers.set(1);
        this.renderer.render(this.scene, this.camera);
      }
    };

    if (flatMode === 'wiggle') {
      this.toggleWiggle(true);
    } else {
      this.toggleWiggle(false);
    }
    this.renderer.setAnimationLoop(animation);
  }

  /**
   * Parse the picture described by the attributes and display it.
   * Only the latest call counts: it cancels the load in progress, if any.
   */
  async parseImageAndInitialize3DScene() {
    this._loadController?.abort();
    const controller = new AbortController();
    this._loadController = controller;
    const { signal } = controller;

    if (this.loadingIndicator) {
      this.loadingIndicator.visible = true;
    }

    try {
      let stereoData;
      try {
        stereoData = await this.parse(signal);
        if (!stereoData?.leftEye || !stereoData?.rightEye) {
          throw new Error(stereoData?.error || 'No image found for the left and right eyes.');
        }
      } catch (error) {
        if (signal.aborted) {
          // Cancelled: a more recent load is in charge.
          return;
        }
        console.error(`<stereo-img> could not display "${this.src}".${loadingHints(this.src, location.href)}`, error);
        // Do not keep displaying the previous picture.
        stereoData = this._emptyStereoData();
      }
      await this._display(stereoData, signal);
    } finally {
      if (this._loadController === controller) {
        this._loadController = null;
        if (this.loadingIndicator) {
          this.loadingIndicator.visible = false;
        }
      }
    }
  }

  /**
   * Display stereo data, unless the load it comes from has been cancelled.
   * Scenes are built one at a time: building one is asynchronous and relies on the state of the element.
   */
  async _display(stereoData, signal) {
    const previous = this._displaying;
    const display = (async () => {
      await previous;
      if (signal.aborted) {
        return;
      }
      try {
        this.stereoData = stereoData;
        await this.initialize3DScene();
      } catch (error) {
        if (signal.aborted) {
          // The more recent load replaces this scene.
          return;
        }
        console.error(`<stereo-img> could not display "${this.src}".${loadingHints(this.src, location.href)}`, error);
        try {
          this.stereoData = this._emptyStereoData();
          await this.initialize3DScene();
        } catch (e) {
          // Nothing more can be done.
        }
      }
    })();
    this._displaying = display;
    await display;
  }

  /**
   * Stereo data rendering an empty scene.
   */
  _emptyStereoData() {
    return {
      leftEye: new ImageData(10, 10),
      rightEye: new ImageData(10, 10),
      phiLength: 0,
      thetaStart: 0,
      thetaLength: 0
    };
  }

  setupLoadingIndicator() {
    const loaderGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const loaderMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
    this.loadingIndicator = new THREE.Mesh(loaderGeometry, loaderMaterial);
    this.loadingIndicator.position.set(0, 0, -1);
    this.loadingIndicator.visible = false;
    this.loadingIndicator.layers.enable(1);
    this.loadingIndicator.layers.enable(2);
    this.scene.add(this.loadingIndicator);
  }

  async init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    if (this.debug) {
      console.log('Debug mode enabled');
      this.debug = true;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          contain: content;
        }
        #flatModeButton:hover {
          opacity: 1.0 !important;
        }
      </style>
      `;

    // TODO: should we also read width and height attributes and resize element accordingly?
    if (this.clientHeight === 0) {
      const aspectRatio = 4 / 3;
      this.style.height = this.clientWidth / aspectRatio + "px";
    }

    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.xr.enabled = true;
    this.renderer.setSize(this.clientWidth, this.clientHeight);
    this.shadowRoot.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.setupLoadingIndicator();

    const light = new THREE.AmbientLight(0xffffff, 3);
    light.layers.enable(1);
    light.layers.enable(2);
    this.scene.add(light);

    this.anaglyphEffect = new AnaglyphEffect(this.renderer);
    this.anaglyphEffect.setSize(this.clientWidth, this.clientHeight);

    if (this.debug) {
      console.log(`Max Texture Size: ${this.renderer.capabilities.maxTextureSize}`);
    }

    // TODO: Should we use component size instead?
    this.camera = new THREE.PerspectiveCamera(70, this.clientWidth / this.clientHeight, 1, 2000);
    this.camera.layers.enable(1);

    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.camera.position.set(0, 0, 0.1);
    controls.update();

    this.updateButtons();

    // Listen for component resize
    this._resizeObserver = new ResizeObserver(() => {
      this.renderer.setSize(this.clientWidth, this.clientHeight);
      this.camera.aspect = this.clientWidth / this.clientHeight;
      this.camera.updateProjectionMatrix();
      this.anaglyphEffect.setSize(this.clientWidth, this.clientHeight);
    });

    this._resizeObserver.observe(this);

    await this.parseImageAndInitialize3DScene();
  }

  updateButtons() {
    // Remove existing buttons first to avoid duplicates
    const vrButton = this.shadowRoot.querySelector('#VRButton');
    const flatButton = this.shadowRoot.querySelector('#flatModeButton');
    if (vrButton) vrButton.remove();
    if (flatButton) flatButton.remove();

    // Space-separated list of tokens, compared as whole words.
    const controlslist = (this.getAttribute('controlslist') || 'vr wiggle left right anaglyph').toLowerCase().split(/\s+/);
    const availableFlatModes = ['left', 'right', 'wiggle', 'anaglyph'].filter(mode => controlslist.includes(mode));

    if (controlslist.includes('vr')) {
      this.shadowRoot.appendChild(VRButton.createButton(this.renderer));
    }

    // Only show the flatModeButton if there is more than one mode to cycle through.
    if (availableFlatModes.length > 1) {
      this.shadowRoot.appendChild(flatModeButton.createButton(this));
    }
  }


  connectedCallback() {
    if (this._initialized) {
      // Back in the document (for example after being moved): resume what disconnectedCallback paused.
      this._resizeObserver.observe(this);
      this.updateflatMode();
      return;
    }
    this.init();
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    if (this.wiggleIntervalID) {
      clearInterval(this.wiggleIntervalID);
      this.wiggleIntervalID = null;
    }
    if (this.renderer) {
      // Stop rendering, so that a removed element does not keep drawing frames forever.
      this.renderer.setAnimationLoop(null);
    }
  }

  constructor() {
    super();
    this.wiggleIntervalID = null; // Initialize the interval ID property
    this._needsRenderUpdate = false;
    this.stereoImageGroup = null;
    this._initialized = false;
    this.attachShadow({ mode: 'open' });
  }

}

window.customElements.define('stereo-img', StereoImg);

