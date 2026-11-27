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
 * Parser for Animated Wigglegram multi-view images (GIF87a/GIF89a, Animated WebP, APNG).
 *
 * Extracts extreme parallax viewpoints from multi-frame animated containers and returns
 * a standard StereoData object `{ leftEye, rightEye, phiLength, thetaStart, thetaLength, projection }`.
 */

import exifr from './../../vendor/exifr/full.esm.js';
import { anglesOfView } from './../stereo-parser/stereo-parser.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Precomputed IEEE 802.3 CRC-32 table for PNG chunk construction
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createAbortError(signal) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

function checkAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return null;
}

function createImageData(data, width, height) {
  const clamped = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
  if (typeof ImageData === 'function') {
    return new ImageData(clamped, width, height);
  }
  return {
    width,
    height,
    data: clamped,
  };
}

function ascii(bytes, offset, length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(bytes[offset + i]);
  }
  return out;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Decode a base64 data: URL into raw bytes, handling uppercase schemes, MIME parameters, and whitespace.
 * @param {string} url
 * @returns {Uint8Array|null}
 */
export function decodeDataUrlBytes(url) {
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
      const cleaned = payload.replace(/\s+/g, '');
      if (!cleaned) {
        return null;
      }
      const buf = Buffer.from(cleaned, 'base64');
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

/**
 * Load an HTMLImageElement from a URL with AbortSignal cancellation.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<HTMLImageElement>}
 */
export async function createImageFromURL(url, signal) {
  checkAborted(signal);
  if (typeof Image === 'undefined') {
    throw new Error('Image constructor is unavailable in this environment');
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'Anonymous';
    const onAbort = () => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      reject(createAbortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    image.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(image);
    };
    image.onerror = (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err instanceof Error ? err : new Error(`Failed to load image: ${url}`));
    };
    image.src = url;
  });
}

async function loadInputBytes(url, options = {}) {
  const signal = options?.signal;
  checkAborted(signal);

  if (options?.bytes !== undefined && options?.bytes !== null) {
    const provided = toUint8Array(options.bytes);
    if (!provided) {
      throw new TypeError('options.bytes must be a Uint8Array, ArrayBuffer, or TypedArray');
    }
    return provided;
  }

  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('Invalid wigglegram URL');
  }

  if (/^\s*data:/i.test(url)) {
    const decoded = decodeDataUrlBytes(url);
    if (!decoded) {
      throw new Error('Invalid or empty base64 data URL for wigglegram');
    }
    return decoded;
  }

  if (url.startsWith('file://') && typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    const fileBytes = await readFile(new URL(url));
    checkAborted(signal);
    return new Uint8Array(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  }

  if (typeof fetch !== 'function') {
    throw new Error(`Unable to fetch wigglegram URL without fetch(): ${url}`);
  }

  const response = await fetch(url, { signal });
  checkAborted(signal);
  if (!response?.ok) {
    throw new Error(`Could not fetch wigglegram ${url}: ${response?.status ?? 'unknown error'}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  checkAborted(signal);
  return bytes;
}

function isPngSignature(bytes) {
  if (!bytes || bytes.length < 8) {
    return false;
  }
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Detect the container format of an animated wigglegram byte buffer.
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} input
 * @returns {'gif'|'webp'|'apng'|null}
 */
export function detectAnimationFormat(input) {
  const bytes = toUint8Array(input);
  if (!bytes || bytes.length < 6) {
    return null;
  }

  // GIF87a / GIF89a
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'gif';
  }

  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }

  // PNG with acTL chunk before IDAT -> APNG
  if (isPngSignature(bytes) && bytes.length >= 33) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const len = view.getUint32(offset, false);
      if (offset + 12 + len > bytes.length) {
        break;
      }
      const type = ascii(bytes, offset + 4, 4);
      if (type === 'acTL') {
        return 'apng';
      }
      if (type === 'IDAT' || type === 'IEND') {
        break;
      }
      offset += 12 + len;
    }
  }

  return null;
}

function countGifImageDescriptors(bytes) {
  if (bytes.length < 13) {
    return 0;
  }
  const screenWidth = bytes[6] | (bytes[7] << 8);
  const screenHeight = bytes[8] | (bytes[9] << 8);
  if (screenWidth === 0 || screenHeight === 0) {
    return 0;
  }
  const lsdPacked = bytes[10];
  let pos = 13;
  if (lsdPacked & 0x80) {
    const gctBytes = 3 * (1 << ((lsdPacked & 0x07) + 1));
    if (pos + gctBytes > bytes.length) {
      return 0;
    }
    pos += gctBytes;
  }

  let count = 0;
  while (pos < bytes.length) {
    const introducer = bytes[pos++];
    if (introducer === 0x3b) {
      break;
    }
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
      count++;
      if (count >= 2) {
        return count;
      }
      const packed = bytes[pos + 8];
      pos += 9;
      if (packed & 0x80) {
        const lctBytes = 3 * (1 << ((packed & 0x07) + 1));
        if (pos + lctBytes > bytes.length) break;
        pos += lctBytes;
      }
      if (pos >= bytes.length) break;
      pos++; // LZW min code size
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
  return count;
}

/**
 * Determine whether raw bytes represent a multi-frame animated wigglegram (GIF/WebP/APNG with >= 2 frames).
 * Static 1-frame GIFs, static WebPs, and static PNGs return false.
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} input
 * @returns {boolean}
 */
export function isAnimatedWigglegram(input) {
  const bytes = toUint8Array(input);
  const format = detectAnimationFormat(bytes);
  if (!format) {
    return false;
  }

  if (format === 'gif') {
    return countGifImageDescriptors(bytes) >= 2;
  }

  if (format === 'webp') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let anmfCount = 0;
    let hasAnimFlag = false;
    while (offset + 8 <= bytes.length) {
      const chunkId = ascii(bytes, offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      const dataStart = offset + 8;
      const paddedSize = chunkSize + (chunkSize & 1);
      if (dataStart + chunkSize > bytes.length) {
        break;
      }
      if (chunkId === 'VP8X' && chunkSize >= 10) {
        if ((bytes[dataStart] & 0x02) !== 0) {
          hasAnimFlag = true;
        }
      } else if (chunkId === 'ANIM' && chunkSize >= 6) {
        hasAnimFlag = true;
      } else if (chunkId === 'ANMF' && chunkSize >= 16) {
        anmfCount++;
        if (anmfCount >= 2) {
          return true;
        }
      }
      offset = dataStart + paddedSize;
    }
    return hasAnimFlag && anmfCount >= 2;
  }

  if (format === 'apng') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const len = view.getUint32(offset, false);
      if (offset + 12 + len > bytes.length) {
        break;
      }
      const type = ascii(bytes, offset + 4, 4);
      if (type === 'acTL' && len >= 8) {
        const numFrames = view.getUint32(offset + 8, false);
        return numFrames >= 2;
      }
      if (type === 'IDAT' || type === 'IEND') {
        break;
      }
      offset += 12 + len;
    }
  }

  return false;
}

// ============================================================================
// Pure-JS GIF87a / GIF89a Decoder & Frame Compositor
// ============================================================================

function decompressGifLzw(compressed, minCodeSize, expectedPixels) {
  if (minCodeSize < 2 || minCodeSize > 8) {
    throw new Error(`Invalid GIF LZW minimum code size: ${minCodeSize}`);
  }
  if (!compressed || compressed.length === 0) {
    throw new Error('Empty GIF LZW raster stream');
  }

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);

  const pixels = new Uint8Array(expectedPixels);
  let pixelCount = 0;

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let oldCode = -1;
  let firstChar = 0;

  let bytePos = 0;
  let bitBuf = 0;
  let bitCount = 0;

  const readCode = () => {
    while (bitCount < codeSize) {
      if (bytePos >= compressed.length) {
        return -1;
      }
      bitBuf |= compressed[bytePos++] << bitCount;
      bitCount += 8;
    }
    const mask = (1 << codeSize) - 1;
    const code = bitBuf & mask;
    bitBuf >>>= codeSize;
    bitCount -= codeSize;
    return code;
  };

  let sawEoi = false;
  while (true) {
    const code = readCode();
    if (code === -1) {
      if (!sawEoi && pixelCount < expectedPixels) {
        throw new Error('Truncated GIF LZW bitstream');
      }
      break;
    }

    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
      oldCode = -1;
      continue;
    }

    if (code === eoiCode) {
      sawEoi = true;
      break;
    }

    if (oldCode === -1) {
      if (code >= clearCode) {
        throw new Error(`Corrupted GIF LZW initial code: ${code}`);
      }
      if (pixelCount < expectedPixels) {
        pixels[pixelCount++] = code;
      }
      oldCode = code;
      firstChar = code;
      continue;
    }

    let cur = code;
    let stackTop = 0;
    if (cur === nextCode) {
      stack[stackTop++] = firstChar;
      cur = oldCode;
    } else if (cur > nextCode) {
      throw new Error(`Corrupted GIF LZW code out of range: ${cur} > ${nextCode}`);
    }

    while (cur >= clearCode) {
      if (stackTop >= 4096) {
        throw new Error('Corrupted GIF LZW dictionary cycle');
      }
      stack[stackTop++] = suffix[cur];
      cur = prefix[cur];
    }

    firstChar = cur;
    stack[stackTop++] = firstChar;

    while (stackTop > 0) {
      const idx = stack[--stackTop];
      if (pixelCount < expectedPixels) {
        pixels[pixelCount++] = idx;
      }
    }

    if (nextCode < 4096) {
      prefix[nextCode] = oldCode;
      suffix[nextCode] = firstChar;
      nextCode++;
      if (nextCode === (1 << codeSize) && codeSize < 12) {
        codeSize++;
      }
    }

    oldCode = code;
  }

  if (pixelCount === 0) {
    throw new Error('GIF LZW stream decoded zero pixels');
  }

  return { pixels, decodedCount: pixelCount };
}

function deinterlaceGifIndices(indices, width, height) {
  const out = new Uint8Array(indices.length);
  const passes = [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ];
  let srcRow = 0;
  for (const [start, step] of passes) {
    for (let y = start; y < height; y += step) {
      const srcOffset = srcRow * width;
      const dstOffset = y * width;
      out.set(indices.subarray(srcOffset, srcOffset + width), dstOffset);
      srcRow++;
    }
  }
  return out;
}

/**
 * Parse and composite all frames from a GIF87a/GIF89a byte buffer.
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} input
 * @param {AbortSignal} [signal]
 * @returns {{ format: 'gif', width: number, height: number, loopCount: number, frames: Array<Object> }}
 */
export function readGifFrames(input, signal) {
  checkAborted(signal);
  const bytes = toUint8Array(input);
  if (!bytes || bytes.length < 13) {
    throw new Error('Truncated GIF header');
  }

  const header = ascii(bytes, 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    throw new Error(`Invalid GIF header signature: ${header}`);
  }

  const screenWidth = bytes[6] | (bytes[7] << 8);
  const screenHeight = bytes[8] | (bytes[9] << 8);
  if (screenWidth === 0 || screenHeight === 0) {
    throw new Error(`Invalid GIF logical screen dimensions: ${screenWidth}x${screenHeight}`);
  }

  const lsdPacked = bytes[10];
  const hasGct = Boolean(lsdPacked & 0x80);
  const gctColors = hasGct ? (1 << ((lsdPacked & 0x07) + 1)) : 0;
  let pos = 13;

  let gct = null;
  if (hasGct) {
    const gctByteLen = gctColors * 3;
    if (pos + gctByteLen > bytes.length) {
      throw new Error('Truncated GIF global color table');
    }
    gct = bytes.subarray(pos, pos + gctByteLen);
    pos += gctByteLen;
  }

  let loopCount = 0;
  let gce = null;
  const rawFrames = [];

  const readSubBlocks = (requireNonEmpty = false) => {
    const chunks = [];
    let total = 0;
    while (true) {
      if (pos >= bytes.length) {
        throw new Error('Truncated GIF sub-block stream');
      }
      const len = bytes[pos++];
      if (len === 0) {
        break;
      }
      if (pos + len > bytes.length) {
        throw new Error('Truncated GIF sub-block payload');
      }
      chunks.push(bytes.subarray(pos, pos + len));
      total += len;
      pos += len;
    }
    if (requireNonEmpty && total === 0) {
      throw new Error('Empty GIF LZW data sub-blocks');
    }
    if (chunks.length === 1) {
      return chunks[0];
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  };

  while (pos < bytes.length) {
    checkAborted(signal);
    const introducer = bytes[pos++];

    if (introducer === 0x3b) {
      break;
    }

    if (introducer === 0x21) {
      if (pos >= bytes.length) {
        throw new Error('Truncated GIF extension label');
      }
      const label = bytes[pos++];
      if (label === 0xf9) {
        if (pos + 6 > bytes.length || bytes[pos] !== 4 || bytes[pos + 5] !== 0x00) {
          throw new Error('Invalid or truncated GIF Graphic Control Extension');
        }
        const packed = bytes[pos + 1];
        const delayCs = bytes[pos + 2] | (bytes[pos + 3] << 8);
        const transparentIndex = bytes[pos + 4];
        gce = {
          disposalMethod: (packed >> 2) & 0x07,
          transparentFlag: Boolean(packed & 0x01),
          delayMs: delayCs * 10,
          transparentIndex,
        };
        pos += 6;
      } else if (label === 0xfe) {
        readSubBlocks(false);
      } else {
        if (pos >= bytes.length) {
          throw new Error('Truncated GIF extension block size');
        }
        const blockSize = bytes[pos++];
        if (pos + blockSize > bytes.length) {
          throw new Error('Truncated GIF extension header block');
        }
        const extHeader = bytes.subarray(pos, pos + blockSize);
        pos += blockSize;
        const extData = readSubBlocks(false);
        if (
          label === 0xff &&
          blockSize === 11 &&
          ascii(extHeader, 0, 11) === 'NETSCAPE2.0' &&
          extData.length >= 3 &&
          extData[0] === 0x01
        ) {
          loopCount = extData[1] | (extData[2] << 8);
        }
      }
      continue;
    }

    if (introducer === 0x2c) {
      if (pos + 9 > bytes.length) {
        throw new Error('Truncated GIF Image Descriptor');
      }
      const left = bytes[pos] | (bytes[pos + 1] << 8);
      const top = bytes[pos + 2] | (bytes[pos + 3] << 8);
      const width = bytes[pos + 4] | (bytes[pos + 5] << 8);
      const height = bytes[pos + 6] | (bytes[pos + 7] << 8);
      const packed = bytes[pos + 8];
      pos += 9;

      if (width === 0 || height === 0) {
        throw new Error(`Invalid GIF frame descriptor dimensions: ${width}x${height}`);
      }
      if (left + width > screenWidth || top + height > screenHeight) {
        throw new Error(`GIF frame rectangle (${left},${top},${width}x${height}) exceeds screen (${screenWidth}x${screenHeight})`);
      }
      if (rawFrames.length > 0 && (width !== rawFrames[0].frameWidth || height !== rawFrames[0].frameHeight)) {
        throw new Error(`Mismatched GIF frame dimensions: frame 0 is ${rawFrames[0].frameWidth}x${rawFrames[0].frameHeight}, frame ${rawFrames.length} is ${width}x${height}`);
      }

      const hasLct = Boolean(packed & 0x80);
      const interlaced = Boolean(packed & 0x40);
      let colorTable = gct;
      if (hasLct) {
        const lctBytes = 3 * (1 << ((packed & 0x07) + 1));
        if (pos + lctBytes > bytes.length) {
          throw new Error('Truncated GIF local color table');
        }
        colorTable = bytes.subarray(pos, pos + lctBytes);
        pos += lctBytes;
      }
      if (!colorTable) {
        throw new Error('GIF frame lacks both global and local color tables');
      }

      if (pos >= bytes.length) {
        throw new Error('Truncated GIF LZW minimum code size');
      }
      const lzwMinCodeSize = bytes[pos++];
      const compressed = readSubBlocks(true);
      const expectedPixels = width * height;
      const { pixels: decodedPixels, decodedCount } = decompressGifLzw(compressed, lzwMinCodeSize, expectedPixels);
      const finalIndices = interlaced ? deinterlaceGifIndices(decodedPixels, width, height) : decodedPixels;

      rawFrames.push({
        index: rawFrames.length,
        left,
        top,
        frameWidth: width,
        frameHeight: height,
        interlaced,
        colorTable,
        indices: finalIndices,
        decodedCount,
        disposalMethod: gce?.disposalMethod ?? 0,
        transparentFlag: gce?.transparentFlag ?? false,
        transparentIndex: gce?.transparentIndex ?? 0,
        delayMs: gce?.delayMs ?? 0,
      });
      gce = null;
      continue;
    }

    throw new Error(`Unexpected GIF block introducer: 0x${introducer.toString(16)}`);
  }

  if (gce !== null) {
    throw new Error('Truncated GIF: Graphic Control Extension without following image frame');
  }
  if (rawFrames.length === 0) {
    throw new Error('GIF contains no image frames');
  }

  const canvas = new Uint8ClampedArray(screenWidth * screenHeight * 4);
  let previousSnapshot = null;
  const frames = [];

  for (let i = 0; i < rawFrames.length; i++) {
    checkAborted(signal);
    const f = rawFrames[i];
    if (i > 0) {
      const prev = rawFrames[i - 1];
      if (prev.disposalMethod === 2) {
        for (let py = 0; py < prev.frameHeight; py++) {
          const rowStart = ((prev.top + py) * screenWidth + prev.left) * 4;
          canvas.fill(0, rowStart, rowStart + prev.frameWidth * 4);
        }
      } else if (prev.disposalMethod === 3 && previousSnapshot) {
        canvas.set(previousSnapshot);
      }
    }

    if (f.disposalMethod === 3) {
      previousSnapshot = new Uint8ClampedArray(canvas);
    }

    const tableColors = f.colorTable.length / 3;
    const pixelLimit = f.interlaced ? f.frameWidth * f.frameHeight : f.decodedCount;
    let localPos = 0;
    for (let py = 0; py < f.frameHeight && localPos < pixelLimit; py++) {
      const dstRow = (f.top + py) * screenWidth + f.left;
      for (let px = 0; px < f.frameWidth && localPos < pixelLimit; px++, localPos++) {
        const colorIdx = f.indices[localPos];
        if (f.transparentFlag && colorIdx === f.transparentIndex) {
          continue;
        }
        if (colorIdx >= tableColors) {
          continue;
        }
        const dstOffset = (dstRow + px) * 4;
        const srcOffset = colorIdx * 3;
        canvas[dstOffset] = f.colorTable[srcOffset];
        canvas[dstOffset + 1] = f.colorTable[srcOffset + 1];
        canvas[dstOffset + 2] = f.colorTable[srcOffset + 2];
        canvas[dstOffset + 3] = 255;
      }
    }

    const frameRgba = new Uint8ClampedArray(canvas);
    frames.push({
      index: i,
      left: f.left,
      top: f.top,
      width: screenWidth,
      height: screenHeight,
      frameWidth: f.frameWidth,
      frameHeight: f.frameHeight,
      delayMs: f.delayMs,
      disposalMethod: f.disposalMethod,
      data: frameRgba,
      imageData: createImageData(frameRgba, screenWidth, screenHeight),
    });
  }

  return {
    format: 'gif',
    width: screenWidth,
    height: screenHeight,
    loopCount,
    frames,
  };
}

// ============================================================================
// Pure-JS APNG Parser + DecompressionStream('deflate') Scanline Decoder
// ============================================================================

async function inflateZlib(compressedBytes, signal) {
  checkAborted(signal);
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream is unavailable for APNG decompression');
  }
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const writeDone = writer.write(compressedBytes).catch(() => {});
  const closeDone = writer.close().catch(() => {});
  try {
    const ab = await new Response(ds.readable).arrayBuffer();
    checkAborted(signal);
    return new Uint8Array(ab);
  } finally {
    await Promise.allSettled([writeDone, closeDone]);
  }
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterPngScanlines(raw, width, height, bpp) {
  const stride = width * bpp;
  const expectedLen = height * (1 + stride);
  if (raw.length < expectedLen) {
    throw new Error(`Truncated APNG scanline buffer: expected ${expectedLen}, got ${raw.length}`);
  }
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const inRowStart = y * (1 + stride);
    const filterType = raw[inRowStart];
    const outRowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[inRowStart + 1 + x];
      const a = x >= bpp ? out[outRowStart + x - bpp] : 0;
      const b = y > 0 ? out[prevRowStart + x] : 0;
      const c = (y > 0 && x >= bpp) ? out[prevRowStart + x - bpp] : 0;
      let recon;
      switch (filterType) {
        case 0:
          recon = val;
          break;
        case 1:
          recon = (val + a) & 0xff;
          break;
        case 2:
          recon = (val + b) & 0xff;
          break;
        case 3:
          recon = (val + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          recon = (val + paethPredictor(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG scanline filter type: ${filterType}`);
      }
      out[outRowStart + x] = recon;
    }
  }
  return out;
}

function pngSamplesToRgba(samples, width, height, colorType, plte, trns) {
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  if (colorType === 6) {
    rgba.set(samples.subarray(0, pixelCount * 4));
    return rgba;
  }

  if (colorType === 2) {
    const hasTrns = trns && trns.length >= 6;
    const tr = hasTrns ? trns[1] : -1;
    const tg = hasTrns ? trns[3] : -1;
    const tb = hasTrns ? trns[5] : -1;
    for (let i = 0; i < pixelCount; i++) {
      const r = samples[i * 3];
      const g = samples[i * 3 + 1];
      const b = samples[i * 3 + 2];
      const dst = i * 4;
      rgba[dst] = r;
      rgba[dst + 1] = g;
      rgba[dst + 2] = b;
      rgba[dst + 3] = (hasTrns && r === tr && g === tg && b === tb) ? 0 : 255;
    }
    return rgba;
  }

  if (colorType === 0) {
    const hasTrns = trns && trns.length >= 2;
    const tGray = hasTrns ? trns[1] : -1;
    for (let i = 0; i < pixelCount; i++) {
      const v = samples[i];
      const dst = i * 4;
      rgba[dst] = v;
      rgba[dst + 1] = v;
      rgba[dst + 2] = v;
      rgba[dst + 3] = (hasTrns && v === tGray) ? 0 : 255;
    }
    return rgba;
  }

  if (colorType === 4) {
    for (let i = 0; i < pixelCount; i++) {
      const v = samples[i * 2];
      const a = samples[i * 2 + 1];
      const dst = i * 4;
      rgba[dst] = v;
      rgba[dst + 1] = v;
      rgba[dst + 2] = v;
      rgba[dst + 3] = a;
    }
    return rgba;
  }

  if (colorType === 3) {
    if (!plte || plte.length < 3) {
      throw new Error('Indexed PNG/APNG missing PLTE chunk');
    }
    const paletteLen = Math.floor(plte.length / 3);
    for (let i = 0; i < pixelCount; i++) {
      const idx = samples[i];
      const dst = i * 4;
      if (idx < paletteLen) {
        rgba[dst] = plte[idx * 3];
        rgba[dst + 1] = plte[idx * 3 + 1];
        rgba[dst + 2] = plte[idx * 3 + 2];
        rgba[dst + 3] = (trns && idx < trns.length) ? trns[idx] : 255;
      } else {
        rgba[dst + 3] = 0;
      }
    }
    return rgba;
  }

  throw new Error(`Unsupported PNG color type: ${colorType}`);
}

function makePngChunk(type, data) {
  const len = data.length;
  const out = new Uint8Array(12 + len);
  const view = new DataView(out.buffer);
  view.setUint32(0, len, false);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + len));
  view.setUint32(8 + len, crc, false);
  return out;
}

function packageSingleFramePng(ihdrTemplate, width, height, sharedChunks, compressedChunks) {
  const ihdrData = new Uint8Array(ihdrTemplate);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);

  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    makePngChunk('IHDR', ihdrData),
  ];
  for (const chunk of sharedChunks) {
    parts.push(chunk);
  }
  for (const payload of compressedChunks) {
    parts.push(makePngChunk('IDAT', payload));
  }
  parts.push(makePngChunk('IEND', new Uint8Array(0)));

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const merged = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) {
    merged.set(p, pos);
    pos += p.length;
  }
  return merged;
}

function concatChunks(chunks) {
  if (chunks.length === 1) {
    return chunks[0];
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function compositeFrameRect(canvas, canvasWidth, frameRgba, frameWidth, frameHeight, xOffset, yOffset, blendOp) {
  for (let py = 0; py < frameHeight; py++) {
    const dstRow = (yOffset + py) * canvasWidth + xOffset;
    const srcRow = py * frameWidth;
    for (let px = 0; px < frameWidth; px++) {
      const dst = (dstRow + px) * 4;
      const src = (srcRow + px) * 4;
      if (blendOp === 0) {
        canvas[dst] = frameRgba[src];
        canvas[dst + 1] = frameRgba[src + 1];
        canvas[dst + 2] = frameRgba[src + 2];
        canvas[dst + 3] = frameRgba[src + 3];
      } else {
        const sa = frameRgba[src + 3] / 255;
        if (sa === 0) continue;
        if (sa === 1) {
          canvas[dst] = frameRgba[src];
          canvas[dst + 1] = frameRgba[src + 1];
          canvas[dst + 2] = frameRgba[src + 2];
          canvas[dst + 3] = 255;
        } else {
          const da = canvas[dst + 3] / 255;
          const outA = sa + da * (1 - sa);
          if (outA > 0) {
            canvas[dst] = Math.round((frameRgba[src] * sa + canvas[dst] * da * (1 - sa)) / outA);
            canvas[dst + 1] = Math.round((frameRgba[src + 1] * sa + canvas[dst + 1] * da * (1 - sa)) / outA);
            canvas[dst + 2] = Math.round((frameRgba[src + 2] * sa + canvas[dst + 2] * da * (1 - sa)) / outA);
            canvas[dst + 3] = Math.round(outA * 255);
          }
        }
      }
    }
  }
}

/**
 * Parse and decode an APNG (or static PNG fallback) byte buffer into composited frames.
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} input
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ format: 'apng', width: number, height: number, numFrames: number, numPlays: number, isAnimated: boolean, frames: Array<Object> }>}
 */
export async function readApng(input, options = {}) {
  const signal = options?.signal;
  checkAborted(signal);
  const bytes = toUint8Array(input);
  if (!isPngSignature(bytes)) {
    throw new Error('Invalid PNG/APNG signature');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  let ihdrData = null;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filter = 0;
  let interlace = 0;

  let plte = null;
  let trns = null;
  const sharedChunks = [];
  let actl = null;

  const idatBeforeFctl = [];
  const rawFrames = [];
  let currentFrame = null;
  let expectedSequenceNumber = 0;
  let sawIdat = false;
  let sawIend = false;

  while (offset + 12 <= bytes.length) {
    checkAborted(signal);
    const len = view.getUint32(offset, false);
    if (offset + 12 + len > bytes.length) {
      throw new Error('Truncated PNG/APNG chunk');
    }
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const chunkData = bytes.subarray(dataStart, dataStart + len);

    if (type === 'IHDR') {
      if (len !== 13) {
        throw new Error('Invalid PNG IHDR chunk length');
      }
      ihdrData = chunkData;
      canvasWidth = view.getUint32(dataStart, false);
      canvasHeight = view.getUint32(dataStart + 4, false);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      compression = bytes[dataStart + 10];
      filter = bytes[dataStart + 11];
      interlace = bytes[dataStart + 12];
      if (canvasWidth === 0 || canvasHeight === 0) {
        throw new Error(`Invalid APNG dimensions: ${canvasWidth}x${canvasHeight}`);
      }
    } else if (type === 'PLTE') {
      plte = chunkData;
      sharedChunks.push(bytes.subarray(offset, offset + 12 + len));
    } else if (type === 'tRNS') {
      trns = chunkData;
      sharedChunks.push(bytes.subarray(offset, offset + 12 + len));
    } else if (type === 'acTL') {
      if (len !== 8) {
        throw new Error('Invalid APNG acTL chunk length');
      }
      const numFrames = view.getUint32(dataStart, false);
      const numPlays = view.getUint32(dataStart + 4, false);
      if (numFrames === 0) {
        throw new Error('Invalid APNG acTL num_frames: 0');
      }
      actl = { numFrames, numPlays };
    } else if (type === 'fcTL') {
      if (len !== 26) {
        throw new Error('Invalid APNG fcTL chunk length');
      }
      const sequenceNumber = view.getUint32(dataStart, false);
      if (sequenceNumber !== expectedSequenceNumber) {
        throw new Error(`Invalid APNG fcTL sequence_number: expected ${expectedSequenceNumber}, got ${sequenceNumber}`);
      }
      expectedSequenceNumber++;

      const frameWidth = view.getUint32(dataStart + 4, false);
      const frameHeight = view.getUint32(dataStart + 8, false);
      const xOffset = view.getUint32(dataStart + 12, false);
      const yOffset = view.getUint32(dataStart + 16, false);
      const delayNum = view.getUint16(dataStart + 20, false);
      const delayDen = view.getUint16(dataStart + 22, false) || 100;
      const disposeOp = bytes[dataStart + 24];
      const blendOp = bytes[dataStart + 25];

      if (frameWidth === 0 || frameHeight === 0) {
        throw new Error(`Invalid APNG frame dimensions: ${frameWidth}x${frameHeight}`);
      }
      if (xOffset + frameWidth > canvasWidth || yOffset + frameHeight > canvasHeight) {
        throw new Error('APNG frame bounds exceed canvas dimensions');
      }

      currentFrame = {
        sequenceNumber,
        frameWidth,
        frameHeight,
        xOffset,
        yOffset,
        delayMs: (delayNum * 1000) / delayDen,
        disposeOp,
        blendOp,
        compressedChunks: [],
        usesIdat: false,
      };
      rawFrames.push(currentFrame);
    } else if (type === 'IDAT') {
      sawIdat = true;
      if (currentFrame && rawFrames.length === 1 && currentFrame.compressedChunks.length === 0) {
        currentFrame.usesIdat = true;
        currentFrame.compressedChunks.push(chunkData);
      } else if (currentFrame?.usesIdat) {
        currentFrame.compressedChunks.push(chunkData);
      } else {
        idatBeforeFctl.push(chunkData);
      }
    } else if (type === 'fdAT') {
      if (!actl) {
        throw new Error('APNG fdAT chunk encountered without acTL');
      }
      if (len < 4) {
        throw new Error('Invalid APNG fdAT chunk length');
      }
      if (!currentFrame) {
        throw new Error('APNG fdAT chunk encountered before fcTL');
      }
      const sequenceNumber = view.getUint32(dataStart, false);
      if (sequenceNumber !== expectedSequenceNumber) {
        throw new Error(`Invalid APNG fdAT sequence_number: expected ${expectedSequenceNumber}, got ${sequenceNumber}`);
      }
      expectedSequenceNumber++;
      currentFrame.compressedChunks.push(chunkData.subarray(4));
    } else if (type === 'IEND') {
      sawIend = true;
      break;
    }

    offset += 12 + len;
  }

  if (!ihdrData) {
    throw new Error('Missing PNG IHDR chunk');
  }
  if (!sawIend) {
    throw new Error('Truncated PNG/APNG: missing IEND chunk');
  }

  if (!actl) {
    if (idatBeforeFctl.length === 0 && !sawIdat) {
      throw new Error('PNG missing IDAT image data');
    }
    if (rawFrames.length === 0) {
      rawFrames.push({
        sequenceNumber: 0,
        frameWidth: canvasWidth,
        frameHeight: canvasHeight,
        xOffset: 0,
        yOffset: 0,
        delayMs: 0,
        disposeOp: 0,
        blendOp: 0,
        compressedChunks: idatBeforeFctl,
        usesIdat: true,
      });
    } else {
      for (let i = 0; i < rawFrames.length; i++) {
        if (rawFrames[i].compressedChunks.length === 0) {
          throw new Error(`APNG frame ${i} missing image data`);
        }
      }
    }
  } else {
    if (rawFrames.length === 0 || rawFrames.length < actl.numFrames) {
      throw new Error(`Truncated APNG: declared ${actl.numFrames} frames, found ${rawFrames.length}`);
    }
    for (let i = 0; i < rawFrames.length; i++) {
      if (rawFrames[i].compressedChunks.length === 0) {
        throw new Error(`APNG frame ${i} missing image data`);
      }
    }
  }

  const bppMap = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const canPureJsDecode =
    compression === 0 &&
    filter === 0 &&
    interlace === 0 &&
    bitDepth === 8 &&
    bppMap[colorType] !== undefined &&
    typeof DecompressionStream === 'function';

  if (!canPureJsDecode && typeof ImageDecoder === 'function') {
    const supported = await ImageDecoder.isTypeSupported?.('image/png');
    if (supported) {
      const decoder = new ImageDecoder({ data: bytes, type: 'image/png' });
      try {
        await decoder.tracks.ready;
        const count = decoder.tracks.selectedTrack?.frameCount ?? rawFrames.length;
        const frames = [];
        const canvasEl = typeof document !== 'undefined' ? document.createElement('canvas') : null;
        if (canvasEl) {
          canvasEl.width = canvasWidth;
          canvasEl.height = canvasHeight;
        }
        const ctx = canvasEl?.getContext('2d', { willReadFrequently: true });
        for (let i = 0; i < count; i++) {
          checkAborted(signal);
          const { image: videoFrame } = await decoder.decode({ frameIndex: i });
          try {
            checkAborted(signal);
            let rgba;
            if (ctx) {
              ctx.clearRect(0, 0, canvasWidth, canvasHeight);
              ctx.drawImage(videoFrame, 0, 0);
              rgba = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;
            } else {
              rgba = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
              await videoFrame.copyTo?.(rgba);
              checkAborted(signal);
            }
            frames.push({
              index: i,
              left: rawFrames[i]?.xOffset ?? 0,
              top: rawFrames[i]?.yOffset ?? 0,
              width: canvasWidth,
              height: canvasHeight,
              frameWidth: rawFrames[i]?.frameWidth ?? canvasWidth,
              frameHeight: rawFrames[i]?.frameHeight ?? canvasHeight,
              delayMs: rawFrames[i]?.delayMs ?? 0,
              data: rgba,
              imageData: createImageData(rgba, canvasWidth, canvasHeight),
            });
          } finally {
            videoFrame.close?.();
          }
        }
        checkAborted(signal);
        return {
          format: 'apng',
          width: canvasWidth,
          height: canvasHeight,
          numFrames: frames.length,
          numPlays: actl?.numPlays ?? 0,
          isAnimated: Boolean(actl) && frames.length >= 2,
          frames,
        };
      } finally {
        decoder.close?.();
      }
    }
  }

  const canvas = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
  let previousSnapshot = null;
  const frames = [];

  for (let i = 0; i < rawFrames.length; i++) {
    checkAborted(signal);
    const f = rawFrames[i];

    if (i > 0) {
      const prev = rawFrames[i - 1];
      if (prev.disposeOp === 1) {
        for (let py = 0; py < prev.frameHeight; py++) {
          const rowStart = ((prev.yOffset + py) * canvasWidth + prev.xOffset) * 4;
          canvas.fill(0, rowStart, rowStart + prev.frameWidth * 4);
        }
      } else if (prev.disposeOp === 2 && previousSnapshot) {
        canvas.set(previousSnapshot);
      }
    }

    if (f.disposeOp === 2) {
      previousSnapshot = new Uint8ClampedArray(canvas);
    }

    let frameRgba;
    if (canPureJsDecode) {
      const compressed = concatChunks(f.compressedChunks);
      const decompressed = await inflateZlib(compressed, signal);
      const unfiltered = unfilterPngScanlines(decompressed, f.frameWidth, f.frameHeight, bppMap[colorType]);
      frameRgba = pngSamplesToRgba(unfiltered, f.frameWidth, f.frameHeight, colorType, plte, trns);
    } else if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
      const singlePng = packageSingleFramePng(ihdrData, f.frameWidth, f.frameHeight, sharedChunks, f.compressedChunks);
      const frameUrl = `data:image/png;base64,${bytesToBase64(singlePng)}`;
      const img = await createImageFromURL(frameUrl, signal);
      checkAborted(signal);
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = f.frameWidth;
      tmpCanvas.height = f.frameHeight;
      const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });
      tmpCtx.drawImage(img, 0, 0, f.frameWidth, f.frameHeight);
      frameRgba = tmpCtx.getImageData(0, 0, f.frameWidth, f.frameHeight).data;
    } else {
      throw new Error(`Unsupported APNG encoding (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}) in non-DOM environment`);
    }

    compositeFrameRect(canvas, canvasWidth, frameRgba, f.frameWidth, f.frameHeight, f.xOffset, f.yOffset, f.blendOp);
    const snapshot = new Uint8ClampedArray(canvas);
    frames.push({
      index: i,
      left: f.xOffset,
      top: f.yOffset,
      width: canvasWidth,
      height: canvasHeight,
      frameWidth: f.frameWidth,
      frameHeight: f.frameHeight,
      delayMs: f.delayMs,
      disposeOp: f.disposeOp,
      blendOp: f.blendOp,
      data: snapshot,
      imageData: createImageData(snapshot, canvasWidth, canvasHeight),
    });
  }

  return {
    format: 'apng',
    width: canvasWidth,
    height: canvasHeight,
    numFrames: frames.length,
    numPlays: actl?.numPlays ?? 0,
    isAnimated: Boolean(actl) && frames.length >= 2,
    frames,
  };
}

// ============================================================================
// Pure-JS Animated WebP RIFF / VP8X / ANIM / ANMF Parser + Decoder
// ============================================================================

function makeRiffChunk(id, payload) {
  const paddedLen = payload.length + (payload.length & 1);
  const out = new Uint8Array(8 + paddedLen);
  for (let i = 0; i < 4; i++) {
    out[i] = id.charCodeAt(i);
  }
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

function packageSingleFrameWebP(width, height, subChunks) {
  const parts = [];
  const alphChunk = subChunks.find(c => c.id === 'ALPH');
  const imageChunk = subChunks.find(c => c.id === 'VP8 ' || c.id === 'VP8L');
  if (alphChunk) {
    const vp8xPayload = new Uint8Array(10);
    vp8xPayload[0] = 0x10; // Alpha flag
    const wm1 = width - 1;
    const hm1 = height - 1;
    vp8xPayload[4] = wm1 & 0xff;
    vp8xPayload[5] = (wm1 >>> 8) & 0xff;
    vp8xPayload[6] = (wm1 >>> 16) & 0xff;
    vp8xPayload[7] = hm1 & 0xff;
    vp8xPayload[8] = (hm1 >>> 8) & 0xff;
    vp8xPayload[9] = (hm1 >>> 16) & 0xff;
    parts.push(makeRiffChunk('VP8X', vp8xPayload));
    parts.push(makeRiffChunk('ALPH', alphChunk.data));
  }
  if (imageChunk) {
    parts.push(makeRiffChunk(imageChunk.id, imageChunk.data));
  }

  const bodyLen = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(12 + bodyLen);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  new DataView(out.buffer).setUint32(4, 4 + bodyLen, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  let pos = 12;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function parseWebPStillDimensions(chunkId, data) {
  if (chunkId === 'VP8 ' && data.length >= 10) {
    if (data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
      const w = (data[6] | (data[7] << 8)) & 0x3fff;
      const h = (data[8] | (data[9] << 8)) & 0x3fff;
      return { width: w, height: h };
    }
  } else if (chunkId === 'VP8L' && data.length >= 5 && data[0] === 0x2f) {
    const bits = data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >>> 14) & 0x3fff) + 1;
    return { width: w, height: h };
  }
  return null;
}

/**
 * Parse and decode an Animated WebP RIFF container (with ImageDecoder or single-frame WebP re-packaging).
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} input
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ format: 'webp', width: number, height: number, loopCount: number, isAnimated: boolean, frames: Array<Object> }>}
 */
export async function readWebPAnimation(input, options = {}) {
  const signal = options?.signal;
  checkAborted(signal);
  const bytes = toUint8Array(input);
  if (!bytes || bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    throw new Error('Invalid WebP RIFF header');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize < 4 || 8 + riffSize > bytes.length) {
    throw new Error('Truncated WebP RIFF container');
  }
  const riffEnd = 8 + riffSize;

  let canvasWidth = 0;
  let canvasHeight = 0;
  let isAnimatedFlag = false;
  let loopCount = 0;
  const anmfFrames = [];
  const stillSubChunks = [];

  let offset = 12;
  while (offset + 8 <= riffEnd) {
    checkAborted(signal);
    const chunkId = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const paddedSize = chunkSize + (chunkSize & 1);
    if (dataStart + chunkSize > riffEnd) {
      throw new Error(`Truncated WebP chunk: ${chunkId}`);
    }
    const chunkData = bytes.subarray(dataStart, dataStart + chunkSize);

    if (chunkId === 'VP8X') {
      if (chunkSize < 10) {
        throw new Error('Invalid WebP VP8X chunk size');
      }
      isAnimatedFlag = Boolean(bytes[dataStart] & 0x02);
      canvasWidth = 1 + (bytes[dataStart + 4] | (bytes[dataStart + 5] << 8) | (bytes[dataStart + 6] << 16));
      canvasHeight = 1 + (bytes[dataStart + 7] | (bytes[dataStart + 8] << 8) | (bytes[dataStart + 9] << 16));
    } else if (chunkId === 'ANIM') {
      if (chunkSize < 6) {
        throw new Error('Invalid WebP ANIM chunk size');
      }
      loopCount = view.getUint16(dataStart + 4, true);
    } else if (chunkId === 'ANMF') {
      if (chunkSize < 16) {
        throw new Error('Truncated WebP ANMF frame header');
      }
      const frameX = 2 * (bytes[dataStart] | (bytes[dataStart + 1] << 8) | (bytes[dataStart + 2] << 16));
      const frameY = 2 * (bytes[dataStart + 3] | (bytes[dataStart + 4] << 8) | (bytes[dataStart + 5] << 16));
      const frameWidth = 1 + (bytes[dataStart + 6] | (bytes[dataStart + 7] << 8) | (bytes[dataStart + 8] << 16));
      const frameHeight = 1 + (bytes[dataStart + 9] | (bytes[dataStart + 10] << 8) | (bytes[dataStart + 11] << 16));
      const durationMs = bytes[dataStart + 12] | (bytes[dataStart + 13] << 8) | (bytes[dataStart + 14] << 16);
      const frameFlags = bytes[dataStart + 15];
      const disposeToBackground = Boolean(frameFlags & 0x01);
      const doNotBlend = Boolean(frameFlags & 0x02);

      if (canvasWidth > 0 && (frameX + frameWidth > canvasWidth || frameY + frameHeight > canvasHeight)) {
        throw new Error('WebP ANMF frame bounds exceed canvas dimensions');
      }

      const subChunks = [];
      let subPos = dataStart + 16;
      const subEnd = dataStart + chunkSize;
      while (subPos + 8 <= subEnd) {
        const subId = ascii(bytes, subPos, 4);
        const subSize = view.getUint32(subPos + 4, true);
        const subDataStart = subPos + 8;
        if (subDataStart + subSize > subEnd) {
          throw new Error(`Truncated WebP ANMF sub-chunk: ${subId}`);
        }
        subChunks.push({
          id: subId,
          data: bytes.subarray(subDataStart, subDataStart + subSize),
        });
        subPos = subDataStart + subSize + (subSize & 1);
      }

      if (!subChunks.some(c => c.id === 'VP8 ' || c.id === 'VP8L')) {
        throw new Error('WebP ANMF frame missing VP8/VP8L bitstream');
      }

      const frameBytes = packageSingleFrameWebP(frameWidth, frameHeight, subChunks);
      anmfFrames.push({
        index: anmfFrames.length,
        left: frameX,
        top: frameY,
        frameWidth,
        frameHeight,
        durationMs,
        disposeToBackground,
        doNotBlend,
        subChunks,
        frameBytes,
        dataUrl: `data:image/webp;base64,${bytesToBase64(frameBytes)}`,
      });
    } else if (chunkId === 'ALPH' || chunkId === 'VP8 ' || chunkId === 'VP8L') {
      stillSubChunks.push({ id: chunkId, data: chunkData });
      if (canvasWidth === 0 || canvasHeight === 0) {
        const dims = parseWebPStillDimensions(chunkId, chunkData);
        if (dims) {
          canvasWidth = dims.width;
          canvasHeight = dims.height;
        }
      }
    }

    offset = dataStart + Math.min(paddedSize, riffEnd - dataStart);
  }

  if (anmfFrames.length === 0 && stillSubChunks.length > 0 && canvasWidth > 0 && canvasHeight > 0) {
    const frameBytes = packageSingleFrameWebP(canvasWidth, canvasHeight, stillSubChunks);
    anmfFrames.push({
      index: 0,
      left: 0,
      top: 0,
      frameWidth: canvasWidth,
      frameHeight: canvasHeight,
      durationMs: 0,
      disposeToBackground: false,
      doNotBlend: true,
      subChunks: stillSubChunks,
      frameBytes,
      dataUrl: `data:image/webp;base64,${bytesToBase64(frameBytes)}`,
    });
  }

  if (canvasWidth === 0 || canvasHeight === 0 || anmfFrames.length === 0) {
    throw new Error('WebP container contains no valid frames');
  }
  for (const f of anmfFrames) {
    if (f.left + f.frameWidth > canvasWidth || f.top + f.frameHeight > canvasHeight) {
      throw new Error('WebP ANMF frame bounds exceed canvas dimensions');
    }
  }

  // Prefer native ImageDecoder when available (browsers)
  if (typeof ImageDecoder === 'function') {
    const supported = await ImageDecoder.isTypeSupported?.('image/webp');
    if (supported) {
      const decoder = new ImageDecoder({ data: bytes, type: 'image/webp' });
      try {
        await decoder.tracks.ready;
        const count = decoder.tracks.selectedTrack?.frameCount ?? anmfFrames.length;
        const frames = [];
        const canvasEl = typeof document !== 'undefined' ? document.createElement('canvas') : null;
        if (canvasEl) {
          canvasEl.width = canvasWidth;
          canvasEl.height = canvasHeight;
        }
        const ctx = canvasEl?.getContext('2d', { willReadFrequently: true });

        for (let i = 0; i < count; i++) {
          checkAborted(signal);
          const { image: videoFrame } = await decoder.decode({ frameIndex: i });
          try {
            checkAborted(signal);
            let rgba;
            if (ctx) {
              ctx.clearRect(0, 0, canvasWidth, canvasHeight);
              ctx.drawImage(videoFrame, 0, 0);
              rgba = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;
            } else {
              rgba = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
              await videoFrame.copyTo?.(rgba);
              checkAborted(signal);
            }
            const meta = anmfFrames[i] || {};
            frames.push({
              index: i,
              left: meta.left ?? 0,
              top: meta.top ?? 0,
              width: canvasWidth,
              height: canvasHeight,
              frameWidth: meta.frameWidth ?? canvasWidth,
              frameHeight: meta.frameHeight ?? canvasHeight,
              delayMs: meta.durationMs ?? 0,
              frameBytes: meta.frameBytes,
              data: rgba,
              imageData: createImageData(rgba, canvasWidth, canvasHeight),
            });
          } finally {
            videoFrame.close?.();
          }
        }
        checkAborted(signal);
        return {
          format: 'webp',
          width: canvasWidth,
          height: canvasHeight,
          loopCount,
          isAnimated: isAnimatedFlag || frames.length >= 2,
          frames,
        };
      } finally {
        decoder.close?.();
      }
    }
  }

  // Fallback: single-frame WebP re-packaging + DOM Image/Canvas compositing (or structural ImageData in Node)
  const hasDomCanvas = typeof Image !== 'undefined' && typeof document !== 'undefined';
  const compCanvas = hasDomCanvas ? document.createElement('canvas') : null;
  if (compCanvas) {
    compCanvas.width = canvasWidth;
    compCanvas.height = canvasHeight;
  }
  const compCtx = compCanvas?.getContext('2d', { willReadFrequently: true });

  const frames = [];
  for (let i = 0; i < anmfFrames.length; i++) {
    checkAborted(signal);
    const f = anmfFrames[i];
    let rgba;

    if (compCtx) {
      if (i > 0 && anmfFrames[i - 1].disposeToBackground) {
        const prev = anmfFrames[i - 1];
        compCtx.clearRect(prev.left, prev.top, prev.frameWidth, prev.frameHeight);
      }
      const img = await createImageFromURL(f.dataUrl, signal);
      checkAborted(signal);
      if (f.doNotBlend) {
        compCtx.clearRect(f.left, f.top, f.frameWidth, f.frameHeight);
      }
      compCtx.drawImage(img, f.left, f.top, f.frameWidth, f.frameHeight);
      const imageData = compCtx.getImageData(0, 0, canvasWidth, canvasHeight);
      rgba = new Uint8ClampedArray(imageData.data);
    } else {
      rgba = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
    }

    frames.push({
      index: i,
      left: f.left,
      top: f.top,
      width: canvasWidth,
      height: canvasHeight,
      frameWidth: f.frameWidth,
      frameHeight: f.frameHeight,
      delayMs: f.durationMs,
      disposeToBackground: f.disposeToBackground,
      doNotBlend: f.doNotBlend,
      frameBytes: f.frameBytes,
      dataUrl: f.dataUrl,
      data: rgba,
      imageData: createImageData(rgba, canvasWidth, canvasHeight),
    });
  }

  return {
    format: 'webp',
    width: canvasWidth,
    height: canvasHeight,
    loopCount,
    isAnimated: isAnimatedFlag || frames.length >= 2,
    frames,
  };
}

// ============================================================================
// Extreme Viewpoint Selection
// ============================================================================

function frameMeanAbsoluteDiff(frameA, frameB) {
  const dataA = frameA?.data || frameA?.imageData?.data;
  const dataB = frameB?.data || frameB?.imageData?.data;
  if (!dataA || !dataB || dataA.length !== dataB.length || dataA.length < 4) {
    return 0;
  }
  const pixelCount = dataA.length >>> 2;
  const step = Math.max(1, Math.floor(pixelCount / 2048));
  let sum = 0;
  let samples = 0;
  for (let p = 0; p < pixelCount; p += step) {
    const idx = p * 4;
    sum +=
      Math.abs(dataA[idx] - dataB[idx]) +
      Math.abs(dataA[idx + 1] - dataB[idx + 1]) +
      Math.abs(dataA[idx + 2] - dataB[idx + 2]);
    samples += 3;
  }
  return samples > 0 ? sum / (samples * 255) : 0;
}

function parseFrameIndex(value, count, name) {
  if (typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) {
    throw new RangeError(`Invalid ${name}: ${value}`);
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num < 0 || num >= count) {
    throw new RangeError(`Invalid ${name} (${value}): expected integer in [0, ${count - 1}]`);
  }
  return num;
}

/**
 * Select left and right extreme parallax frames from a decoded frame sequence.
 *
 * - 1 frame: `[0, 0]` (mono fallback)
 * - 2 frames: `[0, 1]`
 * - >= 3 frames: linear sweep `[0, M - 1]` or ping-pong loop `[0, Math.floor(M / 2)]`
 * - Respects `eyeOrder: 'right-left'`, `type: 'wiggle-right-left'`, `reverse: true`,
 *   and explicit `leftFrame` / `rightFrame` options.
 *
 * @param {Array<Object>} frames
 * @param {Object} [options]
 * @returns {{ leftIndex: number, rightIndex: number, leftFrame: Object, rightFrame: Object, isAnimated: boolean }}
 */
export function selectExtremeFrames(frames, options = {}) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error('Cannot select extreme frames from an empty frame sequence');
  }

  const count = frames.length;
  const hasLeft = options?.leftFrame !== undefined && options?.leftFrame !== null && options?.leftFrame !== '';
  const hasRight = options?.rightFrame !== undefined && options?.rightFrame !== null && options?.rightFrame !== '';

  let leftIndex = 0;
  let rightIndex = 0;

  if (hasLeft || hasRight) {
    leftIndex = hasLeft ? parseFrameIndex(options.leftFrame, count, 'leftFrame') : 0;
    rightIndex = hasRight ? parseFrameIndex(options.rightFrame, count, 'rightFrame') : (count === 1 ? 0 : count - 1);
  } else if (count === 1) {
    leftIndex = 0;
    rightIndex = 0;
  } else if (count === 2) {
    leftIndex = 0;
    rightIndex = 1;
  } else {
    leftIndex = 0;
    const mid = Math.floor(count / 2);
    if (options?.sequence === 'ping-pong') {
      rightIndex = mid;
    } else if (options?.sequence === 'linear') {
      rightIndex = count - 1;
    } else if (count === 3) {
      const endDiff = frameMeanAbsoluteDiff(frames[0], frames[2]);
      const midDiff = frameMeanAbsoluteDiff(frames[0], frames[1]);
      if (
        endDiff < 0.02 &&
        (midDiff > 0.02 || midDiff > endDiff * 2 + 0.002 || (endDiff < 0.005 && midDiff > 0.005))
      ) {
        rightIndex = 1;
      } else {
        rightIndex = 2;
      }
    } else {
      const diffsFromStart = new Array(count);
      diffsFromStart[0] = 0;
      let peakIdx = 1;
      let peakDiff = -1;
      for (let i = 1; i < count; i++) {
        const diff = frameMeanAbsoluteDiff(frames[0], frames[i]);
        diffsFromStart[i] = diff;
        if (diff >= peakDiff) {
          peakDiff = diff;
          peakIdx = i;
        }
      }

      if (peakIdx < count - 1) {
        const endDiffFromStart = diffsFromStart[count - 1];
        const stepsBack = endDiffFromStart < peakDiff && endDiffFromStart <= diffsFromStart[count - 2];
        const peakToEndDiff = frameMeanAbsoluteDiff(frames[peakIdx], frames[count - 1]);
        const mirrorIdx = 2 * peakIdx - (count - 1);
        const mirrorDiff = mirrorIdx >= 0
          ? frameMeanAbsoluteDiff(frames[mirrorIdx], frames[count - 1])
          : Infinity;
        const countMinus3Diff = count >= 3
          ? frameMeanAbsoluteDiff(frames[count - 3], frames[count - 1])
          : Infinity;
        const matchesMirror =
          (mirrorDiff < 0.02 && mirrorDiff < peakToEndDiff) ||
          (countMinus3Diff < 0.02 && countMinus3Diff < peakToEndDiff) ||
          (endDiffFromStart < 0.02 && endDiffFromStart < peakToEndDiff);

        if (stepsBack && (matchesMirror || peakDiff - endDiffFromStart > 0.02)) {
          rightIndex = peakIdx;
        } else {
          rightIndex = count - 1;
        }
      } else {
        rightIndex = count - 1;
      }
    }
  }

  const reverseOrder =
    options?.eyeOrder === 'right-left' ||
    options?.type === 'wiggle-right-left' ||
    options?.reverse === true;

  if (reverseOrder) {
    const tmp = leftIndex;
    leftIndex = rightIndex;
    rightIndex = tmp;
  }

  return {
    leftIndex,
    rightIndex,
    leftFrame: frames[leftIndex],
    rightFrame: frames[rightIndex],
    isAnimated: count >= 2,
  };
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
 * Parse an animated wigglegram (GIF, WebP, or APNG) from a URL, Data URI, or byte buffer into StereoData.
 *
 * @param {string} url - Image URL or data URI
 * @param {Object} [options] - Parsing options: bytes, type, eyeOrder, reverse, sequence, leftFrame, rightFrame, angle, projection, signal, exif
 * @returns {Promise<Object>} StereoData containing leftEye, rightEye, phiLength, thetaStart, thetaLength, projection
 */
export async function parseWigglegram(url, options = {}) {
  const signal = options?.signal;
  checkAborted(signal);

  const bytes = await loadInputBytes(url, options);
  checkAborted(signal);

  const format = detectAnimationFormat(bytes);
  let decoded;
  if (format === 'gif') {
    decoded = readGifFrames(bytes, signal);
  } else if (format === 'apng') {
    decoded = await readApng(bytes, { signal });
  } else if (format === 'webp') {
    decoded = await readWebPAnimation(bytes, { signal });
  } else {
    throw new Error('Unsupported or invalid animated wigglegram format (expected GIF, WebP, or APNG)');
  }
  checkAborted(signal);

  const { leftFrame, rightFrame } = selectExtremeFrames(decoded.frames, options);
  const leftEye = leftFrame.imageData || createImageData(leftFrame.data, leftFrame.width, leftFrame.height);
  const rightEye = rightFrame.imageData || createImageData(rightFrame.data, rightFrame.width, rightFrame.height);

  let exif = options?.exif;
  if (!exif) {
    exif = {};
    try {
      exif = (await exifr.parse(bytes, {
        xmp: true,
        multiSegment: true,
      })) || {};
    } catch (e) {
      // ignore missing/unparseable metadata
    }
  }
  checkAborted(signal);

  let normalizedExif = exif;
  if (exif && typeof exif === 'object') {
    normalizedExif = {};
    assignDefined(normalizedExif, exif.ifd0);
    assignDefined(normalizedExif, exif.exif);
    assignDefined(normalizedExif, exif);
  }

  const projection = options?.projection === 'fisheye' ? 'fisheye' : undefined;
  const angles = anglesOfView(leftEye.width, leftEye.height, {
    angle: options?.angle,
    projection,
    exif: normalizedExif,
  });

  return {
    leftEye,
    rightEye,
    ...angles,
    projection,
  };
}

export default parseWigglegram;
