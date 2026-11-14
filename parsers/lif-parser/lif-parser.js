// Copyright 2026 Google LLC
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

/**
 * Parser for the Leia Image Format (LIF), used by the Lume Pad tablets.
 *
 * A LIF file is a JPEG picture, the first view, followed by a list of fields:
 *
 *   [first view, a complete JPEG]
 *   [number of fields]
 *   [type][size][data]   for each field
 *   [size of everything that follows the first view][0x1e1a]
 *
 * Numbers are 32-bit big endian, except the final 16-bit marker.
 * One field is a JSON description of the views. The other views are JPEG
 * images, each stored in a field whose type is the identifier of the image.
 */

import { parseStereoPair } from './../stereo-parser/stereo-parser.js';

const END_MARKER = 0x1e1a;
const JSON_FIELD = 7;
const FOOTER_SIZE = 6;

const isJpeg = bytes => bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;

/**
 * Read the structure of a LIF file.
 * @param {Uint8Array} bytes - content of the file
 * @returns {{image: Uint8Array, fields: Map<number, Uint8Array>, metadata: Object}|undefined} the first view,
 *   the fields by type and the description of the views. Undefined if this is not a LIF file.
 */
function readLif(bytes) {
  const size = bytes.length;
  if (size < FOOTER_SIZE + 4 || !isJpeg(bytes)) {
    return;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(size - 2) !== END_MARKER) {
    return;
  }
  const regionSize = view.getUint32(size - FOOTER_SIZE);
  const regionStart = size - regionSize;
  if (regionSize < FOOTER_SIZE + 4 || regionStart < 2) {
    return;
  }

  const fields = new Map();
  const end = size - FOOTER_SIZE;
  let position = regionStart;
  const count = view.getUint32(position);
  position += 4;
  for (let i = 0; i < count; i++) {
    if (position + 8 > end) {
      return;
    }
    const type = view.getUint32(position);
    const length = view.getUint32(position + 4);
    position += 8;
    if (position + length > end) {
      return;
    }
    fields.set(type, bytes.subarray(position, position + length));
    position += length;
  }

  let metadata = {};
  if (fields.has(JSON_FIELD)) {
    try {
      metadata = JSON.parse(new TextDecoder().decode(fields.get(JSON_FIELD)));
    } catch (e) {
      // no usable description
    }
  }

  return { image: bytes.subarray(0, regionStart), fields, metadata };
}

/**
 * Extract the left and right views of a LIF file.
 * @param {Uint8Array} bytes - content of the file
 * @returns {{left: Uint8Array, right: Uint8Array, metadata: Object}|undefined} the JPEG images of both views and the description of the file.
 *   Undefined if the file is not a LIF file with two views.
 */
function readStereoPair(bytes) {
  const lif = readLif(bytes);
  if (!lif) {
    return;
  }
  const { image, fields, metadata } = lif;

  let views = [];
  if (Array.isArray(metadata.views)) {
    // Each view names the field holding its image. The first view is the picture at the start of the file.
    views = metadata.views
      .map((view, index) => ({
        x: Number(view?.xLocation) || 0,
        image: fields.get(view?.albedoId) || (index === 0 ? image : undefined),
      }))
      .filter(view => view.image && isJpeg(view.image));
  } else {
    // No description: the file starts with a view and the others follow, from left to right.
    views = [image, ...[...fields.values()].filter(isJpeg)].map((image, x) => ({ x, image }));
  }
  if (views.length < 2) {
    return;
  }

  // Views are positioned on a horizontal axis, growing to the right.
  views.sort((a, b) => a.x - b.x);
  return { left: views[0].image, right: views[views.length - 1].image, metadata };
}

/**
 * Horizontal angle of view of the camera, from the description of a LIF file.
 * @param {Object} metadata - description of the file
 * @returns {number|undefined} the angle in degrees, if the focal length is known
 */
function angleOfView(metadata) {
  // focal length, as a fraction of the width of a view
  const focalRatio = Number(metadata?.cameraFocalRatioToWidth);
  if (focalRatio > 0) {
    return 2 * Math.atan(0.5 / focalRatio) * 180 / Math.PI;
  }
}

/**
 * Fetch a LIF file and return its left and right eye images.
 * @param {string} url - image url
 * @param {Object} [options] - Parsing options: angle, projection, signal: AbortSignal to cancel the parsing
 */
async function parseLIF(url, options) {
  const signal = options?.signal;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  const pair = readStereoPair(bytes);
  if (!pair) {
    throw new Error('No pair of views found in the Leia Image Format file');
  }

  const [left, right] = [pair.left, pair.right].map(view => URL.createObjectURL(new Blob([view], { type: 'image/jpeg' })));
  try {
    return await parseStereoPair(left, right, {
      // an angle set explicitly takes precedence over the one of the camera
      angle: options?.angle || angleOfView(pair.metadata),
      projection: options?.projection,
      signal,
      type: 'pair',
      // the metadata of the picture has nothing to add to the description of the file
      exif: {},
    });
  } finally {
    URL.revokeObjectURL(left);
    URL.revokeObjectURL(right);
  }
}

export { parseLIF, readLif, readStereoPair, angleOfView };
