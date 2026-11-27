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
 * Parser for Looking Glass Quilt multi-view light-field images.
 *
 * Specification:
 * - Filename descriptor convention: `<name>_qs<Cols>x<Rows>a<Aspect>.<ext>`
 *   (e.g. `_qs8x6a0.75.png`, `_qs5x9a0.5625.png`).
 * - View ordering: View 0 is at the bottom-left tile, advancing left-to-right
 *   across columns and bottom-to-top across rows, ending with View N - 1
 *   (`cols * rows - 1`) at the top-right tile.
 * - Default stereo pair: View 0 (left eye) and View N - 1 (right eye), or a
 *   single view when `options.viewIndex` is specified.
 */

import exifr from './../../vendor/exifr/full.esm.js';
import { anglesOfView } from './../stereo-parser/stereo-parser.js';
import { pixelReader } from './../../lib/pixels.js';

const QUILT_DESCRIPTOR_REGEX = /_qs(\d+)x(\d+)a(\d+(?:\.\d+)?|\.\d+)(?=(?:\.[a-z][a-z0-9]*)+$|[^a-z0-9.]|$)/i;
const DEFAULT_QUILT_COLS = 8;
const DEFAULT_QUILT_ROWS = 6;
const DEFAULT_QUILT_ASPECT = 0.75;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function extractDecodedBasename(src) {
  if (typeof src !== 'string' || /^\s*(?:data|blob):/i.test(src)) {
    return '';
  }
  let name = src.split(/[?#]/)[0].split(/[/\\]/).pop() || '';
  try {
    name = decodeURIComponent(name);
  } catch (e) {
    // keep raw basename when percent-encoding is malformed
  }
  return name.split(/[/\\]/).pop() || '';
}

/**
 * Parse a Looking Glass Quilt descriptor ("_qs<Cols>x<Rows>a<Aspect>") from a URL or file name.
 * @param {string} src - Image URL or file name
 * @returns {{ cols: number, rows: number, aspect: number, totalViews: number } | null}
 */
export function parseQuiltDescriptor(src) {
  const name = extractDecodedBasename(src);
  if (!name) {
    return null;
  }
  const match = name.match(QUILT_DESCRIPTOR_REGEX);
  if (!match) {
    return null;
  }
  const cols = Number.parseInt(match[1], 10);
  const rows = Number.parseInt(match[2], 10);
  const aspect = Number.parseFloat(match[3]);
  const totalViews = cols * rows;
  if (
    !Number.isInteger(cols) ||
    cols < 1 ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    !Number.isSafeInteger(totalViews) ||
    !Number.isFinite(aspect) ||
    aspect <= 0
  ) {
    return null;
  }
  return {
    cols,
    rows,
    aspect,
    totalViews,
  };
}

function parseStrictInteger(value) {
  if (typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) {
    return NaN;
  }
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(num) ? num : NaN;
}

function parseStrictNumber(value) {
  if (typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) {
    return NaN;
  }
  return typeof value === 'number' ? value : Number(value);
}

function resolveQuiltDescriptor(url, options = {}) {
  const descriptorUrl =
    typeof options?.originalUrl === 'string' && options.originalUrl.trim()
      ? options.originalUrl
      : url;
  const fileDescriptor = parseQuiltDescriptor(descriptorUrl);

  const rawCols =
    options?.columns !== undefined && options?.columns !== null && options?.columns !== ''
      ? options.columns
      : options?.cols;
  const rawRows = options?.rows;
  const rawAspect = options?.aspect;

  const hasExplicitCols = rawCols !== undefined && rawCols !== null && rawCols !== '';
  const hasExplicitRows = rawRows !== undefined && rawRows !== null && rawRows !== '';
  const hasExplicitAspect = rawAspect !== undefined && rawAspect !== null && rawAspect !== '';

  let aspect = fileDescriptor?.aspect ?? DEFAULT_QUILT_ASPECT;
  if (hasExplicitAspect) {
    aspect = parseStrictNumber(rawAspect);
    if (!Number.isFinite(aspect) || aspect <= 0) {
      throw new RangeError(`Invalid quilt aspect ratio: ${rawAspect}`);
    }
  }

  if (hasExplicitCols || hasExplicitRows) {
    const fallbackCols = options?.fallbackDefault === true ? DEFAULT_QUILT_COLS : undefined;
    const fallbackRows = options?.fallbackDefault === true ? DEFAULT_QUILT_ROWS : undefined;
    const cols = hasExplicitCols ? parseStrictInteger(rawCols) : (fileDescriptor?.cols ?? fallbackCols);
    const rows = hasExplicitRows ? parseStrictInteger(rawRows) : (fileDescriptor?.rows ?? fallbackRows);
    const totalViews = cols * rows;
    if (
      !Number.isInteger(cols) ||
      cols < 1 ||
      !Number.isInteger(rows) ||
      rows < 1 ||
      !Number.isSafeInteger(totalViews)
    ) {
      throw new RangeError(`Invalid quilt grid dimensions: columns=${rawCols}, rows=${rawRows}`);
    }
    return {
      cols,
      rows,
      aspect,
      totalViews,
    };
  }

  if (fileDescriptor) {
    return {
      ...fileDescriptor,
      aspect,
    };
  }

  const basename = extractDecodedBasename(descriptorUrl);
  if (/_qs/i.test(basename)) {
    throw new Error(`Invalid Looking Glass quilt descriptor in URL: ${descriptorUrl}`);
  }

  if (options?.fallbackDefault === true) {
    return {
      cols: DEFAULT_QUILT_COLS,
      rows: DEFAULT_QUILT_ROWS,
      aspect,
      totalViews: DEFAULT_QUILT_COLS * DEFAULT_QUILT_ROWS,
    };
  }

  throw new Error(`Missing Looking Glass quilt descriptor (_qs<Cols>x<Rows>a<Aspect>) in URL: ${descriptorUrl}`);
}

/**
 * Compute pixel bounds for a single view tile in a Looking Glass Quilt grid.
 * View 0 is at bottom-left; view `cols * rows - 1` is at top-right.
 *
 * @param {number} imageWidth - Total quilt image width in pixels
 * @param {number} imageHeight - Total quilt image height in pixels
 * @param {number} cols - Number of tile columns (>= 1)
 * @param {number} rows - Number of tile rows (>= 1)
 * @param {number} viewIndex - Zero-based view index in [0, cols * rows - 1]
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function getQuiltTileBounds(imageWidth, imageHeight, cols, rows, viewIndex) {
  if (!Number.isFinite(imageWidth) || imageWidth < 1 || !Number.isFinite(imageHeight) || imageHeight < 1) {
    throw new RangeError(`Invalid quilt image dimensions: ${imageWidth}x${imageHeight}`);
  }
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new RangeError(`Invalid quilt grid dimensions: ${cols}x${rows}`);
  }
  const totalViews = cols * rows;
  if (!Number.isSafeInteger(totalViews)) {
    throw new RangeError(`Invalid quilt grid dimensions: ${cols}x${rows} exceeds safe integer range`);
  }
  if (!Number.isInteger(viewIndex) || viewIndex < 0 || viewIndex >= totalViews) {
    throw new RangeError(`Invalid quilt viewIndex (${viewIndex}): expected integer in [0, ${totalViews - 1}]`);
  }

  const tileWidth = Math.max(1, Math.floor(imageWidth / cols));
  const tileHeight = Math.max(1, Math.floor(imageHeight / rows));
  const rowFromBottom = Math.floor(viewIndex / cols);
  const col = viewIndex % cols;
  const rowFromTop = (rows - 1) - rowFromBottom;

  const x = Math.min(col * tileWidth, Math.max(0, Math.floor(imageWidth) - tileWidth));
  const y = Math.min(rowFromTop * tileHeight, Math.max(0, Math.floor(imageHeight) - tileHeight));

  return {
    x,
    y,
    width: tileWidth,
    height: tileHeight,
  };
}

function parseViewIndex(value, totalViews, name) {
  const idx = parseStrictInteger(value);
  if (!Number.isInteger(idx) || idx < 0 || idx >= totalViews) {
    throw new RangeError(`Invalid ${name} (${value}): expected integer in [0, ${totalViews - 1}]`);
  }
  return idx;
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

function toUint8Array(input) {
  if (!input) {
    return null;
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(input);
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
      reject(err instanceof Error ? err : new Error(`Failed to load quilt image: ${url}`));
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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return (x, y, w, h) => ctx.getImageData(x, y, w, h);
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
 * Parse a Looking Glass Quilt image from a URL or data URI into StereoData.
 *
 * @param {string} url - Image URL or data URI
 * @param {Object} [options] - Parsing options: originalUrl, columns/cols, rows, aspect, viewIndex, leftView, rightView, angle, projection, signal, bytes, exif, fallbackDefault
 * @returns {Promise<Object>} StereoData containing leftEye, rightEye, phiLength, thetaStart, thetaLength, projection, aspect
 */
export async function parseQuilt(url, options = {}) {
  const signal = options?.signal;
  signal?.throwIfAborted();

  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('Invalid Looking Glass quilt image URL');
  }

  const descriptor = resolveQuiltDescriptor(url, options);

  let leftIndex = 0;
  let rightIndex = descriptor.totalViews - 1;
  if (options?.viewIndex !== undefined && options?.viewIndex !== null && options?.viewIndex !== '') {
    const idx = parseViewIndex(options.viewIndex, descriptor.totalViews, 'viewIndex');
    leftIndex = idx;
    rightIndex = idx;
  } else {
    if (options?.leftView !== undefined && options?.leftView !== null && options?.leftView !== '') {
      leftIndex = parseViewIndex(options.leftView, descriptor.totalViews, 'leftView');
    }
    if (options?.rightView !== undefined && options?.rightView !== null && options?.rightView !== '') {
      rightIndex = parseViewIndex(options.rightView, descriptor.totalViews, 'rightView');
    }
  }

  let bytes = toUint8Array(options?.bytes) || decodeDataUrlBytes(url);
  if (bytes) {
    assertCompletePng(bytes);
  }

  const image = await createImageFromURL(url, signal);
  signal?.throwIfAborted();

  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new Error('Truncated or invalid image data: missing IEND chunk');
  }

  if (!bytes && typeof fetch === 'function') {
    try {
      const response = await fetch(url, { signal });
      if (response?.ok) {
        bytes = new Uint8Array(await response.arrayBuffer());
      }
    } catch (e) {
      if (signal?.aborted) {
        throw e;
      }
    }
  }
  signal?.throwIfAborted();
  if (bytes) {
    assertCompletePng(bytes);
  }

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!Number.isFinite(width) || width < 1 || !Number.isFinite(height) || height < 1) {
    throw new Error(`Invalid quilt image dimensions: ${width}x${height}`);
  }

  const read = getPixelReader(image, width, height);

  const leftBounds = getQuiltTileBounds(width, height, descriptor.cols, descriptor.rows, leftIndex);
  const leftEye = read(leftBounds.x, leftBounds.y, leftBounds.width, leftBounds.height);

  let rightEye;
  if (rightIndex === leftIndex) {
    rightEye = leftEye;
  } else {
    const rightBounds = getQuiltTileBounds(width, height, descriptor.cols, descriptor.rows, rightIndex);
    rightEye = read(rightBounds.x, rightBounds.y, rightBounds.width, rightBounds.height);
  }

  let exif = options?.exif;
  if (!exif) {
    exif = {};
    try {
      const exifrInput = options?.bytes || bytes || image;
      exif = (await exifr.parse(exifrInput, {
        xmp: true,
        multiSegment: true,
      })) || {};
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

  const projection = options?.projection === 'fisheye' ? 'fisheye' : undefined;
  const displayWidth = (descriptor.aspect && descriptor.aspect > 0) ? leftEye.height * descriptor.aspect : leftEye.width;
  const angles = anglesOfView(displayWidth, leftEye.height, {
    angle: options?.angle,
    projection,
    exif: normalizedExif,
  });

  return {
    leftEye,
    rightEye,
    ...angles,
    projection,
    aspect: descriptor.aspect,
  };
}

export default parseQuilt;
