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

import exifr from './../../vendor/exifr/full.esm.js';
import { anglesOfView } from './../stereo-parser/stereo-parser.js';
import { pixelReader } from './../../lib/pixels.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Normalize an RGB-D type or layout alias to canonical RGB-D type strings.
 * @param {string} [typeOrLayout]
 * @returns {'rgbd'|'rgbd-left-right'|'rgbd-right-left'|'rgbd-top-bottom'|'rgbd-bottom-top'}
 */
function normalizeRgbdType(typeOrLayout) {
  if (typeof typeOrLayout !== 'string') {
    return 'rgbd';
  }
  const normalized = typeOrLayout.trim().toLowerCase();
  switch (normalized) {
    case 'rgbd-sbs':
    case 'rgbd-left-right':
    case 'left-right':
    case 'sbs':
      return 'rgbd-left-right';
    case 'rgbd-right-left':
    case 'right-left':
      return 'rgbd-right-left';
    case 'rgbd-ou':
    case 'rgbd-tb':
    case 'rgbd-top-bottom':
    case 'top-bottom':
    case 'ou':
    case 'tb':
      return 'rgbd-top-bottom';
    case 'rgbd-bottom-top':
    case 'bottom-top':
      return 'rgbd-bottom-top';
    case 'rgbd':
    default:
      return 'rgbd';
  }
}

/**
 * Resolve an RGB-D layout (selecting horizontal vs vertical by aspect ratio when 'rgbd').
 * @param {string} [typeOrLayout]
 * @param {number} width
 * @param {number} height
 * @returns {'rgbd-left-right'|'rgbd-right-left'|'rgbd-top-bottom'|'rgbd-bottom-top'}
 */
function resolveRgbdLayout(typeOrLayout, width, height) {
  const normalized = normalizeRgbdType(typeOrLayout);
  if (normalized === 'rgbd') {
    return width >= height ? 'rgbd-left-right' : 'rgbd-top-bottom';
  }
  return normalized;
}

function isHorizontalLayout(layout) {
  return layout === 'rgbd-left-right' || layout === 'rgbd-right-left';
}

function validateDimensions(width, height, typeOrLayout) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error(`Invalid RGB-D image dimensions: ${width}x${height}`);
  }
  const layout = resolveRgbdLayout(typeOrLayout, width, height);
  if (isHorizontalLayout(layout) && width < 2) {
    throw new Error('RGB-D side-by-side image width must be at least 2 pixels');
  }
  if (!isHorizontalLayout(layout) && height < 2) {
    throw new Error('RGB-D top-bottom image height must be at least 2 pixels');
  }
  return layout;
}

function decodeBase64Prefix(str, startIndex = 0, maxChars = 48) {
  const targetLen = maxChars - (maxChars % 4);
  const len = str.length;
  let i = startIndex;
  const wsLimit = Math.min(len, startIndex + 4096);
  while (i < wsLimit && /\s/.test(str[i])) {
    i++;
  }
  const scanEnd = Math.min(len, i + 4096);
  let clean = '';
  for (; i < scanEnd && clean.length < targetLen; i++) {
    const ch = str[i];
    if (!/\s/.test(ch)) {
      clean += ch;
    }
  }
  const sliceLen = clean.length >= targetLen ? targetLen : clean.length;
  const chunk = clean.slice(0, sliceLen);
  if (!chunk) {
    return null;
  }
  if (typeof atob === 'function') {
    const bin = atob(chunk);
    const out = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) {
      out[j] = bin.charCodeAt(j);
    }
    return out;
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(chunk, 'base64'));
  }
  return null;
}

function decodeDataUrlBytes(url) {
  if (typeof url !== 'string') {
    return null;
  }
  const match = url.match(/^\s*data:[^;,]+(?:;[^;,]*)*;base64,/i);
  if (!match) {
    return null;
  }
  const payload = url.slice(match[0].length);
  if (!payload) {
    return null;
  }
  try {
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(payload, 'base64');
      return buf.length > 0 ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : null;
    }
    if (typeof atob === 'function') {
      const bin = atob(payload.replace(/\s+/g, ''));
      if (bin.length === 0) {
        return null;
      }
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
      }
      return out;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function readPngDimensions(bytes) {
  if (!bytes || bytes.length < 24) {
    return null;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return null;
    }
  }
  // Verify 'IHDR' chunk type at offset 12..15
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}

function assertCompletePng(bytes) {
  if (!bytes || bytes.length < 4) {
    return;
  }
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return;
  }
  if (bytes.length < PNG_SIGNATURE.length) {
    throw new Error('Truncated or invalid image data: missing IEND chunk');
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Truncated or invalid image data: missing IEND chunk');
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const len = view.getUint32(offset, false);
    if (len > bytes.length - offset - 12) {
      break;
    }
    if (
      bytes[offset + 4] === 0x49 &&
      bytes[offset + 5] === 0x45 &&
      bytes[offset + 6] === 0x4e &&
      bytes[offset + 7] === 0x44
    ) {
      return;
    }
    offset += 12 + len;
  }
  throw new Error('Truncated or invalid image data: missing IEND chunk');
}

async function readHeaderBytes(url, options) {
  if (options?.bytes) {
    return {
      bytes: options.bytes instanceof Uint8Array ? options.bytes : new Uint8Array(options.bytes),
      isPrefix: false,
    };
  }
  if (typeof url === 'string') {
    const prefixMatch = url.match(/^\s*data:image\/png(?:;[^,]*)?;base64,/i);
    if (prefixMatch) {
      try {
        return {
          bytes: decodeBase64Prefix(url, prefixMatch[0].length, 48),
          isPrefix: true,
        };
      } catch (e) {
        return { bytes: null, isPrefix: true };
      }
    }
    if (typeof fetch === 'function') {
      try {
        const response = await fetch(url, { signal: options?.signal });
        if (response?.ok) {
          return {
            bytes: new Uint8Array(await response.arrayBuffer()),
            isPrefix: false,
          };
        }
      } catch (e) {
        if (options?.signal?.aborted) {
          throw e;
        }
      }
    }
  }
  return { bytes: null, isPrefix: false };
}

async function createImageFromURL(url, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'Anonymous';
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
    image.onerror = (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err instanceof Error ? err : new Error(`Failed to load RGB-D image: ${url}`));
    };
    image.src = url;
  });
}

function getPixelReader(image, width, height) {
  if (image.width !== width) {
    try {
      image.width = width;
    } catch (e) {
      // read-only property
    }
  }
  if (image.height !== height) {
    try {
      image.height = height;
    } catch (e) {
      // read-only property
    }
  }
  if (image.width === width && image.height === height) {
    return pixelReader(image);
  }
  // Fallback when image.width/height are read-only and differ from naturalWidth/naturalHeight
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return (x, y, w, h) => ctx.getImageData(x, y, w, h);
}

/**
 * Convert an RGB depth ImageData slice to grayscale luminance and normalize
 * polarity to metric depth (0 = near, 255 = far) expected by stereo-img.js.
 * Standard RGB-D composites encode 255 = near, 0 = far, so luminance is inverted
 * by default unless options.invertDepth === false or options.polarity === 'depth'.
 * @param {ImageData} depthPart
 * @param {Object} [options]
 * @returns {ImageData}
 */
function toDepthMap(depthPart, options = {}) {
  const dData = depthPart?.data;
  if (!dData || (!ArrayBuffer.isView(dData) && !Array.isArray(dData))) {
    return depthPart;
  }
  const invertDepth = options?.invertDepth !== false && options?.polarity !== 'depth';
  const limit = dData.length - (dData.length % 4);
  for (let i = 0; i < limit; i += 4) {
    const luma = Math.round((dData[i] * 299 + dData[i + 1] * 587 + dData[i + 2] * 114) / 1000);
    const value = invertDepth ? 255 - luma : luma;
    dData[i] = value;
    dData[i + 1] = value;
    dData[i + 2] = value;
  }
  return depthPart;
}

/**
 * Convert an ImageData object to an HTMLCanvasElement when a 2D canvas DOM is available,
 * falling back to returning the ImageData itself otherwise.
 * @param {ImageData} imageData
 * @returns {HTMLCanvasElement|ImageData}
 */
function imageDataToCanvas(imageData) {
  if (
    typeof document === 'undefined' ||
    !imageData ||
    !Number.isFinite(imageData.width) ||
    !Number.isFinite(imageData.height) ||
    imageData.width <= 0 ||
    imageData.height <= 0
  ) {
    return imageData;
  }
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (ctx && typeof ctx.putImageData === 'function') {
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }
  return imageData;
}

function assignDefined(target, source) {
  if (source && typeof source === 'object') {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) {
        target[key] = value;
      }
    }
  }
  return target;
}

/**
 * Parse a composite RGB-D (color + depth map) image from a URL or Data URI.
 * @param {string} url - Image URL or data URI
 * @param {Object} [options] - Parsing options: type, layout, angle, signal, bytes, exif, invertDepth, polarity
 * @returns {Promise<Object>} StereoData containing leftEye, rightEye, depth, phiLength, thetaStart, thetaLength, projection
 */
async function parseRGBD(url, options = {}) {
  const signal = options?.signal;
  signal?.throwIfAborted();

  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error(`Invalid or missing URL: ${url}`);
  }

  const requestedType = options?.type || options?.layout || 'rgbd';
  const { bytes: headerBytes, isPrefix: isHeaderPrefix } = await readHeaderBytes(url, options);
  signal?.throwIfAborted();

  const pngDims = readPngDimensions(headerBytes);
  if (pngDims) {
    validateDimensions(pngDims.width, pngDims.height, requestedType);
  }

  const fullBytes = (!isHeaderPrefix && headerBytes) || decodeDataUrlBytes(url);
  if (fullBytes) {
    assertCompletePng(fullBytes);
  }

  const image = await createImageFromURL(url, signal);
  signal?.throwIfAborted();

  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new Error('Truncated or invalid image data: missing IEND chunk');
  }

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const layout = validateDimensions(width, height, requestedType);

  const read = getPixelReader(image, width, height);

  let colorPart;
  let depthPart;
  if (isHorizontalLayout(layout)) {
    const subWidth = Math.floor(width / 2);
    const leftHalf = read(0, 0, subWidth, height);
    const rightHalf = read(width - subWidth, 0, subWidth, height);
    colorPart = layout === 'rgbd-left-right' ? leftHalf : rightHalf;
    depthPart = layout === 'rgbd-left-right' ? rightHalf : leftHalf;
  } else {
    const subHeight = Math.floor(height / 2);
    const topHalf = read(0, 0, width, subHeight);
    const bottomHalf = read(0, height - subHeight, width, subHeight);
    colorPart = layout === 'rgbd-top-bottom' ? topHalf : bottomHalf;
    depthPart = layout === 'rgbd-top-bottom' ? bottomHalf : topHalf;
  }

  const depth = imageDataToCanvas(toDepthMap(depthPart, options));

  let exif = options?.exif;
  if (!exif) {
    exif = {};
    try {
      const exifrInput =
        options?.bytes ||
        fullBytes ||
        image;
      exif = await exifr.parse(exifrInput, {
        xmp: true,
        multiSegment: true,
      }) || {};
    } catch (e) {
      // ignore missing/unparseable metadata
    }
  }
  signal?.throwIfAborted();

  let normalizedExif = exif;
  if (exif && typeof exif === 'object') {
    normalizedExif = {};
    assignDefined(normalizedExif, exif.ifd0);
    assignDefined(normalizedExif, exif.exif);
    assignDefined(normalizedExif, exif);
  }

  const angles = anglesOfView(colorPart.width, colorPart.height, {
    angle: options?.angle,
    projection: undefined,
    exif: normalizedExif,
  });

  return {
    leftEye: colorPart,
    rightEye: colorPart,
    depth,
    ...angles,
    projection: undefined,
  };
}

export {
  parseRGBD,
  normalizeRgbdType,
  resolveRgbdLayout,
  toDepthMap,
  imageDataToCanvas,
};
export default parseRGBD;
