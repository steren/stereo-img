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
// The most images read from an index: files of cameras hold a few of them.
const MAX_IMAGES = 64;

/**
 * Find the index of a Multi-Picture Format file.
 * @param {Uint8Array} bytes - content of the file
 * @returns {{start: number, end: number, littleEndian: boolean}|undefined} position of the header that the offsets of the index are relative to,
 *     and of the end of the segment that holds the index
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
      return { start, end: Math.min(position + 2 + length, bytes.length), littleEndian: byteOrder === 'II' };
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
  const { start, end, littleEndian } = index;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const images = [];
  try {
    // The whole index is in its segment: what points elsewhere is corrupt.
    const directory = start + view.getUint32(start + 4, littleEndian);
    if (directory + 2 > end) {
      return [];
    }
    const count = Math.min(view.getUint16(directory, littleEndian), Math.floor((end - directory - 2) / 12));
    for (let i = 0; i < count; i++) {
      const entry = directory + 2 + 12 * i;
      if (view.getUint16(entry, littleEndian) !== MP_ENTRY_TAG) {
        continue;
      }
      const length = view.getUint32(entry + 4, littleEndian);
      const entries = start + view.getUint32(entry + 8, littleEndian);
      const available = Math.max(0, Math.floor((end - entries) / MP_ENTRY_SIZE));
      const imageCount = Math.min(Math.floor(length / MP_ENTRY_SIZE), available, MAX_IMAGES);
      for (let j = 0; j < imageCount; j++) {
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
      // An index has one list of images: a repeated one is ignored.
      break;
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

const APP1 = 0xe1;
const XMP_PREFIX = 'http://ns.adobe.com/xap/1.0/\0';

/**
 * Check if a secondary JPEG inside an MPF container carries Apple Portrait
 * depth or disparity XMP metadata (apdi:AuxiliaryImageType).
 * @param {Uint8Array} jpeg - bytes of the secondary JPEG image
 * @returns {'disparity'|'depth'|undefined}
 */
function appleAuxiliaryDepthType(jpeg) {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    return;
  }
  let position = 2;
  while (position + 4 <= jpeg.length && jpeg[position] === 0xff) {
    const marker = jpeg[position + 1];
    if (marker === START_OF_SCAN) {
      break;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      position += 2;
      continue;
    }
    const length = (jpeg[position + 2] << 8) | jpeg[position + 3];
    if (length < 2 || position + 2 + length > jpeg.length) {
      break;
    }
    if (marker === APP1 && length > 2 + XMP_PREFIX.length) {
      const payloadStart = position + 4;
      const payloadEnd = position + 2 + length;
      const prefix = String.fromCharCode(...jpeg.subarray(payloadStart, payloadStart + XMP_PREFIX.length));
      if (prefix === XMP_PREFIX) {
        const xml = new TextDecoder().decode(jpeg.subarray(payloadStart + XMP_PREFIX.length, payloadEnd));
        const match = xml.match(/<apdi:AuxiliaryImageType>\s*([^<\s]+)\s*<\/apdi:AuxiliaryImageType>|apdi:AuxiliaryImageType="([^"]+)"/i);
        const auxType = match?.[1] || match?.[2];
        if (auxType) {
          const kind = auxType.match(/^(?:urn:com:apple:photo:\d+:aux:)?(disparity|depth)$/i);
          if (kind) {
            return kind[1].toLowerCase();
          }
        }
      }
    }
    position += 2 + length;
  }
}

/**
 * Extract the primary image and disparity/depth map of an MPF depth photo.
 * Stereoscopic MPO files (with 2 or more disparity views) are excluded.
 * @param {Uint8Array} bytes - content of the file
 * @returns {{ primary: Uint8Array, disparity: Uint8Array, depthType?: 'disparity'|'depth' }|undefined}
 */
function readMpoDisparity(bytes) {
  const images = readMpoIndex(bytes);
  if (images.length < 2) {
    return;
  }
  // A stereoscopic pair has 2 or more disparity views (e.g. Fuji, Panasonic).
  // A depth/disparity photo has a primary image and a secondary disparity/depth map.
  const disparityViews = images.filter(img => img.type === DISPARITY_IMAGE);
  if (disparityViews.length >= 2) {
    return;
  }
  let disparityEntry = images.slice(1).find(img => img.type === DISPARITY_IMAGE && img.offset > 0);
  let depthType = disparityEntry ? 'disparity' : undefined;
  if (!disparityEntry) {
    // Real iPhone Portrait Mode JPEGs tag auxiliary MPF images with type 0x000000
    // and identify disparity/depth via XMP apdi:AuxiliaryImageType inside the secondary JPEG.
    for (const img of images.slice(1)) {
      if (img.offset <= 0) continue;
      const slice = bytes.subarray(img.offset, img.offset + img.size);
      const kind = appleAuxiliaryDepthType(slice);
      if (kind) {
        disparityEntry = img;
        depthType = kind;
        break;
      }
    }
  }
  if (!disparityEntry) {
    return;
  }
  const primary = bytes.subarray(images[0].offset, images[0].offset + images[0].size);
  const disparity = bytes.subarray(disparityEntry.offset, disparityEntry.offset + disparityEntry.size);
  return { primary, disparity, depthType };
}

export { parseMPO, readMpoIndex, readStereoPair, readMpoDisparity };
