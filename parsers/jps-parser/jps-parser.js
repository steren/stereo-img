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
 * Parser for JPEG Stereoscopic files (.jps): standard JPEG images holding
 * a stereoscopic pair and an optional APP3 marker with the '_JPSJPS_' descriptor.
 *
 * Specification: VRex Stereoscopic Descriptor,
 * http://web.archive.org/web/20070208074813/http://www.vrex.com/developer/jpsformat.pdf
 */

const APP3 = 0xe3;
const START_OF_SCAN = 0xda;
const MAGIC_JPS = '_JPSJPS_';

/**
 * Reads the APP3 JPS descriptor marker from a JPEG byte array.
 * @param {Uint8Array} bytes - Raw bytes of the JPEG file.
 * @returns {Object|null} Parsed descriptor object or null if not found.
 */
export function readJpsMarker(bytes) {
  if (!bytes || bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Not a valid JPEG: missing SOI marker (0xFF, 0xD8)');
  }

  let position = 2;
  while (position < bytes.length) {
    if (bytes[position] !== 0xff) {
      break;
    }
    if (position + 1 >= bytes.length) {
      throw new Error('Truncated JPEG marker prefix');
    }
    const marker = bytes[position + 1];
    if (marker === START_OF_SCAN) {
      break;
    }
    // Standalone markers without length
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      position += 2;
      continue;
    }
    if (position + 3 >= bytes.length) {
      throw new Error('Truncated JPEG marker: missing segment length');
    }
    const length = (bytes[position + 2] << 8) | bytes[position + 3];
    if (length < 2) {
      throw new Error('Invalid JPEG marker segment length');
    }
    if (position + 2 + length > bytes.length) {
      throw new Error('Truncated JPEG marker segment payload');
    }

    if (marker === APP3 && length >= 10) {
      const sig = String.fromCharCode(...bytes.subarray(position + 4, position + 12));
      if (sig === MAGIC_JPS) {
        // Support Structure 1: null-terminated '_JPSJPS_\0' + uint16(2) + [layout, flags]
        if (bytes[position + 12] === 0x00 && bytes[position + 13] === 0x00 && bytes[position + 14] === 0x02) {
          const layout = bytes[position + 15];
          const flags = bytes[position + 16];
          const halfHeight = Boolean(flags & 0x01);
          const halfWidth = Boolean(flags & 0x02);
          const leftFieldFirst = Boolean(flags & 0x04);
          return {
            mediaType: 1,
            layout,
            halfWidth,
            halfHeight,
            leftFieldFirst,
          };
        }

        // Structure 2: VRex standard: '_JPSJPS_' (8 bytes) + descriptor block length (2 bytes) + 4-byte descriptor
        const blockLength = (bytes[position + 12] << 8) | bytes[position + 13];
        if (blockLength < 4 || position + 14 + blockLength > position + 2 + length) {
          throw new Error('Truncated or invalid JPS descriptor block length');
        }

        const mediaType = bytes[position + 14];
        const layout = bytes[position + 15];
        const flags = bytes[position + 16];
        const halfHeight = Boolean(flags & 0x01);
        const halfWidth = Boolean(flags & 0x02);
        const leftFieldFirst = Boolean(flags & 0x04);

        let comment;
        if (blockLength > 4 && position + 20 <= bytes.length) {
          const commentLen = (bytes[position + 18] << 8) | bytes[position + 19];
          if (commentLen > 0 && position + 20 + commentLen <= position + 2 + length) {
            comment = new TextDecoder().decode(bytes.subarray(position + 20, position + 20 + commentLen));
          }
        }

        return {
          mediaType,
          layout,
          halfWidth,
          halfHeight,
          leftFieldFirst,
          comment,
        };
      }
    }

    position += 2 + length;
  }

  return null;
}

/**
 * Maps a JPS descriptor to a standard stereo-img type string.
 * @param {Object|null} desc - The JPS descriptor.
 * @returns {string} Standard stereo layout type (e.g. 'left-right', 'half-left-right', 'top-bottom', etc.).
 */
export function descriptorToStereoType(desc) {
  if (!desc) {
    // Per the VRex JPS specification, unadorned .jps files default to cross-eyed (right-left).
    return 'right-left';
  }

  if (desc.mediaType === 0x00) {
    return 'mono';
  }

  if (desc.mediaType === 0x01) {
    switch (desc.layout) {
      case 0x01: // Interleaved
        return desc.leftFieldFirst ? 'interlaced' : 'interlaced-reverse';
      case 0x02: // Side-by-Side
        if (desc.leftFieldFirst) {
          return desc.halfWidth ? 'half-left-right' : 'left-right';
        } else {
          return desc.halfWidth ? 'half-right-left' : 'right-left';
        }
      case 0x03: // Over-Under
        if (desc.leftFieldFirst) {
          return desc.halfHeight ? 'half-top-bottom' : 'top-bottom';
        } else {
          return desc.halfHeight ? 'half-bottom-top' : 'bottom-top';
        }
      case 0x04: // Anaglyph
        return 'anaglyph';
      default:
        return 'left-right';
    }
  }

  return 'left-right';
}

/**
 * Fetches and parses a JPS stereoscopic image.
 * @param {string} url - URL or data URI of the JPS picture.
 * @param {Object} [options] - Parsing options (signal, angle, projection, bytes, etc.).
 * @returns {Promise<Object>} The StereoData structure.
 */
export async function parseJPS(url, options = {}) {
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

  const desc = readJpsMarker(bytes);
  const type = descriptorToStereoType(desc);

  if (type === 'mono') {
    const { parseMono } = await import('../mono-parser/mono-parser.js');
    return parseMono(url, options);
  }
  if (type === 'anaglyph') {
    const { parseAnaglyph } = await import('../anaglyph-parser/anaglyph-parser.js');
    return parseAnaglyph(url, options);
  }

  const { parseStereo } = await import('../stereo-parser/stereo-parser.js');
  return parseStereo(url, { ...options, type });
}

export default parseJPS;
