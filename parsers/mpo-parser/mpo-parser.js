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
 * Parser for Multi-Picture Format files (.mpo): several JPEG images in one
 * file. The first one holds an index of all of them. Stereo cameras store the
 * left and right pictures this way.
 *
 * Specification: CIPA DC-007, https://www.cipa.jp/std/documents/e/DC-X007-KEY_E.pdf
 */

import exifr from './../../vendor/exifr/full.esm.js';
import { parseStereoPair } from './../stereo-parser/stereo-parser.js';

const APP2 = 0xe2;
const START_OF_SCAN = 0xda;
const MP_ENTRY_TAG = 0xb002;
const MP_ENTRY_SIZE = 16;
// Type of an image of the file, in the lower 24 bits of its attribute:
// one of the views of a stereoscopic picture.
const DISPARITY_IMAGE = 0x020002;

/**
 * Find the index of a Multi-Picture Format file.
 * @param {Uint8Array} bytes - content of the file
 * @returns {{start: number, littleEndian: boolean}|undefined} position of the header that the offsets of the index are relative to
 */
function findIndex(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return;
  }
  // Walk the segments of the first image, up to its pixels.
  let position = 2;
  while (position + 4 <= bytes.length && bytes[position] === 0xff) {
    const marker = bytes[position + 1];
    if (marker === START_OF_SCAN) {
      return;
    }
    const length = (bytes[position + 2] << 8) | bytes[position + 3];
    const isIndex = marker === APP2
      && bytes[position + 4] === 0x4d && bytes[position + 5] === 0x50 && bytes[position + 6] === 0x46 && bytes[position + 7] === 0; // "MPF\0"
    if (isIndex) {
      const start = position + 8;
      const byteOrder = String.fromCharCode(bytes[start], bytes[start + 1]);
      if (byteOrder !== 'II' && byteOrder !== 'MM') {
        return;
      }
      return { start, littleEndian: byteOrder === 'II' };
    }
    position += 2 + length;
  }
}

/**
 * List the images of a Multi-Picture Format file.
 * @param {Uint8Array} bytes - content of the file
 * @returns {Array<{type: number, offset: number, size: number}>} the images, in the order of the index. Empty if the file has no index.
 */
function readMpoIndex(bytes) {
  const index = findIndex(bytes);
  if (!index) {
    return [];
  }
  const { start, littleEndian } = index;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const images = [];
  try {
    const directory = start + view.getUint32(start + 4, littleEndian);
    const count = view.getUint16(directory, littleEndian);
    for (let i = 0; i < count; i++) {
      const entry = directory + 2 + 12 * i;
      if (view.getUint16(entry, littleEndian) !== MP_ENTRY_TAG) {
        continue;
      }
      const length = view.getUint32(entry + 4, littleEndian);
      const entries = start + view.getUint32(entry + 8, littleEndian);
      for (let j = 0; j < length / MP_ENTRY_SIZE; j++) {
        const image = entries + MP_ENTRY_SIZE * j;
        const attribute = view.getUint32(image, littleEndian);
        const size = view.getUint32(image + 4, littleEndian);
        const relativeOffset = view.getUint32(image + 8, littleEndian);
        // The first image is at the start of the file. The others are located from the header of the index.
        const offset = relativeOffset === 0 ? 0 : start + relativeOffset;
        const isJpeg = offset + size <= bytes.length && bytes[offset] === 0xff && bytes[offset + 1] === 0xd8;
        if (size > 0 && isJpeg) {
          images.push({ type: attribute & 0xffffff, offset, size });
        }
      }
    }
  } catch (e) {
    // truncated index: keep what was read
  }
  return images;
}

/**
 * Extract the two views of a stereoscopic Multi-Picture Format file.
 * Other images of the file, such as large previews, are ignored.
 * @param {Uint8Array} bytes - content of the file
 * @returns {Array<Uint8Array>} the JPEG images of the left and right views, or an empty array if the file is not stereoscopic
 */
function readStereoPair(bytes) {
  const views = readMpoIndex(bytes).filter(image => image.type === DISPARITY_IMAGE);
  if (views.length < 2) {
    return [];
  }
  // Views are stored from left to right.
  return views.slice(0, 2).map(({ offset, size }) => bytes.subarray(offset, offset + size));
}

/**
 * Fetch a Multi-Picture Format file and return its left and right eye images.
 * @param {string} url - image url
 * @param {Object} [options] - Parsing options: angle, projection, signal: AbortSignal to cancel the parsing
 */
async function parseMPO(url, options) {
  const signal = options?.signal;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  const views = readStereoPair(bytes);
  if (views.length < 2) {
    throw new Error('No stereoscopic pair of pictures found in the Multi-Picture Format file');
  }

  // The metadata of the first picture describes the camera.
  let exif = {};
  try {
    exif = await exifr.parse(views[0], { xmp: true, multiSegment: true }) || {};
  } catch (e) {
    // ignore
  }
  signal?.throwIfAborted();

  const [left, right] = views.map(view => URL.createObjectURL(new Blob([view], { type: 'image/jpeg' })));
  try {
    return await parseStereoPair(left, right, { angle: options?.angle, projection: options?.projection, signal, type: 'pair', exif });
  } finally {
    URL.revokeObjectURL(left);
    URL.revokeObjectURL(right);
  }
}

export { parseMPO, readMpoIndex, readStereoPair };
