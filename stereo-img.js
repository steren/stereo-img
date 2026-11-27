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

import * as THREE from './vendor/three/three.module.js';
import { VRButton } from './lib/VRButton.js';
import { LookControls } from './lib/LookControls.js';
import { AnaglyphEffect } from './lib/AnaglyphEffect.js';
import { flatModeButton } from './lib/flatModeButton.js';
import { soundButton } from './lib/soundButton.js';
import { loadingHints } from './lib/https.js';
import { Picture } from './lib/picture.js';
import { edgeColors } from './lib/edgeColors.js';
import { tilePadding, planTiles, pickTriangles, tileUvs, cropPixels } from './lib/tiles.js';
import { directionOfSelect, directionOfThumbstick } from './lib/xrInput.js';


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
 * Tell if a ray hits the picture drawn by a mesh of the scene.
 * @param {THREE.Mesh} mesh - The mesh of an eye: a plane, or a part of a sphere seen from inside.
 * @param {THREE.Vector3} origin - Where the ray starts, in the scene.
 * @param {THREE.Vector3} direction - Where the ray goes, in the scene.
 * @returns {boolean} - True if the ray ends on the picture.
 */
function rayHitsPicture(mesh, origin, direction) {
  // Work in the space of the mesh, where the picture is centred on the X axis.
  const inverse = mesh.matrixWorld.clone().invert();
  const from = origin.clone().applyMatrix4(inverse);
  const along = direction.clone().transformDirection(inverse);
  const parameters = mesh.geometry.parameters;
  // a small tolerance, so that a view that exactly fits is accepted
  const epsilon = 1e-6;

  if (mesh.geometry.type === 'PlaneGeometry') {
    // A plane facing the viewer, at a distance on the X axis
    if (along.x <= 0) {
      return false;
    }
    // With a depth map, parts of the picture are pushed away from the viewer, where they look smaller: count on the farthest.
    const material = mesh.material;
    const relief = material.displacementMap ? Math.max(Math.abs(material.displacementBias), Math.abs(material.displacementScale + material.displacementBias)) : 0;
    const distance = (PICTURE_DISTANCE + relief - from.x) / along.x;
    const y = from.y + distance * along.y;
    const z = from.z + distance * along.z;
    return Math.abs(y) <= parameters.height / 2 * (1 + epsilon) && Math.abs(z) <= parameters.width / 2 * (1 + epsilon);
  }

  // A part of a sphere around the viewer: angles around the vertical axis and from the top
  const phi = Math.atan2(along.z, along.x);
  const theta = Math.acos(Math.max(-1, Math.min(1, along.y)));
  const insideHorizontally = parameters.phiLength >= 2 * Math.PI - epsilon || Math.abs(phi) <= parameters.phiLength / 2 + epsilon;
  const insideVertically = theta >= parameters.thetaStart - epsilon && theta <= parameters.thetaStart + parameters.thetaLength + epsilon;
  return insideHorizontally && insideVertically;
}

/**
 * Tell if the metadata or byte contents of a picture describes a depth map embedded in it.
 * @param {Object} exif - The metadata of the picture, as read by readMetadata.
 * @param {Uint8Array} [bytes] - The content of the file, to check for MPF disparity.
 * @returns {Promise<boolean>} - True for Google Camera ("GDepth" / "Dynamic Depth") or Apple MPF Disparity.
 */
async function describesDepthMap(exif, bytes) {
  if (exif?.GDepth?.Data) {
    return true;
  }
  // Dynamic Depth lists the images appended to the file.
  const items = [].concat(exif?.Container?.Directory || []).map(entry => entry?.Item || entry);
  if (items.some(item => item?.Semantic === 'Depth' || /depthmap/i.test(item?.DataURI))) {
    return true;
  }
  if (bytes && mayHaveMultiPictureIndex(bytes)) {
    const { readMpoDisparity } = await import('./parsers/mpo-parser/mpo-parser.js');
    return Boolean(readMpoDisparity(bytes));
  }
  return false;
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

/**
 * Quickly tell if a file is in the AVIF format, by checking its "ftyp" major and compatible brands for "avif" or "avis".
 * @param {Uint8Array} bytes - The content of the file.
 * @returns {boolean}
 */
function isAvif(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) {
    return false;
  }
  if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) !== 'ftyp') {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = view.getUint32(0);
  let header = 8;
  if (size === 1) {
    if (bytes.length < 24) {
      return false;
    }
    const bigSize = view.getBigUint64(8);
    if (bigSize > BigInt(Number.MAX_SAFE_INTEGER)) {
      return false;
    }
    size = Number(bigSize);
    header = 16;
  } else if (size === 0) {
    size = bytes.length;
  }
  if (size < header + 8 || size > bytes.length || (size - header - 8) % 4 !== 0) {
    return false;
  }
  const major = String.fromCharCode(bytes[header], bytes[header + 1], bytes[header + 2], bytes[header + 3]);
  if (major === 'avif' || major === 'avis') {
    return true;
  }
  for (let pos = header + 8; pos + 4 <= size; pos += 4) {
    const brand = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    if (brand === 'avif' || brand === 'avis') {
      return true;
    }
  }
  return false;
}

/**
 * Quickly tell if a file is in the HEIF format (as HEIC pictures), from the type of its first box.
 * @param {Uint8Array} bytes - The content of the file.
 * @returns {boolean}
 */
function isHeif(bytes) {
  return bytes.length >= 12 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp';
}

/**
 * Quickly tell if a JPEG file may have a JPS marker (APP3 "_JPSJPS_").
 * Scans JPEG marker segments before SOS (0xFFDA) within the first 64 KB.
 * @param {Uint8Array} bytes - The content of the file.
 * @returns {boolean}
 */
function mayHaveJpsMarker(bytes) {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return false;
  }
  let position = 2;
  const maxScan = Math.min(bytes.length, 1 << 16);
  while (position + 4 <= maxScan && bytes[position] === 0xff) {
    const marker = bytes[position + 1];
    if (marker === 0xda) break; // SOS
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      position += 2;
      continue;
    }
    const length = (bytes[position + 2] << 8) | bytes[position + 3];
    if (length < 2) break;
    if (marker === 0xe3 && position + 12 <= bytes.length) { // APP3
      if (
        bytes[position + 4] === 0x5f && // '_'
        bytes[position + 5] === 0x4a && // 'J'
        bytes[position + 6] === 0x50 && // 'P'
        bytes[position + 7] === 0x53 && // 'S'
        bytes[position + 8] === 0x4a && // 'J'
        bytes[position + 9] === 0x50 && // 'P'
        bytes[position + 10] === 0x53 && // 'S'
        bytes[position + 11] === 0x5f    // '_'
      ) {
        return true;
      }
    }
    position += 2 + length;
  }
  return false;
}

/**
 * Quickly tell if a PNG file has an sTER chunk before IDAT.
 * @param {Uint8Array} bytes - The content of the file.
 * @returns {boolean}
 */
function hasSterChunk(bytes) {
  if (
    !bytes ||
    bytes.length < 33 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return false;
  }
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false);
    if (offset + 8 + length + 4 > bytes.length) {
      break;
    }
    // 'sTER' = 0x73, 0x54, 0x45, 0x52
    if (
      bytes[offset + 4] === 0x73 &&
      bytes[offset + 5] === 0x54 &&
      bytes[offset + 6] === 0x45 &&
      bytes[offset + 7] === 0x52
    ) {
      return true;
    }
    // 'IDAT' = 0x49, 0x44, 0x41, 0x54
    if (
      bytes[offset + 4] === 0x49 &&
      bytes[offset + 5] === 0x44 &&
      bytes[offset + 6] === 0x41 &&
      bytes[offset + 7] === 0x54
    ) {
      break;
    }
    offset += 8 + length + 4;
  }
  return false;
}

/**
 * Quickly tell if raw bytes represent an animated wigglegram container
 * (multi-frame GIF with >= 2 image descriptors, WebP with >= 2 ANMF chunks,
 * or APNG with acTL.numFrames >= 2). Static 1-frame GIFs, WebPs, and PNGs return false.
 * @param {Uint8Array} bytes - The content of the file.
 * @returns {boolean}
 */
function mayBeAnimatedWigglegram(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) {
    return false;
  }

  // GIF87a / GIF89a: walk blocks cleanly to count 0x2C image descriptors
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    if (bytes.length < 13) return false;
    const screenWidth = bytes[6] | (bytes[7] << 8);
    const screenHeight = bytes[8] | (bytes[9] << 8);
    if (screenWidth === 0 || screenHeight === 0) return false;
    let pos = 13;
    if (bytes[10] & 0x80) {
      const gctBytes = 3 * (1 << ((bytes[10] & 0x07) + 1));
      if (pos + gctBytes > bytes.length) return false;
      pos += gctBytes;
    }
    let imageCount = 0;
    while (pos < bytes.length) {
      const introducer = bytes[pos++];
      if (introducer === 0x3b) break;
      if (introducer === 0x21) {
        if (pos >= bytes.length) break;
        const label = bytes[pos++];
        if (label !== 0xfe) {
          if (pos >= bytes.length) break;
          const blockSize = bytes[pos++];
          if (pos + blockSize > bytes.length) break;
          pos += blockSize;
        }
        while (pos < bytes.length) {
          const subLen = bytes[pos++];
          if (subLen === 0) break;
          if (pos + subLen > bytes.length) {
            pos = bytes.length;
            break;
          }
          pos += subLen;
        }
      } else if (introducer === 0x2c) {
        if (pos + 9 > bytes.length) break;
        imageCount++;
        if (imageCount >= 2) return true;
        const packed = bytes[pos + 8];
        pos += 9;
        if (packed & 0x80) {
          const lctBytes = 3 * (1 << ((packed & 0x07) + 1));
          if (pos + lctBytes > bytes.length) break;
          pos += lctBytes;
        }
        if (pos >= bytes.length) break;
        pos++;
        while (pos < bytes.length) {
          const subLen = bytes[pos++];
          if (subLen === 0) break;
          if (pos + subLen > bytes.length) {
            pos = bytes.length;
            break;
          }
          pos += subLen;
        }
      } else {
        break;
      }
    }
    return false;
  }

  // RIFF....WEBP: check for >= 2 ANMF chunks (aligned with isAnimatedWigglegram)
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let anmfCount = 0;
    while (offset + 8 <= bytes.length) {
      const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      const size = view.getUint32(offset + 4, true);
      const dataStart = offset + 8;
      if (dataStart + size > bytes.length) break;
      if (id === 'ANMF' && size >= 16) {
        anmfCount++;
        if (anmfCount >= 2) return true;
      }
      offset = dataStart + size + (size & 1);
    }
    return false;
  }

  // PNG: check acTL chunk before IDAT with num_frames >= 2
  if (
    bytes.length >= 33 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset, false);
      if (offset + 12 + length > bytes.length) break;
      const c0 = bytes[offset + 4];
      const c1 = bytes[offset + 5];
      const c2 = bytes[offset + 6];
      const c3 = bytes[offset + 7];
      // 'acTL'
      if (c0 === 0x61 && c1 === 0x63 && c2 === 0x54 && c3 === 0x4c) {
        return length >= 8 && view.getUint32(offset + 8, false) >= 2;
      }
      // 'IDAT' or 'IEND'
      if ((c0 === 0x49 && c1 === 0x44 && c2 === 0x41 && c3 === 0x54) ||
          (c0 === 0x49 && c1 === 0x45 && c2 === 0x4e && c3 === 0x44)) {
        break;
      }
      offset += 12 + length;
    }
  }

  return false;
}

/**
 * Tell from the name of a file if it is a side by side, or top and bottom, picture whose views are squeezed
 * to half of their size: "HSBS" or "half-SBS", "HOU", "HTAB" or "half-OU" in the name.
 * @param {string} src - The URL of the picture.
 * @returns {string|undefined} - 'half-left-right', 'half-top-bottom' or undefined.
 */
function halfTypeOfName(src) {
  let name = src.split(/[?#]/)[0].split('/').pop() || '';
  try {
    name = decodeURIComponent(name);
  } catch (e) {
    // keep it encoded
  }
  // the words of the name, split on anything but letters and digits, with "half" joined to the next one
  const words = name.toLowerCase().replace(/half[^a-z0-9]*/g, 'h').split(/[^a-z0-9]+/);
  if (words.includes('hsbs')) {
    return 'half-left-right';
  }
  if (words.some(word => ['hou', 'htab', 'htb'].includes(word))) {
    return 'half-top-bottom';
  }
}

// Types of the pictures read by the stereo parser.
const STEREO_TYPES = ['left-right', 'right-left', 'bottom-top', 'top-bottom', 'interlaced', 'interlaced-reverse', 'column-interlaced', 'column-interlaced-reverse',
  'half-left-right', 'half-right-left', 'half-top-bottom', 'half-bottom-top'];

// Types of the pictures read by the RGB-D parser (composite color + depth map).
const RGBD_TYPES = ['rgbd', 'rgbd-sbs', 'rgbd-left-right', 'rgbd-right-left', 'rgbd-top-bottom', 'rgbd-ou', 'rgbd-tb', 'rgbd-bottom-top'];

// Types of the pictures read by the animated wigglegram parser.
const WIGGLE_TYPES = ['wiggle', 'wigglegram', 'wiggle-left-right', 'wiggle-right-left'];

/**
 * Tell from the name of a file if it is an RGB-D composite picture (color + depth map).
 * Requires an explicit RGB-D token ("rgbd", "rgb-d", "color-depth", "rgb-depth") so generic
 * stereo names like "foo_tb_bar.jpg" or "walrus-360.top-bottom.jpg" are not misclassified.
 * @param {string} src - The URL of the picture.
 * @returns {string|undefined} - One of RGBD_TYPES, or undefined.
 */
function rgbdTypeOfName(src) {
  if (typeof src !== 'string' || /^\s*(?:data|blob):/i.test(src)) {
    return;
  }
  let name = src.split(/[?#]/)[0].split('/').pop() || '';
  try {
    name = decodeURIComponent(name);
  } catch (e) {
    // keep it encoded
  }
  const lower = name.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const hasRgbdMarker =
    words.includes('rgbd') ||
    /(?:^|[^a-z0-9])rgb(?:\s+|[-_])?d(?:[^a-z0-9]|$)/.test(lower) ||
    /(?:^|[^a-z0-9])(?:color|rgb)(?:\s+|[-_])?depth(?:[^a-z0-9]|$)/.test(lower);
  if (!hasRgbdMarker) {
    return;
  }
  if (/(?:^|[^a-z0-9])bottom(?:\s+|[-_])?top(?:[^a-z0-9]|$)/.test(lower) || words.includes('bt')) {
    return 'rgbd-bottom-top';
  }
  if (/(?:^|[^a-z0-9])top(?:\s+|[-_])?bottom(?:[^a-z0-9]|$)/.test(lower) || words.includes('tb') || words.includes('ou')) {
    return 'rgbd-top-bottom';
  }
  if (/(?:^|[^a-z0-9])right(?:\s+|[-_])?left(?:[^a-z0-9]|$)/.test(lower) || words.includes('rl')) {
    return 'rgbd-right-left';
  }
  if (/(?:^|[^a-z0-9])left(?:\s+|[-_])?right(?:[^a-z0-9]|$)/.test(lower) || words.includes('sbs') || words.includes('lr')) {
    return 'rgbd-left-right';
  }
  return 'rgbd';
}

const QUILT_DESCRIPTOR_REGEX = /_qs(\d+)x(\d+)a(\d+(?:\.\d+)?|\.\d+)(?=(?:\.[a-z][a-z0-9]*)+$|[^a-z0-9.]|$)/i;

/**
 * Tell from the name of a file if it is a Looking Glass Quilt ("_qs<Cols>x<Rows>a<Aspect>").
 * @param {string} src - The URL of the picture.
 * @returns {{ cols: number, rows: number, aspect: number, totalViews: number }|undefined}
 */
function quiltDescriptorOfName(src) {
  if (typeof src !== 'string' || /^\s*(?:data|blob):/i.test(src)) {
    return;
  }
  let name = src.split(/[?#]/)[0].split(/[/\\]/).pop() || '';
  try {
    name = decodeURIComponent(name);
  } catch (e) {
    // keep it encoded
  }
  name = name.split(/[/\\]/).pop() || '';
  const match = name.match(QUILT_DESCRIPTOR_REGEX);
  if (!match) {
    return;
  }
  const cols = Number.parseInt(match[1], 10);
  const rows = Number.parseInt(match[2], 10);
  const aspect = Number.parseFloat(match[3]);
  const totalViews = cols * rows;
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1 || !Number.isSafeInteger(totalViews) || !Number.isFinite(aspect) || aspect <= 0) {
    return;
  }
  return { cols, rows, aspect, totalViews };
}

// Distance between the viewer and the picture, in the 3D scene.
const PICTURE_DISTANCE = 10;
// How many elements that start on interaction can be started at the same time on a page: the others show a still.
// Browsers limit the WebGL contexts of a page, to 16 in Chrome on a computer and 8 on a phone.
const MOST_STARTED = 4;
// What a viewer does to start an element that starts on interaction: point at it, press on it, touch it.
const START_EVENTS = ['pointerenter', 'pointerdown', 'touchstart'];
// The styles of the element, started or not.
const HOST_STYLE = `
      <style>
        :host {
          display: block;
          contain: content;
          background: #101010;
        }
        #flatModeButton:hover {
          opacity: 1.0 !important;
        }
        /* The buttons, over the picture. Its width decides where they go, so that they never overlap. */
        #controls {
          position: absolute;
          inset: 0;
          z-index: 999;
          pointer-events: none;
          container-type: inline-size;
        }
        #controls > * {
          pointer-events: auto;
        }
        /* Too narrow for the VR button between the sound and flat mode buttons: put it above them. */
        @container (max-width: 480px) {
          #VRButton {
            bottom: 70px !important;
          }
        }
        .still {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          pointer-events: none;
        }
        #loading {
          position: absolute;
          inset: 0;
          z-index: 998;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          opacity: 0;
          background: rgba(16, 16, 16, 0.42);
          backdrop-filter: blur(3px);
          -webkit-backdrop-filter: blur(3px);
          transition: opacity 200ms ease;
        }
        #loading.initial {
          background: linear-gradient(110deg, #141414 30%, #222222 45%, #222222 55%, #141414 70%);
          background-size: 250% 100%;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          animation: stereo-img-shimmer 1.6s ease-in-out infinite;
        }
        #loading.visible {
          opacity: 1;
          transition: opacity 180ms ease 120ms;
        }
        #loading.initial.visible {
          transition: opacity 120ms ease;
        }
        #loading svg {
          width: 44px;
          height: 44px;
          filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.45));
        }
        #loading .track {
          fill: none;
          stroke: rgba(255, 255, 255, 0.22);
          stroke-width: 3;
        }
        #loading .arc {
          fill: none;
          stroke: rgba(255, 255, 255, 0.92);
          stroke-width: 3;
          stroke-linecap: round;
          transform-origin: 24px 24px;
          transform: rotate(-90deg);
          transition: stroke-dashoffset 120ms linear;
        }
        #loading.indeterminate .arc {
          stroke-dasharray: 44 100;
          stroke-dashoffset: 0;
          animation: stereo-img-spin 0.9s linear infinite;
        }
        @keyframes stereo-img-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes stereo-img-shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        #error {
          position: absolute;
          inset: 0;
          z-index: 997;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 16px;
          text-align: center;
          color: rgba(255, 255, 255, 0.78);
          font: 14px/1.4 system-ui, -apple-system, sans-serif;
          pointer-events: none;
          opacity: 0;
          transition: opacity 200ms ease;
        }
        #error.visible {
          opacity: 1;
        }
        #error svg {
          width: 28px;
          height: 28px;
          stroke: rgba(255, 255, 255, 0.65);
          fill: none;
          stroke-width: 1.75;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        @media (prefers-reduced-motion: reduce) {
          #loading.initial {
            animation: none;
          }
          #loading.indeterminate .arc {
            animation-duration: 2.4s;
          }
        }
      </style>
      `;
// Circumference of the loading progress ring (r = 18).
const LOADING_RING_CIRCUMFERENCE = 2 * Math.PI * 18;
// The attributes that change what a still shows.
const STILL_ATTRIBUTES = ['src', 'src-right', 'type', 'angle', 'projection', 'flat', 'disparity-adjustment'];
// How far in front of the viewer the sign that a picture is loading is.
const LOADING_INDICATOR_DISTANCE = 1;
// What surrounds the picture is drawn on a sphere this far from the viewer.
const SURROUNDINGS_RADIUS = 1000;
// What surrounds the picture takes the colours of its edges, dimmed to leave the picture in front.
const SURROUNDINGS_BRIGHTNESS = 0.5;
// The colour of the surroundings is never darker than this, on a scale of 255.
const SURROUNDINGS_DARKEST = 16;
// Vertical field of view of the camera outside of VR, in degrees.
const DEFAULT_FOV = 70;
// Layers on which the pictures of each eye are drawn.
const LEFT_EYE_LAYER = 1;

/** The elements that started on interaction and are started, the most recently used last. */
const startedOnInteraction = [];

/** A hidden element that draws the stills of the elements that are not started: one WebGL context for all of them. */
let stillDrawer = null;

/** The stills are drawn one at a time. */
let stillQueue = Promise.resolve();

/**
 * The hidden element that draws stills. Made when the first still is needed, and again if the browser took its GPU away.
 * @returns {StereoImg}
 */
function getStillDrawer() {
  if (stillDrawer && !stillDrawer.renderer?.getContext().isContextLost()) {
    return stillDrawer;
  }
  if (stillDrawer) {
    const host = stillDrawer.getRootNode().host;
    stillDrawer._teardown();
    host?.remove();
  }
  // Out of the page: not seen, and in a shadow tree, where the styles and the scripts of the page do not find it.
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;';
  stillDrawer = document.createElement('stereo-img');
  stillDrawer._drawsOnDemand = true;
  stillDrawer.setAttribute('controlslist', 'none');
  stillDrawer.style.cssText = 'position:absolute;left:0;top:0;';
  host.attachShadow({ mode: 'open' }).appendChild(stillDrawer);
  return stillDrawer;
}

/**
 * Draw the stills of an element that is not started: what it would show if it was.
 * @param {StereoImg} element - The element.
 * @param {number} job - Which of the requests of the element this is: only its latest counts.
 * @returns {Promise<Array<HTMLCanvasElement>|null>} - One still, or one per eye for an element that wiggles. Null if they are not needed anymore.
 */
function drawStills(element, job) {
  const drawing = stillQueue.then(async () => {
    const isNeeded = () => element.isConnected && element._preview?.job === job;
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (!isNeeded() || width === 0 || height === 0) {
      return null;
    }

    const drawer = getStillDrawer();
    drawer.style.width = `${width}px`;
    drawer.style.height = `${height}px`;
    for (const name of STILL_ATTRIBUTES) {
      if (element.hasAttribute(name)) {
        drawer.setAttribute(name, element.getAttribute(name));
      } else {
        drawer.removeAttribute(name);
      }
    }

    const host = drawer.getRootNode().host;
    if (!host.isConnected) {
      // its first picture: the element starts, and loads it
      document.body.appendChild(host);
      await drawer._started;
    } else {
      drawer._resize();
      await drawer.parseImageAndInitialize3DScene();
    }

    try {
      return isNeeded() ? drawer._captureFrames() : null;
    } finally {
      // keep nothing of the picture until the next still
      await drawer._display(drawer._emptyStereoData(), new AbortController().signal);
    }
  });
  stillQueue = drawing.catch(() => {});
  return drawing;
}

/**
 * Note that an element that starts on interaction is being used, and stop the ones used the longest ago if too many are started.
 * @param {StereoImg} element - The element.
 */
function noteUse(element) {
  const index = startedOnInteraction.indexOf(element);
  if (index >= 0) {
    startedOnInteraction.splice(index, 1);
  }
  startedOnInteraction.push(element);

  let extra = startedOnInteraction.length - MOST_STARTED;
  for (const candidate of [...startedOnInteraction]) {
    if (extra <= 0) {
      break;
    }
    // not the one being used, and not one that someone is in, in VR
    if (candidate !== element && !candidate.renderer?.xr.isPresenting) {
      candidate._stopAndShowPreview(true);
      extra--;
    }
  }
}

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

class StereoImg extends BaseElement {

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

  /**
   * When 3D starts: "interaction" to show a still until the viewer points at the element or touches it.
   * Read when the element is added to the page.
   */
  get start() {
    return this.getAttribute('start');
  }
  set start(val) {
    if (val) {
      this.setAttribute('start', val);
    } else {
      this.removeAttribute('start');
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

  get muted() {
    return this.hasAttribute('muted');
  }
  set muted(val) {
    if (val) {
      this.setAttribute('muted', '');
    } else {
      this.removeAttribute('muted');
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
    return ['type', 'angle', 'debug', 'projection', 'controlslist', 'flat', 'wiggle', 'src', 'src-right', 'disparity-adjustment', 'width', 'height'];
  }

  /**
   * Size the element from its "width" and "height" attributes, in CSS pixels, like an <img>:
   * with both, the element also keeps their aspect ratio when CSS sets only one of its dimensions.
   * The rule is in the shadow tree, so the CSS of the page still wins over it.
   * @private
   */
  _applySizeAttributes() {
    const dimension = (name) => {
      const value = parseFloat(this.getAttribute(name));
      return Number.isFinite(value) && value >= 0 ? value : null;
    };
    const width = dimension('width');
    const height = dimension('height');
    const declarations = [];
    if (width !== null) {
      declarations.push(`width: ${width}px;`);
    }
    if (height !== null) {
      declarations.push(`height: ${height}px;`);
    }
    if (width && height) {
      declarations.push(`aspect-ratio: auto ${width} / ${height};`);
    }
    this._sizeSheet.replaceSync(declarations.length ? `:host { ${declarations.join(' ')} }` : '');
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
    if (oldValue === newValue) {
      return;
    }
    if (name === 'width' || name === 'height') {
      // The resize observers draw again at the new size.
      this._applySizeAttributes();
      return;
    }
    if (this._preview) {
      // not started: draw the stills again, once for all the attributes changed together
      if (STILL_ATTRIBUTES.includes(name) && !this._previewUpdate) {
        this._previewUpdate = Promise.resolve().then(() => {
          this._previewUpdate = null;
          this._drawPreview();
        });
      }
      return;
    }
    // The element that draws stills loads when it is told to.
    if (!this.renderer || this._drawsOnDemand) {
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
        reject(err instanceof Error ? err : new Error(`Failed to load image: ${url}`));
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
    let leftLoaded = 0;
    let leftTotal = 0;
    let rightLoaded = 0;
    let rightTotal = 0;
    const reportProgress = () => {
      if (signal?.aborted) {
        return;
      }
      const total = leftTotal + rightTotal;
      if (total > 0) {
        this._setLoadingProgress(leftLoaded + rightLoaded, total);
      }
    };
    const picture = new Picture(src, signal, (loaded, total) => {
      leftLoaded = loaded;
      leftTotal = total;
      reportProgress();
    });
    const pictureRight = srcRight ? new Picture(srcRight, signal, (loaded, total) => {
      rightLoaded = loaded;
      rightTotal = total;
      reportProgress();
    }) : null;
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

    if (STEREO_TYPES.includes(type)) {
      const { parseStereo } = await import('./parsers/stereo-parser/stereo-parser.js');
      return parseStereo(url, { ...stereoOptions, type });
    }

    if (RGBD_TYPES.includes(type)) {
      const { parseRGBD } = await import('./parsers/rgbd-parser/rgbd-parser.js');
      return parseRGBD(url, { ...stereoOptions, type, bytes: await picture.bytes() });
    }

    if (type === 'anaglyph' || type?.startsWith('anaglyph-')) {
      const { parseAnaglyph } = await import('./parsers/anaglyph-parser/anaglyph-parser.js');
      // "anaglyph-red-cyan" names the colours of the picture, "anaglyph" lets the parser find them
      return parseAnaglyph(url, { colors: type.slice('anaglyph-'.length), angle, projection, signal });
    }

    if (type === 'depth') {
      const { parseDepth } = await import('./parsers/depth-parser/depth-parser.js');
      return parseDepth(url, { signal, bytes: await picture.bytes() });
    }

    if (type === 'mono') {
      const { parseMono } = await import('./parsers/mono-parser/mono-parser.js');
      return parseMono(url, { angle, projection, signal });
    }

    if (type === 'lif') {
      const { parseLIF } = await import('./parsers/lif-parser/lif-parser.js');
      return parseLIF(url, { angle, projection, signal });
    }

    if (type === 'heic') {
      const { parseHEIC } = await import('./parsers/heic-parser/heic-parser.js');
      return parseHEIC(url, { angle, projection, signal });
    }

    if (type === 'avif' || type === 'avif-spatial') {
      const { parseAVIFStereo } = await import('./parsers/avif-parser/avif-parser.js');
      return parseAVIFStereo(url, { ...stereoOptions, bytes: await picture.bytes() });
    }

    if (type === 'mpo') {
      const { parseMPO } = await import('./parsers/mpo-parser/mpo-parser.js');
      return parseMPO(url, { angle, projection, signal });
    }

    if (type === 'jps') {
      const { parseJPS } = await import('./parsers/jps-parser/jps-parser.js');
      return parseJPS(url, stereoOptions);
    }

    if (type === 'pns') {
      const { parsePNS } = await import('./parsers/png-parser/png-parser.js');
      return parsePNS(url, stereoOptions);
    }

    if (type === 'quilt') {
      const { parseQuilt } = await import('./parsers/quilt-parser/quilt-parser.js');
      return parseQuilt(url, {
        ...stereoOptions,
        bytes: await picture.bytes(),
        fallbackDefault: true,
      });
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

    if (WIGGLE_TYPES.includes(type)) {
      const { parseWigglegram } = await import('./parsers/wiggle-parser/wiggle-parser.js');
      return parseWigglegram(url, { ...stereoOptions, type, bytes: await picture.bytes() });
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

    // AVIF: Spatial photos ("ster" entity group) and AVIF auxiliary depth maps.
    // Checked strictly before HEIC so "mif1"+"avif" and brand-neutral "mif1"+"miaf"+AV1 files are never misrouted to libheif.
    if (isAvif(bytes)) {
      const { parseAVIFStereo, readAvif } = await import('./parsers/avif-parser/avif-parser.js');
      const avif = readAvif(bytes);
      if (avif && (avif.stereoPair || avif.depth !== undefined || avif.truncated || avif.invalidSter)) {
        return parseAVIFStereo(url, { ...stereoOptions, bytes, structure: avif });
      }
    } else if (isHeif(bytes)) {
      const { parseAVIFStereo, readAvif } = await import('./parsers/avif-parser/avif-parser.js');
      const avif = readAvif(bytes);
      if (avif) {
        if (avif.stereoPair || avif.depth !== undefined || avif.truncated || avif.invalidSter) {
          return parseAVIFStereo(url, { ...stereoOptions, bytes, structure: avif });
        }
      } else {
        // HEIC: Apple Vision Pro and iPhone spatial photos. Most browsers cannot display them by themselves.
        const { parseHEIC, readHeic } = await import('./parsers/heic-parser/heic-parser.js');
        if (readHeic(bytes)) {
          return parseHEIC(url, { angle, projection, signal });
        }
      }
    }

    // JPS: JPEG Stereoscopic files, either with .jps extension or with an APP3 _JPSJPS_ marker.
    const isNamedJps = /\.jps$/i.test(src.split(/[?#]/)[0]);
    if (isNamedJps || mayHaveJpsMarker(bytes)) {
      const { parseJPS } = await import('./parsers/jps-parser/jps-parser.js');
      return parseJPS(url, { ...stereoOptions, bytes });
    }

    // PNG Stereoscopic files (.pns or PNG files with an sTER chunk).
    const isNamedPns = /\.pns$/i.test(src.split(/[?#]/)[0]);
    if (isNamedPns || hasSterChunk(bytes)) {
      const { parsePNS } = await import('./parsers/png-parser/png-parser.js');
      return parsePNS(url, { ...stereoOptions, bytes });
    }

    // Animated Wigglegrams (multi-frame GIF, animated WebP, APNG).
    // Checked after sTER PNG so static PNGs/GIFs/WebPs fall through to standard mono/stereo parsing.
    if (mayBeAnimatedWigglegram(bytes)) {
      const { parseWigglegram } = await import('./parsers/wiggle-parser/wiggle-parser.js');
      return parseWigglegram(url, { ...stereoOptions, bytes });
    }

    // try to read XMP metadata to see if VR Photo, otherwise assume stereo-style (e.g. "left right")
    let exif;
    try {
      exif = await readMetadata(bytes);
    } catch (e) {
      // ignore unsupported metadata containers
    }
    signal?.throwIfAborted();

    if (await describesDepthMap(exif, bytes)) {
      // Checked before VR Photos: a picture with a depth map can also hold a second image, the original picture.
      const { parseDepth } = await import('./parsers/depth-parser/depth-parser.js');
      return parseDepth(url, { signal, exif, bytes });
    }

    if (exif?.GImage?.Data) {
      // GImage XMP for left eye found, assume VR Photo
      return this._parseVR(picture, signal, exif);
    }

    // Side by side, or top and bottom, pictures whose views are squeezed to half of their size cannot be told apart
    // from the others. Their file name usually says it, as "_HSBS" in the ones of Spatialify.
    const squeezed = halfTypeOfName(src);
    if (squeezed) {
      console.info(`<stereo-img> does not have a "type" attribute. From its file name, the picture seems to be "${squeezed}".`);
      const { parseStereo } = await import('./parsers/stereo-parser/stereo-parser.js');
      return parseStereo(url, { ...stereoOptions, type: squeezed });
    }

    // RGB-D composite images (color + depth map): detect by filename before _isStereo since color vs depth halves differ significantly.
    const rgbdType = rgbdTypeOfName(src);
    if (rgbdType) {
      console.info(`<stereo-img> does not have a "type" attribute. From its file name, the picture seems to be "${rgbdType}".`);
      const { parseRGBD } = await import('./parsers/rgbd-parser/rgbd-parser.js');
      return parseRGBD(url, { ...stereoOptions, type: rgbdType, exif, bytes });
    }

    // Looking Glass Quilt images (_qs<Cols>x<Rows>a<Aspect>): detect before _isStereo so multi-view grids are not misclassified as SBS.
    const quiltDescriptor = quiltDescriptorOfName(src);
    if (quiltDescriptor) {
      console.info(`<stereo-img> does not have a "type" attribute. From its file name, the picture seems to be a ${quiltDescriptor.cols}x${quiltDescriptor.rows} Looking Glass quilt.`);
      const { parseQuilt } = await import('./parsers/quilt-parser/quilt-parser.js');
      return parseQuilt(url, { ...stereoOptions, exif: exif ?? {}, bytes });
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
        img.onerror = (err) => reject(err instanceof Error ? err : new Error(`Failed to load image: ${src}`));
        img.src = src;
      });
    }

    if (eye === "left") {
      // the surroundings take their colours from this picture
      this._leftPicture = imageData;
    }

    // A picture larger than the largest texture of the GPU is cut into tiles: several textures, on several meshes.
    const maxTextureSize = this._maxTextureSize();
    const fitsInOneTexture = imageData.width <= maxTextureSize && imageData.height <= maxTextureSize;

    let geometry;
    // if angle is less than Pi / 2, use a plane, otherwise use a sphere
    if (this.stereoData.phiLength < Math.PI / 2) {
      const imageWidth = imageData.width;
      const imageHeight = imageData.height;
      const aspectRatio = (this.stereoData && this.stereoData.aspect > 0) ? this.stereoData.aspect : (imageWidth / imageHeight);

      const planeWidth = radius * 2;
      const planeHeight = planeWidth / aspectRatio;
      const planeDistance = radius;

      // Tiles are made of whole triangles: a large picture needs at least a pair of triangles per tile.
      const tileSize = maxTextureSize - 2 * tilePadding(maxTextureSize);
      const widthSegments = fitsInOneTexture ? planeSegments : Math.max(planeSegments, Math.ceil(imageWidth / tileSize));
      const heightSegments = fitsInOneTexture ? planeSegments : Math.max(planeSegments, Math.ceil(imageHeight / tileSize));

      geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, widthSegments, heightSegments);
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

        // An equidistant fisheye: the distance to the centre of the circle is proportional to the angle to the axis of the lens,
        // which is the X axis here, and the edge of the circle is at 90°.
        // The normal is the direction of the vertex: (z, y) is what it has across the axis, of length the sine of that angle.
        // Dividing by that sine gives the direction in the picture, and multiplying by the angle, as a share of 90°, the distance to the centre.
        // Lenses are close to it: see https://paulbourke.net/stereoscopy/Canon_RF_dual_fisheye/ for the Canon RF 5.2mm.
        var correction = (y == 0 && z == 0) ? 1 : (Math.acos(x) / Math.sqrt(y * y + z * z)) * (2 / Math.PI);
        // We expect that the left/right eye images have already been cropped to the circle that 180° cover.
        // Therefore, UVs expand the whole u and v axis
        uvs[i * 2 + 0] = z * 0.5 * correction + 0.5;
        uvs[i * 2 + 1] = y * 0.5 * correction + 0.5;
      }
    }

    let displacementMap = null;
    if (this.stereoData.depth) {
      displacementMap = new THREE.Texture(this.stereoData.depth);
      displacementMap.needsUpdate = true;
      // displacementMap.colorSpace = THREE.SRGBColorSpace;
    }

    // The parts of the picture: all of it on the whole geometry, or tiles, each on some of the triangles.
    let parts = null;
    if (fitsInOneTexture) {
      parts = [{ geometry, image: imageData }];
    } else {
      parts = this._cutIntoTiles(geometry, imageData, maxTextureSize);
      if (parts) {
        // The depth map is not cut: tiles also know where they are on the whole picture.
        if (displacementMap) {
          displacementMap.channel = 1;
        }
      } else {
        parts = [{ geometry, image: await this._shrinkPicture(imageData, maxTextureSize) }];
      }
    }

    for (const part of parts) {
      const texture = new THREE.Texture(part.image);
      texture.needsUpdate = true;
      texture.colorSpace = THREE.SRGBColorSpace;

      const material = new THREE.MeshStandardMaterial({
        map: texture,
        displacementScale: -1 * depth,
        displacementBias: depth / 2,
        flatShading: true,
      });
      material.displacementMap = displacementMap;
      this._applyVRLoadingBlur?.(material);

      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.rotation.reorder('YXZ');
      mesh.rotation.y = Math.PI / 2;
      mesh.rotation.x = this.stereoData.roll || 0;
      mesh.rotation.z = this.stereoData.pitch || 0;
      mesh.layers.set(eyeNumber); // display in left/right eye only
      this.stereoImageGroup.add(mesh);

      if (part.tile) {
        /** Which pixels of the picture this mesh draws, when the picture is cut into tiles. */
        mesh.userData.tile = part.tile;
        // Tiles are copies of parts of the picture. Send each to the GPU now and let go of the copy:
        // the memory of a large picture is not needed twice.
        this.renderer.initTexture(texture);
        texture.image = null;
        this._hasTiles = true;
      }
    }

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
   * Inject a lightweight GPU blur + dim pass into the picture material so that
   * loading a new picture in VR blurs and softens the previous stereo image
   * just like the 2D frosted-glass scrim, without extra render targets.
   * @param {THREE.MeshStandardMaterial} material
   * @private
   */
  _applyVRLoadingBlur(material) {
    this._vrLoadingBlurUniform ||= { value: 0 };
    const blurUniform = this._vrLoadingBlurUniform;
    material.customProgramCacheKey = () => 'stereo-img-vr-loading-blur';
    material.onBeforeCompile = shader => {
      shader.uniforms.uLoadingBlur = blurUniform;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_pars_fragment>',
          `#include <map_pars_fragment>
          uniform float uLoadingBlur;`
        )
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            vec4 sampledDiffuseColor;
            if ( uLoadingBlur > 0.001 ) {
              float lodBias = uLoadingBlur * 2.5;
              vec2 stepUv = clamp( max( fwidth( vMapUv ), vec2( 0.0005 ) ) * ( 3.5 * uLoadingBlur ), vec2( 0.0 ), vec2( 0.03 ) );
              vec4 c = texture2D( map, vMapUv, lodBias ) * 0.25;
              c += texture2D( map, clamp( vMapUv + vec2( stepUv.x, 0.0 ), 0.0, 1.0 ), lodBias ) * 0.125;
              c += texture2D( map, clamp( vMapUv - vec2( stepUv.x, 0.0 ), 0.0, 1.0 ), lodBias ) * 0.125;
              c += texture2D( map, clamp( vMapUv + vec2( 0.0, stepUv.y ), 0.0, 1.0 ), lodBias ) * 0.125;
              c += texture2D( map, clamp( vMapUv - vec2( 0.0, stepUv.y ), 0.0, 1.0 ), lodBias ) * 0.125;
              c += texture2D( map, clamp( vMapUv + stepUv, 0.0, 1.0 ), lodBias ) * 0.0625;
              c += texture2D( map, clamp( vMapUv - stepUv, 0.0, 1.0 ), lodBias ) * 0.0625;
              c += texture2D( map, clamp( vMapUv + vec2( stepUv.x, -stepUv.y ), 0.0, 1.0 ), lodBias ) * 0.0625;
              c += texture2D( map, clamp( vMapUv + vec2( -stepUv.x, stepUv.y ), 0.0, 1.0 ), lodBias ) * 0.0625;
              sampledDiffuseColor = c;
              sampledDiffuseColor.rgb *= mix( 1.0, 0.58, uLoadingBlur );
            } else {
              sampledDiffuseColor = texture2D( map, vMapUv );
            }
            #ifdef DECODE_VIDEO_TEXTURE
              sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
            #endif
            diffuseColor *= sampledDiffuseColor;
          #endif`
        );
    };
  }

  /**
   * In VR, keep the viewer in the middle of the picture, wherever their head is in the room.
   *
   * A stereo picture is what two eyes saw from one place. Seen from anywhere else it is distorted: the middle of what it is
   * drawn on has to be where the head is, and to stay there when the head moves. Only turning the head changes the view.
   *
   * A picture with a depth map is different: it has relief, and moving the head shows its sides. It is placed once,
   * in front of where the viewer is, and stays there.
   * @param {XRFrame} frame - The frame being drawn.
   * @private
   */
  _followViewer(frame) {
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    const pose = referenceSpace && frame?.getViewerPose(referenceSpace);
    if (!pose) {
      // the headset does not know where it is, for now
      return;
    }
    const head = pose.transform.position;

    this.loadingIndicator.position.set(head.x, head.y, head.z - LOADING_INDICATOR_DISTANCE);

    const group = this.stereoImageGroup;
    if (!group) {
      return;
    }
    const hasRelief = !!this.stereoData?.depth;
    if (!hasRelief || this._placedGroup !== group) {
      group.position.set(head.x, head.y, head.z);
      this._placedGroup = group;
    }
  }

  /**
   * Out of VR, the picture is around the middle of the scene, where the camera of the element is.
   * @private
   */
  _stopFollowingViewer() {
    this._placedGroup = null;
    this.stereoImageGroup?.position.set(0, 0, 0);
    this.loadingIndicator.position.set(0, 0, -LOADING_INDICATOR_DISTANCE);
  }

  /**
   * In VR, look at the thumbsticks of the controllers: pushed to a side, they ask for the previous or the next picture.
   * @private
   */
  _readThumbsticks() {
    const session = this.renderer.xr.getSession();
    if (!session || !this._pushedThumbsticks) {
      return;
    }
    for (const inputSource of session.inputSources) {
      const direction = directionOfThumbstick(this._pushedThumbsticks, inputSource);
      if (direction) {
        this._askForPicture(direction, 'thumbstick', inputSource);
      }
    }
  }

  /**
   * Tell the page that the viewer asks for another picture.
   * @param {string} direction - "previous" or "next": the name of the event.
   * @param {string} input - What the viewer used: "select" or "thumbstick".
   * @param {XRInputSource} [inputSource] - The controller.
   * @private
   */
  _askForPicture(direction, input, inputSource) {
    this.dispatchEvent(new CustomEvent(direction, {
      detail: { input, handedness: inputSource?.handedness || 'none' },
      bubbles: true,
      composed: true,
    }));
  }

  /**
   * The largest width and height of a texture, in pixels: a limit of the GPU.
   * @returns {number}
   * @private
   */
  _maxTextureSize() {
    return this.renderer.capabilities.maxTextureSize;
  }

  /**
   * Cut the picture of an eye, too large for one texture, into tiles.
   * @param {THREE.BufferGeometry} geometry - What the whole picture is drawn on.
   * @param {ImageData|HTMLImageElement|ImageBitmap|HTMLCanvasElement} picture - The picture.
   * @param {number} maxSize - The largest width and height of a tile, in pixels.
   * @returns {Array<{geometry: THREE.BufferGeometry, image: ImageData|HTMLCanvasElement, tile: Object}>|null} - For each tile, the triangles it is drawn on and its pixels. Null if the picture cannot be cut.
   * @private
   */
  _cutIntoTiles(geometry, picture, maxSize) {
    const { width, height } = picture;
    // every triangle with its own corners, to give triangles to tiles
    const triangles = geometry.index ? geometry.toNonIndexed() : geometry;
    const { position, normal, uv } = triangles.attributes;

    const tiles = planTiles(uv.array, width, height, maxSize);
    if (triangles !== geometry) {
      triangles.dispose();
    }
    if (!tiles) {
      return null;
    }

    return tiles.map(tile => {
      const part = new THREE.BufferGeometry();
      part.setAttribute('position', new THREE.BufferAttribute(pickTriangles(position.array, 3, tile.triangles), 3));
      part.setAttribute('normal', new THREE.BufferAttribute(pickTriangles(normal.array, 3, tile.triangles), 3));
      // where the triangles are on the tile, and on the whole picture
      part.setAttribute('uv', new THREE.BufferAttribute(tileUvs(uv.array, tile, width, height), 2));
      part.setAttribute('uv1', new THREE.BufferAttribute(pickTriangles(uv.array, 2, tile.triangles), 2));
      // A tile keeps the shape of the picture it is a part of: what looks at the shape of the picture sees no difference.
      part.type = geometry.type;
      part.parameters = geometry.parameters;

      const rectangle = { x: tile.x, y: tile.y, width: tile.width, height: tile.height };
      let image;
      if (picture instanceof ImageData) {
        image = new ImageData(cropPixels(picture.data, width, rectangle), tile.width, tile.height);
      } else {
        image = document.createElement('canvas');
        image.width = tile.width;
        image.height = tile.height;
        image.getContext('2d').drawImage(picture, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height);
      }
      return { geometry: part, image, tile: rectangle };
    });
  }

  /**
   * Reduce a picture to the largest size of a texture. Only for a picture that cannot be cut into tiles.
   * @param {ImageData|HTMLImageElement|ImageBitmap|HTMLCanvasElement} picture - The picture.
   * @param {number} maxSize - The largest width and height of a texture, in pixels.
   * @returns {Promise<ImageData>} - The reduced picture.
   * @private
   */
  async _shrinkPicture(picture, maxSize) {
    const newWidth = Math.min(picture.width, maxSize);
    const newHeight = Math.min(picture.height, maxSize);
    console.warn(`Image size (${picture.width}x${picture.height}) exceeds max texture size (${maxSize}x${maxSize}). Resizing to ${newWidth}x${newHeight}.`);
    const canvas = document.createElement("canvas");
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext("2d");
    const imageBitmap = await createImageBitmap(picture);
    ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
    return ctx.getImageData(0, 0, newWidth, newHeight);
  }

  /**
   * Tell if a view of the camera shows nothing but the picture: no margin around it.
   * A view is given the way the controls move it: for a picture on a sphere, the direction of the camera,
   * to the right and upwards in degrees. For a flat picture, the position of the camera, to the right and upwards.
   * @param {number} first - Direction or position of the view, to the right.
   * @param {number} second - Direction or position of the view, upwards.
   * @param {number} fov - Vertical field of view, in degrees.
   * @returns {boolean} - True if the picture fills the view, for both eyes.
   * @private
   */
  _viewIsInsidePicture(first, second, fov) {
    const meshes = this.stereoImageGroup?.children.filter(object => object.isMesh) || [];
    const aspect = this.camera.aspect;
    if (meshes.length === 0 || !(aspect > 0)) {
      return true;
    }
    this.stereoImageGroup.updateMatrixWorld(true);

    if (this._fitsGroup !== this.stereoImageGroup || this._fitsAspect !== aspect) {
      // A picture that cannot fill even the narrowest view, in its middle, is left free: there is nothing to keep the view on.
      this._fitsGroup = this.stereoImageGroup;
      this._fitsAspect = aspect;
      this._fits = true;
      const center = this.controls.mode === 'pan' ? { lon: 0, lat: 0 } : this._pictureCenter();
      this._fits = this._viewIsInsidePicture(center.lon, center.lat, this.controls.minFov);
    }
    if (!this._fits) {
      return true;
    }

    const isPanning = this.controls.mode === 'pan';
    const origin = new THREE.Vector3(isPanning ? first : 0, isPanning ? second : 0, 0);
    const [lon, lat] = isPanning ? [0, 0] : [first, second];

    const radians = Math.PI / 180;
    const [sinLon, cosLon, sinLat, cosLat] = [Math.sin(lon * radians), Math.cos(lon * radians), Math.sin(lat * radians), Math.cos(lat * radians)];
    // The camera looks at `forward`, with `right` and `up` on its sides.
    const forward = [sinLon * cosLat, sinLat, -cosLon * cosLat];
    const right = [cosLon, 0, sinLon];
    const up = [-sinLon * sinLat, cosLat, cosLon * sinLat];
    const tanV = Math.tan(fov * radians / 2);
    const tanH = tanV * aspect;

    // The corners of the view, and the middle of its sides
    for (const [h, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const direction = new THREE.Vector3(
        forward[0] + h * tanH * right[0] + v * tanV * up[0],
        forward[1] + h * tanH * right[1] + v * tanV * up[1],
        forward[2] + h * tanH * right[2] + v * tanV * up[2]);
      if (!meshes.every(mesh => rayHitsPicture(mesh, origin, direction))) {
        return false;
      }
    }
    return true;
  }

  /**
   * The direction of the middle of the picture, seen from the camera.
   * @returns {{lon: number, lat: number}} - Angles to the right and upwards, in degrees.
   * @private
   */
  _pictureCenter() {
    const mesh = this.stereoImageGroup?.children.find(object => object.isMesh);
    if (!mesh) {
      return { lon: 0, lat: 0 };
    }
    this.stereoImageGroup.updateMatrixWorld(true);
    // In the space of its mesh, a picture is centred on the X axis. On a sphere it can be above or below it.
    const { thetaStart, thetaLength } = mesh.geometry.parameters;
    const theta = thetaLength > 0 ? thetaStart + thetaLength / 2 : Math.PI / 2;
    const center = new THREE.Vector3(Math.sin(theta), Math.cos(theta), 0).transformDirection(mesh.matrixWorld);
    return {
      lon: Math.atan2(center.x, -center.z) * 180 / Math.PI,
      lat: Math.asin(Math.max(-1, Math.min(1, center.y))) * 180 / Math.PI,
    };
  }

  /**
   * Move the pictures of the two eyes horizontally, in opposite directions.
   *
   * The "disparity-adjustment" attribute is the distance to add between the two pictures,
   * in percent of the width of one of them. A negative value moves them closer together:
   * the left picture to the right and the right picture to the left. Each moves by half of the value.
   * When the attribute is not set, falls back to any adjustment embedded in the picture metadata
   * (such as Apple's HorizontalDisparityAdjustment in spatial HEIC photos).
   */
  updateDisparityAdjustment() {
    if (!this.stereoImageGroup || !this.stereoData) {
      return;
    }
    const attr = this.getAttribute('disparity-adjustment');
    const percent = attr !== null ? (parseFloat(attr) || 0) : (this.stereoData.disparityAdjustment || 0);
    const adjustment = percent / 100;
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

    // the pictures of both eyes must still fill the view
    this.controls?.constrain();
  }

  async initialize3DScene() {
    if (this.stereoImageGroup) {
      this.scene.remove(this.stereoImageGroup);
    }
    if (this.stereoImageGroup && !this._gpuWasEmptied) {
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
    this._leftPicture = null;
    this._hasTiles = false;

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

    const animation = (time, frame) => {
      const inVR = !!this.renderer.xr.isPresenting;
      const loadingInVR = inVR && !!this.loadingIndicator?.visible;
      if (this._vrLoadingSpinner) {
        this._vrLoadingSpinner.visible = loadingInVR;
        if (loadingInVR) {
          this._vrLoadingSpinner.rotation.z -= 0.08;
        }
      }
      if (this._vrLoadingBlurUniform) {
        if (loadingInVR) {
          const elapsed = performance.now() - (this._loadingStartedAt || 0);
          this._vrLoadingBlurUniform.value = elapsed >= 120 ? Math.min(1, (elapsed - 120) / 200) : 0;
        } else {
          this._vrLoadingBlurUniform.value = 0;
        }
      }

      if (inVR) {
        this._readThumbsticks();
        this._followViewer(frame);
      }

      this._renderFrame();
    };

    if (this._drawsOnDemand) {
      // draws when asked: nothing to animate
      this.toggleWiggle(false);
      this.renderer.setAnimationLoop(null);
      return;
    }

    if (flatMode === 'wiggle') {
      this.toggleWiggle(true);
    } else {
      this.toggleWiggle(false);
    }
    this.renderer.setAnimationLoop(animation);
  }

  /**
   * Create the 2D loading overlay in the shadow tree on first use.
   * @returns {HTMLElement|null}
   * @private
   */
  _loadingOverlay() {
    if (this._drawsOnDemand || typeof document === 'undefined' || typeof this.shadowRoot?.querySelector !== 'function') {
      return null;
    }
    let overlay = this.shadowRoot.querySelector('#loading');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loading';
      overlay.className = 'indeterminate';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.setAttribute('aria-label', 'Loading stereo image');
      overlay.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">
        <circle class="track" cx="24" cy="24" r="18"></circle>
        <circle class="arc" cx="24" cy="24" r="18"></circle>
      </svg>`;
      this.shadowRoot.appendChild(overlay);
    }
    return overlay;
  }

  /**
   * Toggle the loading state (both the 2D shadow DOM overlay and the 3D VR indicator).
   * @param {boolean} loading
   * @private
   */
  _setLoading(loading) {
    if (loading) {
      this._loadingStartedAt = performance.now();
    } else if (this._vrLoadingBlurUniform) {
      this._vrLoadingBlurUniform.value = 0;
    }
    if (this.loadingIndicator) {
      this.loadingIndicator.visible = loading;
    }
    const overlay = this._loadingOverlay();
    if (!overlay) {
      return;
    }
    if (loading) {
      this._setError(null);
      overlay.classList.toggle('initial', !this._hasDisplayedPicture && !this._still);
      overlay.classList.add('indeterminate', 'visible');
      const arc = overlay.querySelector('.arc');
      if (arc) {
        arc.style.strokeDasharray = '';
        arc.style.strokeDashoffset = '';
      }
    } else {
      overlay.classList.remove('visible');
    }
  }

  /**
   * Update the determinate download progress ring while a picture is streaming.
   * Switches back to the indeterminate decoding spinner once the download finishes.
   * @param {number} loaded - Bytes received so far.
   * @param {number} total - Total bytes expected.
   * @private
   */
  _setLoadingProgress(loaded, total) {
    const overlay = this._loadingOverlay();
    if (!overlay || !overlay.classList.contains('visible')) {
      return;
    }
    const arc = overlay.querySelector('.arc');
    if (!arc) {
      return;
    }
    if (total > 0 && loaded > 0 && loaded < total) {
      const ratio = Math.min(1, Math.max(0, loaded / total));
      overlay.classList.remove('indeterminate');
      arc.style.strokeDasharray = `${LOADING_RING_CIRCUMFERENCE}`;
      arc.style.strokeDashoffset = `${LOADING_RING_CIRCUMFERENCE * (1 - ratio)}`;
    } else {
      overlay.classList.add('indeterminate');
      arc.style.strokeDasharray = '';
      arc.style.strokeDashoffset = '';
    }
  }

  /**
   * Show or hide a minimal error overlay when a picture cannot be displayed.
   * @param {string|null} message
   * @private
   */
  _setError(message) {
    if (this._drawsOnDemand || typeof document === 'undefined' || typeof this.shadowRoot?.querySelector !== 'function') {
      return;
    }
    let errorEl = this.shadowRoot.querySelector('#error');
    if (!message) {
      errorEl?.classList.remove('visible');
      return;
    }
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.id = 'error';
      errorEl.setAttribute('role', 'alert');
      errorEl.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"></rect>
        <path d="M9 9l6 6M15 9l-6 6"></path>
      </svg><span></span>`;
      this.shadowRoot.appendChild(errorEl);
    }
    errorEl.querySelector('span').textContent = message;
    errorEl.classList.add('visible');
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

    this._setLoading(true);

    try {
      let stereoData;
      let failed = false;
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
        failed = true;
      }
      await this._display(stereoData, signal);
      if (!signal.aborted) {
        this._hasDisplayedPicture = !failed && !!this.src;
        this._setError(failed ? 'Could not load picture' : null);
      }
    } finally {
      if (this._loadController === controller) {
        this._loadController = null;
        this._setLoading(false);
      }
    }
  }

  /**
   * Build the scene of the picture being displayed again, without moving the view.
   * Like any other change of the scene, it waits for the one in progress.
   * @private
   */
  async _rebuildScene() {
    const previous = this._displaying;
    const rebuild = (async () => {
      await previous;
      if (!this.stereoData || !this.renderer) {
        return;
      }
      try {
        // What the previous scene had on the GPU went away with it: there is nothing to free.
        this._gpuWasEmptied = true;
        await this.initialize3DScene();
        this.updateSurroundings();
      } catch (error) {
        console.error(`<stereo-img> could not display "${this.src}" again.`, error);
      } finally {
        this._gpuWasEmptied = false;
      }
    })();
    this._displaying = rebuild;
    await rebuild;
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
        this.updateSurroundings();
        this.updateSound();
        // A flat picture slides in front of the viewer. A picture on a sphere is looked around.
        const isFlat = this.stereoImageGroup.children.some(object => object.geometry.type === 'PlaneGeometry');
        this.controls.mode = isFlat ? 'pan' : 'look';
        this.controls.distance = PICTURE_DISTANCE;
        // start in front of the new picture, as wide as it allows
        this.controls.reset(DEFAULT_FOV, this._pictureCenter());
      } catch (error) {
        if (signal.aborted) {
          // The more recent load replaces this scene.
          return;
        }
        console.error(`<stereo-img> could not display "${this.src}".${loadingHints(this.src, location.href)}`, error);
        this._hasDisplayedPicture = false;
        this._setError('Could not load picture');
        try {
          this.stereoData = this._emptyStereoData();
          await this.initialize3DScene();
          this.updateSurroundings();
          this.updateSound();
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

  /**
   * What is seen around the picture, where it does not fill the view: mostly in VR.
   * A very large sphere around the viewer, coloured from the bottom to the top.
   */
  setupSurroundings() {
    const geometry = new THREE.SphereGeometry(SURROUNDINGS_RADIUS, 32, 64);
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
    this.surroundings = new THREE.Mesh(geometry, material);
    // behind everything, for both eyes
    this.surroundings.renderOrder = -1;
    this.surroundings.layers.enable(1);
    this.surroundings.layers.enable(2);
    this.scene.add(this.surroundings);
    this.setSurroundingsColors([0, 0, 0], [0, 0, 0]);
  }

  /**
   * Colour the surroundings of the picture: one colour above it, another below it, and from one to the other beside it.
   * @param {Array<number>} top - Red, green and blue above the picture, from 0 to 255.
   * @param {Array<number>} bottom - Red, green and blue below the picture, from 0 to 255.
   * @param {number} [topLatitude] - How high the top of the picture is, in radians above the horizon.
   * @param {number} [bottomLatitude] - How high the bottom of the picture is, in radians above the horizon.
   */
  setSurroundingsColors(top, bottom, topLatitude = Math.PI / 2, bottomLatitude = -Math.PI / 2) {
    // dimmed, to leave the picture in front, but never darker than the surroundings of an element without a picture
    const dim = color => color.map(value => Math.round(Math.max(SURROUNDINGS_DARKEST, value * SURROUNDINGS_BRIGHTNESS)));
    const topColor = new THREE.Color().setRGB(...dim(top).map(value => value / 255), THREE.SRGBColorSpace);
    const bottomColor = new THREE.Color().setRGB(...dim(bottom).map(value => value / 255), THREE.SRGBColorSpace);

    const { position, color } = this.surroundings.geometry.attributes;
    const mixed = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const latitude = Math.asin(THREE.MathUtils.clamp(position.getY(i) / SURROUNDINGS_RADIUS, -1, 1));
      // from 0 at the height of the bottom of the picture to 1 at the height of its top
      const height = THREE.MathUtils.clamp((latitude - bottomLatitude) / (topLatitude - bottomLatitude), 0, 1);
      mixed.lerpColors(bottomColor, topColor, height);
      color.setXYZ(i, mixed.r, mixed.g, mixed.b);
    }
    color.needsUpdate = true;

    /** The colours of the surroundings of the picture: red, green and blue from 0 to 255, above and below the picture. */
    this.surroundingsColors = { top: dim(top), bottom: dim(bottom) };
  }

  /**
   * Give the surroundings the colours of the top and bottom edges of the picture being displayed.
   */
  updateSurroundings() {
    let colors = { top: [0, 0, 0], bottom: [0, 0, 0] };
    let topLatitude = Math.PI / 2;
    let bottomLatitude = -Math.PI / 2;

    try {
      const mesh = this.stereoImageGroup?.children.find(object => object.isMesh && object.material.map);
      if (mesh && this._leftPicture) {
        let pixels = this._leftPicture;
        if (!(pixels instanceof ImageData)) {
          // a small copy of the picture is enough to know the colours of its edges
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(pixels, 0, 0, canvas.width, canvas.height);
          pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
        colors = edgeColors(pixels, { circle: this.stereoData.projection === 'fisheye' });

        // how high and how low the picture goes, seen from the middle of the scene
        const { type, parameters } = mesh.geometry;
        if (type === 'PlaneGeometry') {
          topLatitude = Math.atan2(parameters.height / 2, PICTURE_DISTANCE);
          bottomLatitude = -topLatitude;
        } else {
          topLatitude = Math.PI / 2 - parameters.thetaStart;
          bottomLatitude = topLatitude - parameters.thetaLength;
        }
      }
    } catch (error) {
      // The colours are a decoration: a picture whose pixels cannot be read keeps dark surroundings.
      colors = { top: [0, 0, 0], bottom: [0, 0, 0] };
    }

    this.setSurroundingsColors(colors.top, colors.bottom, topLatitude, bottomLatitude);
  }

  setupLoadingIndicator() {
    this.loadingIndicator = new THREE.Group();
    this.loadingIndicator.position.set(0, 0, -LOADING_INDICATOR_DISTANCE);
    this.loadingIndicator.visible = false;

    // Displayed inside WebXR sessions; outside VR the 2D shadow DOM overlay handles loading.
    const spinner = new THREE.Group();
    spinner.visible = false;

    const track = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.007, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthTest: false })
    );
    track.renderOrder = 999;
    track.layers.enable(1);
    track.layers.enable(2);

    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.008, 12, 36, Math.PI * 1.4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthTest: false })
    );
    arc.renderOrder = 1000;
    arc.layers.enable(1);
    arc.layers.enable(2);

    spinner.add(track, arc);
    this.loadingIndicator.add(spinner);
    this._vrLoadingSpinner = spinner;
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

    this.shadowRoot.innerHTML = HOST_STYLE;
    if (this._still) {
      // Started on interaction: the still stays over the picture until the picture is displayed.
      this.shadowRoot.appendChild(this._still);
    }

    this._giveHeight();

    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.xr.enabled = true;
    // The sound of the picture plays in VR, unless the element is muted. It goes back to how it was when leaving VR.
    this.renderer.xr.addEventListener('sessionstart', () => {
      this._soundBeforeVR = this.soundOn;
      if (!this.muted) {
        this.setSound(true);
      }
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.setSound(!!this._soundBeforeVR);
    });
    // In VR, the controllers ask for the previous or the next picture: the page decides which pictures these are.
    this.renderer.xr.addEventListener('sessionstart', () => {
      this._pushedThumbsticks = new WeakSet();
      // the trigger of a controller, a pinch of the fingers, the button of a Cardboard viewer
      this.renderer.xr.getSession().addEventListener('select', event => {
        this._askForPicture(directionOfSelect(event.inputSource?.handedness), 'select', event.inputSource);
      });
    });
    this.renderer.setSize(this.clientWidth, this.clientHeight);
    this.shadowRoot.appendChild(this.renderer.domElement);
    // A browser can take the GPU away from a page, then give it back empty: phones do when the page is in the background.
    // The renderer sends what it still has again. The tiles of a large picture are not kept: cut them again.
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      if (this._hasTiles) {
        this._rebuildScene();
      }
    });

    this.scene = new THREE.Scene();
    this.setupLoadingIndicator();
    this.setupSurroundings();

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
    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, this.clientWidth / this.clientHeight, 0.1, 2000);
    this.camera.layers.enable(1);

    // Look around by dragging the picture. In VR, the headset decides where the camera looks.
    this.controls = new LookControls(this.camera, this.renderer.domElement);
    // Only look at the picture: no margin around it.
    this.controls.isAllowed = (lon, lat, fov) => this._viewIsInsidePicture(lon, lat, fov);
    this.renderer.xr.addEventListener('sessionstart', () => {
      this.controls.enabled = false;
      this._fovBeforeVR = this.camera.fov;
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      // Some WebXR runtimes move the canvas to show it full screen, and cannot put it back in the element.
      const canvas = this.renderer.domElement;
      if (canvas.parentNode !== this.shadowRoot) {
        this.shadowRoot.insertBefore(canvas, this.shadowRoot.querySelector('style').nextSibling);
      }
      // The picture followed the viewer in the room: put it back.
      this._stopFollowingViewer();
      // The headset changed the camera: go back to the view of the element.
      this.camera.fov = this._fovBeforeVR;
      this.camera.aspect = this.clientWidth / this.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.clientWidth, this.clientHeight);
      this.controls.enabled = true;
      this.controls.constrain();
    });

    this.updateButtons();

    // Listen for component resize
    this._resizeObserver = new ResizeObserver(() => this._resize());

    this._resizeObserver.observe(this);

    await this.parseImageAndInitialize3DScene();
  }

  /**
   * Give a height to an element that has none: three quarters of its width.
   * @private
   */
  _giveHeight() {
    if (this.clientHeight === 0) {
      const aspectRatio = 4 / 3;
      this.style.height = this.clientWidth / aspectRatio + "px";
    }
  }

  /**
   * Draw at the size of the element.
   * @private
   */
  _resize() {
    if (!this.renderer) {
      return;
    }
    this.renderer.setSize(this.clientWidth, this.clientHeight);
    this.camera.aspect = this.clientWidth / this.clientHeight;
    this.camera.updateProjectionMatrix();
    this.anaglyphEffect.setSize(this.clientWidth, this.clientHeight);
    // the picture may not fill the new shape of the element with the same view
    this.controls.constrain();
  }

  /**
   * Draw the picture once, the way the "flat" attribute says.
   * @param {number} [eye] - Draw what this eye sees instead: 1 for the left eye, 2 for the right eye.
   * @private
   */
  _renderFrame(eye) {
    const flatMode = this.getAttribute('flat');
    if (eye) {
      this.camera.layers.set(eye);
      this.renderer.render(this.scene, this.camera);
    } else if (flatMode === 'wiggle') {
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
  }

  /**
   * Copy what the element shows: a still. An element that wiggles gets one still per eye.
   * @returns {Array<HTMLCanvasElement>}
   * @private
   */
  _captureFrames() {
    const canvas = this.renderer.domElement;
    const eyes = this.getAttribute('flat') === 'wiggle' ? [1, 2] : [0];
    return eyes.map(eye => {
      this._renderFrame(eye);
      const still = document.createElement('canvas');
      still.width = canvas.width;
      still.height = canvas.height;
      still.getContext('2d').drawImage(canvas, 0, 0);
      return still;
    });
  }

  /**
   * Show stills of the picture instead of starting 3D: for an element that starts on interaction.
   * Nothing of WebGL is made, so a page can have many of these.
   * @param {Array<HTMLCanvasElement>} [stills] - What to show. When missing, the stills are drawn from the picture.
   * @private
   */
  _showPreview(stills) {
    this.shadowRoot.innerHTML = HOST_STYLE;
    this._giveHeight();
    this._preview = { job: 0, stills: [], timer: null, aspect: 0 };

    for (const type of START_EVENTS) {
      this.addEventListener(type, this._startOnInteraction, { passive: true });
    }
    // an element that changes shape needs another still, and one that had no size gets its first
    this._previewResizeObserver = new ResizeObserver(() => {
      const aspect = this.clientWidth / this.clientHeight;
      const drawnFor = this._preview?.aspect;
      if (this._preview && aspect > 0 && (!(drawnFor > 0) || Math.abs(aspect / drawnFor - 1) > 0.01)) {
        this._drawPreview();
      }
    });

    if (stills?.length > 0) {
      this._setStills(stills);
    } else {
      this._drawPreview();
    }
    this._previewResizeObserver.observe(this);
  }

  /**
   * Draw the stills of an element that is not started, from its picture.
   * @private
   */
  async _drawPreview() {
    const preview = this._preview;
    if (!preview) {
      return;
    }
    const job = ++preview.job;
    preview.aspect = this.clientWidth / this.clientHeight;
    if (this.src && preview.stills.length === 0) {
      this._setLoading(true);
    }
    const stills = await drawStills(this, job);
    if (this._preview !== preview || preview.job !== job) {
      // started meanwhile, or asked again
      return;
    }
    if (stills) {
      this._setStills(stills);
    } else {
      // Not drawn: the element had no size, or was out of the page. To be drawn when it has a size.
      preview.aspect = 0;
      if (this.isConnected && this.clientWidth > 0 && this.clientHeight > 0) {
        this._drawPreview();
      }
    }
  }

  /**
   * Show stills in an element that is not started. With one per eye, they alternate: the picture wiggles.
   * @param {Array<HTMLCanvasElement>} stills - What to show.
   * @private
   */
  _setStills(stills) {
    const preview = this._preview;
    clearInterval(preview.timer);
    preview.stills.forEach(still => still.remove());
    preview.stills = stills;
    preview.aspect = stills[0].width / stills[0].height;
    stills.forEach((still, index) => {
      still.className = 'still';
      still.style.visibility = index === 0 ? 'visible' : 'hidden';
      this.shadowRoot.appendChild(still);
    });
    this._hasDisplayedPicture = true;
    this._setLoading(false);
    this._wigglePreview();
  }

  /**
   * Alternate the stills of the two eyes, at the pace of toggleWiggle.
   * @private
   */
  _wigglePreview() {
    const preview = this._preview;
    clearInterval(preview.timer);
    preview.timer = null;
    if (preview.stills.length > 1 && this.isConnected) {
      let shown = 0;
      preview.timer = setInterval(() => {
        shown = (shown + 1) % preview.stills.length;
        preview.stills.forEach((still, index) => {
          still.style.visibility = index === shown ? 'visible' : 'hidden';
        });
      }, 1000 / 10);
    }
  }

  /**
   * Start 3D in an element that showed stills.
   * @private
   */
  _start() {
    const preview = this._preview;
    if (!preview) {
      return;
    }
    clearInterval(preview.timer);
    this._previewResizeObserver.disconnect();
    for (const type of START_EVENTS) {
      this.removeEventListener(type, this._startOnInteraction);
    }
    this._preview = null;

    // One still stays over the picture until the picture is displayed, and is kept in case the browser takes the GPU away.
    this._still = preview.stills.find(still => still.style.visibility === 'visible') || preview.stills[0] || null;
    preview.stills.forEach(still => still.style.visibility = 'visible');

    this._started = this.init();
    this._started.finally(() => {
      if (this.renderer && this._still?.isConnected) {
        // the picture, not the sign that it was loading
        if (!this.renderer.xr.isPresenting) {
          this._renderFrame();
        }
        this._still.remove();
      }
    }).catch(() => {
      // reported by the browser, as for an element that starts by itself
    });
    if (!this.renderer) {
      // WebGL is not available
      return;
    }

    this.renderer.domElement.addEventListener('webglcontextlost', this._stopOnContextLoss);
    for (const type of ['pointerenter', 'pointerdown']) {
      this.addEventListener(type, this._noteUse, { passive: true });
    }
    noteUse(this);
  }

  /**
   * Stop 3D in an element that starts on interaction, and show stills again. The next interaction starts it again.
   * @param {boolean} capture - True to show what the element was showing. False to show the still from before it started.
   * @private
   */
  _stopAndShowPreview(capture) {
    if (!this.renderer) {
      return;
    }
    let stills = this._still ? [this._still] : [];
    if (capture && !this.renderer.getContext().isContextLost() && this.stereoData && !this.loadingIndicator.visible) {
      stills = this._captureFrames();
    }
    this.renderer.domElement.removeEventListener('webglcontextlost', this._stopOnContextLoss);
    for (const type of ['pointerenter', 'pointerdown']) {
      this.removeEventListener(type, this._noteUse);
    }
    const index = startedOnInteraction.indexOf(this);
    if (index >= 0) {
      startedOnInteraction.splice(index, 1);
    }
    this._teardown();
    this._still = null;
    this._showPreview(stills);
  }

  /**
   * Stop 3D and give back everything it uses: the GPU first.
   * @private
   */
  _teardown() {
    this._loadController?.abort();
    this._loadController = null;
    this.toggleWiggle(false);
    this._resizeObserver?.disconnect();
    if (this.soundOn) {
      this.setSound(false);
    }
    this.audio = null;
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.controls.dispose();
      this.scene.traverse(object => {
        object.geometry?.dispose();
        if (object.material) {
          object.material.map?.dispose();
          object.material.displacementMap?.dispose();
          object.material.dispose();
        }
      });
      this.anaglyphEffect.dispose();
      const gl = this.renderer.getContext();
      this.renderer.dispose();
      // tell the browser now, instead of when it notices that nothing uses the context
      if (!gl.isContextLost()) {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.anaglyphEffect = null;
    this.loadingIndicator = null;
    this._vrLoadingSpinner = null;
    this._hasDisplayedPicture = false;
    this.surroundings = null;
    this.stereoImageGroup = null;
    this.stereoData = null;
    this._leftPicture = null;
    this._displaying = null;
    this._initialized = false;
  }

  updateButtons() {
    // Remove existing buttons first to avoid duplicates
    const vrButton = this.shadowRoot.querySelector('#VRButton');
    const flatButton = this.shadowRoot.querySelector('#flatModeButton');
    if (vrButton) vrButton.remove();
    if (flatButton) flatButton.remove();

    // Space-separated list of tokens, compared as whole words.
    const controlslist = (this.getAttribute('controlslist') || 'vr wiggle left right anaglyph sound').toLowerCase().split(/\s+/);
    const availableFlatModes = ['left', 'right', 'wiggle', 'anaglyph'].filter(mode => controlslist.includes(mode));

    if (controlslist.includes('vr')) {
      this._controls().appendChild(VRButton.createButton(this.renderer));
    }

    // Only show the flatModeButton if there is more than one mode to cycle through.
    if (availableFlatModes.length > 1) {
      this._controls().appendChild(flatModeButton.createButton(this));
    }

    this.updateSoundButton();
  }

  /**
   * Show the sound button when the picture has sound, unless "controlslist" leaves it out.
   */
  updateSoundButton() {
    this.shadowRoot.querySelector('#soundButton')?.remove();
    const controlslist = (this.getAttribute('controlslist') || 'sound').toLowerCase().split(/\s+/);
    if (this.audio && controlslist.includes('sound')) {
      this._controls().appendChild(soundButton.createButton(this));
    }
  }

  /**
   * The element that holds the buttons, made the first time it is needed.
   * @returns {HTMLElement}
   */
  _controls() {
    let controls = this.shadowRoot.querySelector('#controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'controls';
      this.shadowRoot.appendChild(controls);
    }
    return controls;
  }

  /**
   * Get ready to play the sound of the picture being displayed, if it has one.
   * The sound keeps playing from one picture to the next when it was on.
   */
  updateSound() {
    const wasOn = this.soundOn;
    this.audio?.pause();
    this.audio = null;
    this.soundOn = false;
    if (this.stereoData?.audio) {
      this.audio = new Audio(this.stereoData.audio);
      this.audio.loop = true;
      if (wasOn) {
        this.setSound(true);
      }
    }
    this.updateSoundButton();
  }

  /**
   * Turn the sound of the picture on or off.
   * Browsers only let a page play sound once the user has interacted with it: until then, the sound stays off.
   * @param {boolean} on - true to play the sound
   */
  setSound(on) {
    this.soundOn = !!on && !!this.audio;
    if (this.soundOn) {
      const audio = this.audio;
      Promise.resolve(audio.play()).catch(() => {
        // not allowed to play, or the sound cannot be read
        if (this.audio === audio) {
          this.soundOn = false;
          this.shadowRoot.querySelector('#soundButton')?.update();
        }
      });
    } else {
      this.audio?.pause();
    }
    this.shadowRoot.querySelector('#soundButton')?.update();
  }

  toggleSound() {
    this.setSound(!this.soundOn);
  }


  connectedCallback() {
    if (this._initialized) {
      // Back in the document (for example after being moved): resume what disconnectedCallback paused.
      this._resizeObserver.observe(this);
      this.updateflatMode();
      return;
    }
    if (this._preview) {
      // Back in the document without having started: the stills are still there.
      this._wigglePreview();
      if (this._preview.stills.length === 0) {
        this._drawPreview();
      }
      return;
    }
    if (this.getAttribute('start') === 'interaction') {
      // Show stills, and start 3D when the viewer shows interest.
      this._showPreview();
      return;
    }
    this._started = this.init();
  }

  disconnectedCallback() {
    if (this._preview) {
      clearInterval(this._preview.timer);
      this._preview.timer = null;
    }
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
    // A removed element must not keep playing.
    if (this.soundOn) {
      this.setSound(false);
    }
  }

  constructor() {
    super();
    this.wiggleIntervalID = null; // Initialize the interval ID property
    this._needsRenderUpdate = false;
    this.stereoImageGroup = null;
    this._initialized = false;
    this.attachShadow({ mode: 'open' });
    // The size from the "width" and "height" attributes: kept when the content of the shadow tree is replaced.
    this._sizeSheet = new CSSStyleSheet();
    this.shadowRoot.adoptedStyleSheets = [this._sizeSheet];

    // For an element that starts on interaction
    this._startOnInteraction = () => this._start();
    this._noteUse = () => noteUse(this);
    this._stopOnContextLoss = () => this._stopAndShowPreview(false);
  }

}

if (typeof window !== 'undefined' && window.customElements) {
  window.customElements.define('stereo-img', StereoImg);
}

export { describesDepthMap, isAvif, mayBeAnimatedWigglegram, quiltDescriptorOfName, rgbdTypeOfName, StereoImg };

