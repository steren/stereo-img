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

// Auxiliary type strings for Apple Portrait depth / disparity maps
const DISPARITY_AUX_URNS = [
  'urn:com:apple:photo:2018:aux:disparity',
];

const METRIC_DEPTH_AUX_URNS = [
  'urn:com:apple:photo:2018:aux:depth',
  'urn:mpeg:mpegB:cicp:systems:auxiliary:depth',
];

const HEVC_AUX_DEPTH_URN = 'urn:mpeg:hevc:2015:auxid:2';

/**
 * Inspect an HEVC auxC aux_subtype payload for depth_representation_info SEI (payloadType 177).
 * Returns 'disparity' when d_min_flag / d_max_flag are set without z_near_flag / z_far_flag.
 * @param {Uint8Array|undefined} auxSubtype
 * @returns {'disparity'|'depth'}
 */
function getHevcAuxDepthType(auxSubtype) {
  if (auxSubtype && auxSubtype.length >= 13) {
    for (let i = 0; i + 4 < auxSubtype.length; i++) {
      // HEVC PREFIX_SEI_NUT (nal_unit_type 39 -> 0x4e 0x01) with depth_representation_info (177 = 0xb1)
      if (auxSubtype[i] === 0x4e && auxSubtype[i + 1] === 0x01 && auxSubtype[i + 2] === 0xb1) {
        const flagsByte = auxSubtype[i + 4];
        const hasZ = (flagsByte & 0xc0) !== 0;
        const hasD = (flagsByte & 0x30) !== 0;
        if (hasD && !hasZ) {
          return 'disparity';
        }
        return 'depth';
      }
    }
  }
  return 'depth';
}

/**
 * Classify an auxiliary item URN as 'disparity' (higher = closer),
 * 'depth' (metric depth, higher = farther), or null (not a depth/disparity map).
 * @param {string} urn
 * @param {Uint8Array} [auxSubtype]
 * @returns {'disparity'|'depth'|null}
 */
function getDepthAuxType(urn, auxSubtype) {
  if (DISPARITY_AUX_URNS.includes(urn)) {
    return 'disparity';
  }
  if (METRIC_DEPTH_AUX_URNS.includes(urn)) {
    return 'depth';
  }
  if (urn === HEVC_AUX_DEPTH_URN) {
    return getHevcAuxDepthType(auxSubtype);
  }
  if (!urn.includes('matte') && !urn.includes('gainmap') && !urn.includes('hdr')) {
    if (urn.includes(':aux:disparity')) {
      return 'disparity';
    }
    if (urn.includes(':aux:depth') || urn.endsWith(':depth')) {
      return 'depth';
    }
  }
  return null;
}

function isDepthAuxType(urn) {
  return getDepthAuxType(urn) !== null;
}

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
 * Read the structure of a HEIC file: its primary image, stereo pair, and depth item if any.
 * @param {Uint8Array} bytes - content of the file
 * @returns {{primary: number|undefined, stereoPair: Array<number>|undefined, depth?: number, depthType?: 'disparity'|'depth'}|undefined} IDs of the images. Undefined if the file is not a HEIC file.
 */
function readHeic(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return;
  }
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
    const auxRefs = [];
    const depthPropTypes = new Map();
    const itemProperties = new Map();
    let hasNonDepthAuxC = false;

    // "meta" is a full box: a version and flags precede its boxes.
    for (const box of readBoxes(view, meta.start + 4, meta.end)) {
      if (box.type === 'pitm' && box.start + 4 <= box.end) {
        const version = view.getUint8(box.start);
        if (version === 0 && box.start + 6 <= box.end) {
          result.primary = view.getUint16(box.start + 4);
        } else if (version !== 0 && box.start + 8 <= box.end) {
          result.primary = view.getUint32(box.start + 4);
        }
      } else if (box.type === 'grpl') {
        const ster = readBoxes(view, box.start, box.end).find(group => group.type === 'ster');
        // version and flags, group ID, number of entities, then the entities: the left view first
        if (ster && ster.start + 20 <= ster.end && view.getUint32(ster.start + 8) >= 2) {
          result.stereoPair = [view.getUint32(ster.start + 12), view.getUint32(ster.start + 16)];
        }
      } else if (box.type === 'iref' && box.start + 4 <= box.end) {
        const version = view.getUint8(box.start);
        for (const refBox of readBoxes(view, box.start + 4, box.end)) {
          if (refBox.type === 'auxl') {
            if (version === 0 && refBox.start + 4 <= refBox.end) {
              const from = view.getUint16(refBox.start);
              const count = view.getUint16(refBox.start + 2);
              for (let r = 0; r < count && refBox.start + 4 + 2 * (r + 1) <= refBox.end; r++) {
                const to = view.getUint16(refBox.start + 4 + 2 * r);
                auxRefs.push({ from, to });
              }
            } else if (version >= 1 && refBox.start + 6 <= refBox.end) {
              const from = view.getUint32(refBox.start);
              const count = view.getUint16(refBox.start + 4);
              for (let r = 0; r < count && refBox.start + 6 + 4 * (r + 1) <= refBox.end; r++) {
                const to = view.getUint32(refBox.start + 6 + 4 * r);
                auxRefs.push({ from, to });
              }
            }
          }
        }
      } else if (box.type === 'iprp') {
        for (const child of readBoxes(view, box.start, box.end)) {
          if (child.type === 'ipco') {
            const props = readBoxes(view, child.start, child.end);
            for (let i = 0; i < props.length; i++) {
              const prop = props[i];
              const propIndex = i + 1; // 1-based index
              if (prop.type === 'auxC' && prop.start + 4 <= prop.end) {
                // auxC is FullBox: skip 4-byte version and flags
                let endStr = prop.start + 4;
                while (endStr < prop.end && bytes[endStr] !== 0) {
                  endStr++;
                }
                const auxType = new TextDecoder('latin1').decode(bytes.subarray(prop.start + 4, endStr));
                const auxSubtype = endStr + 1 < prop.end ? bytes.subarray(endStr + 1, prop.end) : undefined;
                const depthType = getDepthAuxType(auxType, auxSubtype);
                if (depthType) {
                  depthPropTypes.set(propIndex, depthType);
                } else {
                  hasNonDepthAuxC = true;
                }
              }
            }
          } else if (child.type === 'ipma' && child.start + 8 <= child.end) {
            const version = view.getUint8(child.start);
            const flags = (view.getUint8(child.start + 1) << 16) | (view.getUint8(child.start + 2) << 8) | view.getUint8(child.start + 3);
            const entryCount = view.getUint32(child.start + 4);
            let offset = child.start + 8;
            for (let i = 0; i < entryCount && offset < child.end; i++) {
              let itemId;
              if (version === 0) {
                if (offset + 2 > child.end) break;
                itemId = view.getUint16(offset);
                offset += 2;
              } else {
                if (offset + 4 > child.end) break;
                itemId = view.getUint32(offset);
                offset += 4;
              }
              if (offset + 1 > child.end) break;
              const assocCount = view.getUint8(offset);
              offset += 1;
              const itemProps = itemProperties.get(itemId) || new Set();
              for (let j = 0; j < assocCount && offset < child.end; j++) {
                let propIndex;
                if (flags & 1) {
                  if (offset + 2 > child.end) break;
                  propIndex = view.getUint16(offset) & 0x7fff;
                  offset += 2;
                } else {
                  if (offset + 1 > child.end) break;
                  propIndex = view.getUint8(offset) & 0x7f;
                  offset += 1;
                }
                itemProps.add(propIndex);
              }
              itemProperties.set(itemId, itemProps);
            }
          }
        }
      }
    }

    // Resolve auxiliary depth item ID
    const depthCandidates = [];
    for (const [itemId, props] of itemProperties.entries()) {
      for (const propIdx of props) {
        if (depthPropTypes.has(propIdx)) {
          depthCandidates.push({ itemId, depthType: depthPropTypes.get(propIdx) });
          break;
        }
      }
    }
    let depthId;
    let depthType;
    if (depthCandidates.length > 0) {
      const chosen =
        (result.primary !== undefined &&
          depthCandidates.find(c => auxRefs.some(ref => ref.from === c.itemId && ref.to === result.primary))) ||
        depthCandidates.find(c => auxRefs.some(ref => ref.from === c.itemId)) ||
        depthCandidates[0];
      depthId = chosen.itemId;
      depthType = chosen.depthType;
    } else if (depthPropTypes.size > 0 && auxRefs.length > 0 && !hasNonDepthAuxC) {
      const chosenRef =
        (result.primary !== undefined && auxRefs.find(ref => ref.to === result.primary)) ||
        auxRefs[0];
      depthId = chosenRef.from;
      depthType = depthPropTypes.values().next().value;
    }
    if (depthId !== undefined && !result.stereoPair) {
      result.depth = depthId;
      result.depthType = depthType;
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
 * Invert RGB grayscale values of a disparity image (higher = closer)
 * to metric depth polarity (0 = near, 255 = far) expected by stereo-img.js / Three.js displacement mapping.
 * @param {ImageData} imageData
 * @returns {ImageData}
 */
function invertDepthData(imageData) {
  const data = imageData?.data;
  if (!data || (!ArrayBuffer.isView(data) && !Array.isArray(data))) {
    return imageData;
  }
  const limit = data.length - (data.length % 4);
  for (let i = 0; i < limit; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  return imageData;
}

function imageDataToCanvas(imageData) {
  if (typeof document === 'undefined') {
    return imageData;
  }
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (ctx && ctx.putImageData) {
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }
  return imageData;
}

/**
 * Fetch a HEIC picture and return its left and right eye images.
 * A picture that is not a stereo pair is shown the same to both eyes.
 * @param {string} url - image url
 * @param {Object} [options] - Parsing options: angle, projection, signal: AbortSignal to cancel the parsing
 */
async function parseHEIC(url, options) {
  const signal = options?.signal;
  signal?.throwIfAborted();
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error(`Invalid or missing URL: ${url}`);
  }
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
  let depth;
  try {
    const error = lib.heif_context_read_from_memory(context, bytes);
    if (error.code !== lib.heif_error_code.heif_error_Ok) {
      throw new Error(`Could not read the HEIC file: ${error.message}`);
    }
    if (structure.stereoPair) {
      leftEye = decodeImage(lib, context, structure.stereoPair[0]);
      signal?.throwIfAborted();
      rightEye = decodeImage(lib, context, structure.stereoPair[1]);
    } else if (structure.depth) {
      const primary = structure.primary ?? lib.heif_js_context_get_list_of_top_level_image_IDs(context)[0];
      leftEye = decodeImage(lib, context, primary);
      rightEye = leftEye;
      signal?.throwIfAborted();
      const depthImage = decodeImage(lib, context, structure.depth);
      if (structure.depthType === 'disparity') {
        invertDepthData(depthImage);
      }
      depth = imageDataToCanvas(depthImage);
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

  const projection = !structure.depth && options?.projection === 'fisheye' ? 'fisheye' : undefined;
  const angles = anglesOfView(leftEye.width, leftEye.height, { angle: options?.angle, projection, exif });
  return { leftEye, rightEye, ...(depth ? { depth } : {}), ...angles, projection };
}

export { parseHEIC, readHeic, invertDepthData };
