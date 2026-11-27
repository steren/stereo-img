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
 * Parser for PNG Stereoscopic files (.pns) and PNG files containing the
 * registered ancillary 'sTER' chunk.
 *
 * Specification: Extensions to the PNG 1.2 Specification, Section 3.5 (sTER Indicator of Stereo Image)
 * http://www.libpng.org/pub/png/spec/register/pdg/rfc-stereopng.html
 */

import { pixelReader } from '../../lib/pixels.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Calculates standard IEEE 802.3 CRC-32 checksum used by PNG chunks.
 * @param {Uint8Array} bytes
 * @returns {number} 32-bit unsigned integer CRC
 */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Reads the sTER ancillary chunk from a PNG byte array.
 * Scans chunks from byte offset 8 (after PNG signature) before the first IDAT chunk.
 *
 * @param {Uint8Array} bytes - Raw bytes of the PNG file.
 * @returns {Object|null} Object { hasSter: true, mode, type } or null if absent before IDAT.
 */
export function readSterChunk(bytes) {
  if (!bytes || bytes.length < 8) {
    throw new Error('Not a valid PNG: truncated header');
  }

  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Not a valid PNG: invalid signature');
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false);
    if (offset + 8 + length + 4 > bytes.length) {
      throw new Error('Truncated PNG chunk');
    }

    const chunkType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );

    if (chunkType === 'sTER') {
      if (length < 1) {
        throw new Error('Invalid sTER chunk length');
      }

      const storedCrc = view.getUint32(offset + 8 + length, false);
      const chunkTypeAndData = bytes.subarray(offset + 4, offset + 8 + length);
      const actualCrc = crc32(chunkTypeAndData);

      if (storedCrc !== actualCrc) {
        throw new Error('Corrupted sTER chunk: CRC-32 checksum mismatch');
      }

      const mode = bytes[offset + 8];
      // Mode 0: Cross-fuse layout (right-left)
      // Mode 1: Diverging-fuse layout (left-right)
      // Mode 255 / other: Default fallback to diverging-fuse (left-right)
      const type = mode === 0 ? 'right-left' : 'left-right';

      return {
        hasSter: true,
        mode,
        type,
      };
    }

    if (chunkType === 'IDAT') {
      // Per PNG specification, sTER must precede the first IDAT chunk.
      break;
    }

    offset += 8 + length + 4;
  }

  return null;
}

/**
 * Calculates subimage bounds and Adam7 interlacing padding for a PNG stereo pair.
 *
 * Formula per PNG extension specification:
 * k = ceil(width / 16)
 * xRight = 8 * k
 * subWidth = width - xRight
 * padding = xRight - subWidth
 *
 * @param {number} width - Canvas pixel width
 * @param {number} height - Canvas pixel height
 * @returns {{ subWidth: number, leftBounds: { x: number, y: number, width: number, height: number }, rightBounds: { x: number, y: number, width: number, height: number }, padding: number }}
 */
export function calculateSubimageBounds(width, height) {
  const k = Math.ceil(width / 16);
  const xRight = 8 * k;
  const subWidth = width - xRight;
  const padding = xRight - subWidth;

  if (subWidth <= 0 || xRight >= width || padding < 0 || padding >= 8) {
    const halfWidth = Math.floor(width / 2);
    return {
      subWidth: halfWidth,
      leftBounds: { x: 0, y: 0, width: halfWidth, height },
      rightBounds: { x: width - halfWidth, y: 0, width: halfWidth, height },
      padding: 0,
    };
  }

  return {
    subWidth,
    leftBounds: { x: 0, y: 0, width: subWidth, height },
    rightBounds: { x: xRight, y: 0, width: subWidth, height },
    padding,
  };
}

/**
 * Loads an image from a URL or Data URL with AbortSignal cancellation support.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<HTMLImageElement>}
 */
async function createImageFromURL(url, signal) {
  signal?.throwIfAborted();
  const image = new Image();
  image.src = url;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      reject(signal.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    image.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(image);
    };
    image.onerror = (error) => {
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    };
  });
}

/**
 * Fetches and parses a PNG Stereoscopic image (.pns or PNG with sTER chunk).
 *
 * @param {string} url - URL or data URI of the PNG picture.
 * @param {Object} [options] - Parsing options (signal, angle, projection, bytes, etc.).
 * @returns {Promise<Object>} The StereoData structure.
 */
export async function parsePNS(url, options = {}) {
  const signal = options?.signal;
  signal?.throwIfAborted();

  let bytes = options?.bytes;
  if (!bytes) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Could not fetch ${url}: ${response.status}`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  signal?.throwIfAborted();

  // Validate PNG signature & read sTER chunk
  const ster = readSterChunk(bytes);
  // Unadorned .pns files without an sTER chunk default to cross-eyed (right-left), matching .jps.
  const type = options?.type || ster?.type || 'right-left';

  // Read dimensions from PNG IHDR chunk if available
  let ihdrWidth = 0;
  let ihdrHeight = 0;
  if (bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    ihdrWidth = view.getUint32(16, false);
    ihdrHeight = view.getUint32(20, false);
  }

  const bounds = calculateSubimageBounds(ihdrWidth, ihdrHeight);

  // If no Adam7 padding (padding === 0), delegate directly to standard stereo parser
  if (bounds.padding === 0) {
    const { parseStereo } = await import('../stereo-parser/stereo-parser.js');
    return parseStereo(url, { ...options, type });
  }

  // Padding exists (padding > 0): slice subimages excluding padding columns
  const image = await createImageFromURL(url, signal);
  const read = pixelReader(image);

  const actualBounds = (image.width === ihdrWidth && image.height === ihdrHeight)
    ? bounds
    : calculateSubimageBounds(image.width, image.height);

  const leftCrop = read(
    actualBounds.leftBounds.x,
    actualBounds.leftBounds.y,
    actualBounds.leftBounds.width,
    actualBounds.leftBounds.height
  );
  const rightCrop = read(
    actualBounds.rightBounds.x,
    actualBounds.rightBounds.y,
    actualBounds.rightBounds.width,
    actualBounds.rightBounds.height
  );

  let leftEye;
  let rightEye;
  if (type === 'right-left') {
    leftEye = rightCrop;
    rightEye = leftCrop;
  } else {
    leftEye = leftCrop;
    rightEye = rightCrop;
  }

  const { anglesOfView } = await import('../stereo-parser/stereo-parser.js');
  const angles = anglesOfView(actualBounds.subWidth, image.height, options);

  return {
    leftEye,
    rightEye,
    ...angles,
    projection: options?.projection,
  };
}

export const parsePNGStereo = parsePNS;
export default parsePNS;
