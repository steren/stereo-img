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
 * Parser for HEIC pictures, as the spatial photos of the Apple Vision Pro and of iPhones.
 * Such a file holds two images, and a "stereo pair" group that tells which one is for the left eye
 * and which one for the right eye.
 *
 * Specification: ISO/IEC 23008-12 (HEIF), the "ster" entity group.
 * Most browsers cannot decode HEIC pictures: libheif, compiled to WebAssembly, decodes them.
 * It is only downloaded for HEIC pictures.
 */

import exifr from './../../vendor/exifr/full.esm.js';
import { anglesOfView } from './../stereo-parser/stereo-parser.js';

// Brands of the "ftyp" box of HEIF files whose images are HEVC encoded: the ones libheif decodes here.
const HEIC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'mif2'];

/**
 * Read the boxes of a part of a file.
 * @param {DataView} view - the file
 * @param {number} start - where the boxes start
 * @param {number} end - where they end
 * @returns {Array<{type: string, start: number, end: number}>} each box: its type, and where its content starts and ends
 */
function readBoxes(view, start, end) {
  const boxes = [];
  let position = start;
  while (position + 8 <= end) {
    let size = view.getUint32(position);
    const type = String.fromCharCode(
      view.getUint8(position + 4), view.getUint8(position + 5), view.getUint8(position + 6), view.getUint8(position + 7));
    let header = 8;
    if (size === 1) {
      // 64-bit size
      if (position + 16 > end) {
        break;
      }
      size = Number(view.getBigUint64(position + 8));
      header = 16;
    } else if (size === 0) {
      // up to the end
      size = end - position;
    }
    if (size < header || position + size > end) {
      break;
    }
    boxes.push({ type, start: position + header, end: position + size });
    position += size;
  }
  return boxes;
}

/**
 * Read the structure of a HEIC file: its primary image and its stereo pair, if any.
 * @param {Uint8Array} bytes - content of the file
 * @returns {{primary: number|undefined, stereoPair: Array<number>|undefined}|undefined} IDs of the images. Undefined if the file is not a HEIC file.
 */
function readHeic(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const boxes = readBoxes(view, 0, bytes.length);
    const ftyp = boxes[0]?.type === 'ftyp' ? boxes[0] : null;
    if (!ftyp) {
      return;
    }
    // major brand, minor version, then compatible brands
    const brandAt = position => String.fromCharCode(...bytes.subarray(position, position + 4));
    const major = brandAt(ftyp.start);
    const brands = [major];
    for (let position = ftyp.start + 8; position + 4 <= ftyp.end; position += 4) {
      brands.push(brandAt(position));
    }
    // AVIF files are HEIF files too, of AV1 images
    if (major.startsWith('avi') || !brands.some(brand => HEIC_BRANDS.includes(brand))) {
      return;
    }
    const result = { primary: undefined, stereoPair: undefined };
    const meta = boxes.find(box => box.type === 'meta');
    if (!meta) {
      return result;
    }
    // "meta" is a full box: a version and flags precede its boxes.
    for (const box of readBoxes(view, meta.start + 4, meta.end)) {
      if (box.type === 'pitm') {
        const version = view.getUint8(box.start);
        result.primary = version === 0 ? view.getUint16(box.start + 4) : view.getUint32(box.start + 4);
      } else if (box.type === 'grpl') {
        const ster = readBoxes(view, box.start, box.end).find(group => group.type === 'ster');
        // version and flags, group ID, number of entities, then the entities: the left view first
        if (ster && ster.start + 20 <= ster.end && view.getUint32(ster.start + 8) >= 2) {
          result.stereoPair = [view.getUint32(ster.start + 12), view.getUint32(ster.start + 16)];
        }
      }
    }
    return result;
  } catch (e) {
    // truncated file
    return;
  }
}

let libheif = null;
/** Download and start libheif, once. */
function loadLibheif() {
  libheif ||= import('./../../vendor/libheif/libheif-bundle.mjs').then(module => module.default());
  return libheif;
}

/**
 * Decode an image of a HEIC file.
 * @param {Object} lib - libheif
 * @param {Object} context - the file, read by libheif
 * @param {number} id - ID of the image
 * @returns {ImageData} its pixels
 */
function decodeImage(lib, context, id) {
  const handle = lib.heif_js_context_get_image_handle(context, id);
  if (!handle || handle.code) {
    throw new Error(`Could not find image ${id} of the HEIC file: ${handle?.message}`);
  }
  try {
    const decoded = lib.heif_js_decode_image2(handle, lib.heif_colorspace.heif_colorspace_RGB, lib.heif_chroma.heif_chroma_interleaved_RGBA);
    if (!decoded || decoded.code) {
      throw new Error(`Could not decode image ${id} of the HEIC file: ${decoded?.message}`);
    }
    try {
      const channel = decoded.channels.find(channel => channel.id === lib.heif_channel.heif_channel_interleaved);
      const { width, height, stride, data } = channel;
      const pixels = new ImageData(width, height);
      for (let y = 0; y < height; y++) {
        pixels.data.set(data.subarray(y * stride, y * stride + width * 4), y * width * 4);
      }
      return pixels;
    } finally {
      lib.heif_image_release(decoded.image);
    }
  } finally {
    lib.heif_image_handle_release(handle);
  }
}

/**
 * Fetch a HEIC picture and return its left and right eye images.
 * A picture that is not a stereo pair is shown the same to both eyes.
 * @param {string} url - image url
 * @param {Object} [options] - Parsing options: angle, projection, signal: AbortSignal to cancel the parsing
 */
async function parseHEIC(url, options) {
  const signal = options?.signal;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  const structure = readHeic(bytes);
  if (!structure) {
    throw new Error('Not a HEIC file');
  }

  let exif = {};
  try {
    exif = await exifr.parse(bytes, { xmp: true }) || {};
  } catch (e) {
    // ignore
  }

  const lib = await loadLibheif();
  signal?.throwIfAborted();

  const context = lib.heif_context_alloc();
  let leftEye;
  let rightEye;
  try {
    const error = lib.heif_context_read_from_memory(context, bytes);
    if (error.code !== lib.heif_error_code.heif_error_Ok) {
      throw new Error(`Could not read the HEIC file: ${error.message}`);
    }
    if (structure.stereoPair) {
      leftEye = decodeImage(lib, context, structure.stereoPair[0]);
      signal?.throwIfAborted();
      rightEye = decodeImage(lib, context, structure.stereoPair[1]);
    } else {
      console.info('<stereo-img> The HEIC picture is not a stereo pair. Displaying as mono.');
      const primary = structure.primary ?? lib.heif_js_context_get_list_of_top_level_image_IDs(context)[0];
      leftEye = decodeImage(lib, context, primary);
      rightEye = leftEye;
    }
  } finally {
    lib.heif_context_free(context);
  }
  signal?.throwIfAborted();

  const projection = options?.projection === 'fisheye' ? 'fisheye' : undefined;
  const angles = anglesOfView(leftEye.width, leftEye.height, { angle: options?.angle, projection, exif });
  return { leftEye, rightEye, ...angles, projection };
}

export { parseHEIC, readHeic };
