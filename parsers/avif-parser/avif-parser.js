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
 * Parser for AVIF spatial / stereo photos and auxiliary depth/disparity AVIF images.
 *
 * Specifications:
 * - ISO/IEC 23000-22 (MIAF) & ISO/IEC 23008-12 (HEIF): "ster" stereo entity group in "grpl",
 *   "pitm" primary item, "iinf"/"infe" item info, "iloc" item locations, "iref"/"auxl", "iprp"/"auxC".
 * - AV1 Image File Format (AVIF): "avif" / "avis" brands.
 *
 * Browsers decode AVIF natively via <img>, but <img> only renders the primary item ("pitm").
 * To decode secondary eye items and auxiliary depth/disparity items without an external AV1 WASM
 * decoder, this parser clones the container bytes, patches "pitm" in-place to point at the target
 * item ID (clearing any hidden "infe" flag bit), and decodes via a temporary Blob URL.
 */

import exifr from './../../vendor/exifr/full.esm.js';
import { anglesOfView } from './../stereo-parser/stereo-parser.js';
import { pixelReader } from './../../lib/pixels.js';

const AVIF_BRANDS = ['avif', 'avis'];
const HEVC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'];
const MIAF_BRANDS = ['mif1', 'msf1', 'mif2', 'miaf'];

const DISPARITY_AUX_URNS = [
  'urn:com:apple:photo:2018:aux:disparity',
];

const METRIC_DEPTH_AUX_URNS = [
  'urn:com:apple:photo:2018:aux:depth',
  'urn:mpeg:mpegB:cicp:systems:auxiliary:depth',
];

/**
 * Classify an auxiliary item URN as 'disparity' (higher = closer),
 * 'depth' (metric depth, higher = farther), or null.
 * @param {string} urn
 * @returns {'disparity'|'depth'|null}
 */
function getDepthAuxType(urn) {
  if (DISPARITY_AUX_URNS.includes(urn)) {
    return 'disparity';
  }
  if (METRIC_DEPTH_AUX_URNS.includes(urn)) {
    return 'depth';
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

/**
 * Read ISOBMFF boxes in [start, end) and flag any truncation or malformed box sizes.
 * @param {DataView} view
 * @param {number} start
 * @param {number} end
 * @returns {{boxes: Array<{type: string, offset: number, start: number, end: number, size: number}>, truncated: boolean}}
 */
function readBoxesChecked(view, start, end) {
  const boxes = [];
  let position = start;
  let truncated = false;
  while (position < end) {
    if (position + 8 > end) {
      truncated = true;
      break;
    }
    let size = view.getUint32(position);
    const type = String.fromCharCode(
      view.getUint8(position + 4),
      view.getUint8(position + 5),
      view.getUint8(position + 6),
      view.getUint8(position + 7),
    );
    let header = 8;
    if (size === 1) {
      if (position + 16 > end) {
        truncated = true;
        break;
      }
      const bigSize = view.getBigUint64(position + 8);
      if (bigSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        truncated = true;
        break;
      }
      size = Number(bigSize);
      header = 16;
    } else if (size === 0) {
      size = end - position;
    }
    if (size < header || position + size > end) {
      truncated = true;
      break;
    }
    boxes.push({ type, offset: position, start: position + header, end: position + size, size });
    position += size;
  }
  return { boxes, truncated };
}

function readUintVar(view, offset, byteCount) {
  if (byteCount === 0) {
    return 0;
  }
  if (byteCount === 4) {
    return view.getUint32(offset);
  }
  if (byteCount === 8) {
    return Number(view.getBigUint64(offset));
  }
  throw new Error(`Unsupported iloc field byte width: ${byteCount}`);
}

function readNullTerminatedUtf8(bytes, start, end) {
  let cursor = start;
  while (cursor < end && bytes[cursor] !== 0) {
    cursor++;
  }
  return new TextDecoder('utf-8').decode(bytes.subarray(start, cursor));
}

/**
 * Parse an AVIF ISOBMFF container structure: brands, primary item ("pitm"),
 * stereo entity group ("grpl"/"ster"), item info ("iinf"/"infe"), item locations ("iloc"),
 * item references ("iref"), and auxiliary depth/disparity properties ("iprp"/"ipco"/"ipma").
 *
 * @param {Uint8Array} bytes
 * @returns {Object|undefined} Structured metadata, or undefined if not an AVIF container.
 */
function readAvif(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) {
    return;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = readBoxesChecked(view, 0, bytes.length);
  const ftyp = top.boxes[0]?.type === 'ftyp' ? top.boxes[0] : null;
  if (!ftyp) {
    return;
  }
  if (ftyp.start + 8 > ftyp.end || (ftyp.end - ftyp.start - 8) % 4 !== 0) {
    return;
  }

  const brandAt = pos => String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
  const major = brandAt(ftyp.start);
  const brands = [major];
  for (let pos = ftyp.start + 8; pos + 4 <= ftyp.end; pos += 4) {
    brands.push(brandAt(pos));
  }

  const hasAvifBrand = brands.some(b => AVIF_BRANDS.includes(b));
  const hasHevcBrand = brands.some(b => HEVC_BRANDS.includes(b));
  const hasMiafBrand = brands.some(b => MIAF_BRANDS.includes(b));

  if (!hasAvifBrand && (hasHevcBrand || !hasMiafBrand)) {
    return;
  }

  const result = {
    primary: undefined,
    primaryBox: undefined,
    stereoPair: undefined,
    depth: undefined,
    depthType: undefined,
    brands,
    items: new Map(),
    locations: new Map(),
    idatRange: undefined,
    auxRefs: [],
    dimgRefs: [],
    cdscRefs: [],
    dimensions: new Map(),
    truncated: top.truncated,
    invalidSter: false,
  };

  let hasAv1Codec = false;

  const meta = top.boxes.find(b => b.type === 'meta');
  if (!meta) {
    return hasAvifBrand ? result : undefined;
  }
  if (meta.start + 4 > meta.end) {
    result.truncated = true;
    return hasAvifBrand ? result : undefined;
  }

  const metaChildren = readBoxesChecked(view, meta.start + 4, meta.end);
  if (metaChildren.truncated) {
    result.truncated = true;
  }

  const depthPropTypes = new Map();
  const itemProperties = new Map();
  const ispePropDims = new Map();
  let hasNonDepthAuxC = false;

  for (const box of metaChildren.boxes) {
    if (box.type === 'pitm') {
      if (box.start + 4 > box.end) {
        result.truncated = true;
        continue;
      }
      const version = view.getUint8(box.start);
      if (version === 0) {
        if (box.start + 6 > box.end) {
          result.truncated = true;
          continue;
        }
        result.primary = view.getUint16(box.start + 4);
        result.primaryBox = { version, itemIdOffset: box.start + 4, itemIdSize: 2 };
      } else {
        if (box.start + 8 > box.end) {
          result.truncated = true;
          continue;
        }
        result.primary = view.getUint32(box.start + 4);
        result.primaryBox = { version, itemIdOffset: box.start + 4, itemIdSize: 4 };
      }
    } else if (box.type === 'grpl') {
      const grplChildren = readBoxesChecked(view, box.start, box.end);
      if (grplChildren.truncated) {
        result.truncated = true;
      }
      for (const group of grplChildren.boxes) {
        if (group.type !== 'ster') {
          continue;
        }
        if (group.start + 12 > group.end) {
          result.truncated = true;
          continue;
        }
        const groupId = view.getUint32(group.start + 4);
        const entityCount = view.getUint32(group.start + 8);
        if (group.start + 12 + entityCount * 4 > group.end) {
          result.truncated = true;
          continue;
        }
        if (entityCount !== 2) {
          result.invalidSter = true;
          continue;
        }
        const leftId = view.getUint32(group.start + 12);
        const rightId = view.getUint32(group.start + 16);
        if (leftId === 0 || rightId === 0 || leftId === rightId) {
          result.invalidSter = true;
          continue;
        }
        if (!result.stereoPair) {
          result.stereoPair = [leftId, rightId];
          result.sterGroupId = groupId;
        }
      }
    } else if (box.type === 'iinf') {
      if (box.start + 4 > box.end) {
        result.truncated = true;
        continue;
      }
      const version = view.getUint8(box.start);
      const headerSize = version === 0 ? 6 : 8;
      if (box.start + headerSize > box.end) {
        result.truncated = true;
        continue;
      }
      const infeBoxes = readBoxesChecked(view, box.start + headerSize, box.end);
      if (infeBoxes.truncated) {
        result.truncated = true;
      }
      for (const infe of infeBoxes.boxes) {
        if (infe.type !== 'infe') {
          continue;
        }
        if (infe.start + 4 > infe.end) {
          result.truncated = true;
          continue;
        }
        const infeVersion = view.getUint8(infe.start);
        const flags =
          (view.getUint8(infe.start + 1) << 16) |
          (view.getUint8(infe.start + 2) << 8) |
          view.getUint8(infe.start + 3);
        const flagsByteOffset = infe.start + 3;
        let id;
        let itemType = '';
        let name = '';
        if (infeVersion === 2) {
          if (infe.start + 12 > infe.end) {
            result.truncated = true;
            continue;
          }
          id = view.getUint16(infe.start + 4);
          itemType = brandAt(infe.start + 8);
          name = readNullTerminatedUtf8(bytes, infe.start + 12, infe.end);
        } else if (infeVersion === 3) {
          if (infe.start + 14 > infe.end) {
            result.truncated = true;
            continue;
          }
          id = view.getUint32(infe.start + 4);
          itemType = brandAt(infe.start + 10);
          name = readNullTerminatedUtf8(bytes, infe.start + 14, infe.end);
        } else if (infeVersion === 0 || infeVersion === 1) {
          if (infe.start + 8 > infe.end) {
            result.truncated = true;
            continue;
          }
          id = view.getUint16(infe.start + 4);
          name = readNullTerminatedUtf8(bytes, infe.start + 8, infe.end);
        } else {
          continue;
        }
        if (itemType === 'av01') {
          hasAv1Codec = true;
        }
        result.items.set(id, {
          id,
          type: itemType,
          name,
          hidden: (flags & 1) !== 0,
          flags,
          flagsByteOffset,
        });
      }
    } else if (box.type === 'iloc') {
      if (box.start + 8 > box.end) {
        result.truncated = true;
        continue;
      }
      const version = view.getUint8(box.start);
      const sizeByte4 = view.getUint8(box.start + 4);
      const sizeByte5 = view.getUint8(box.start + 5);
      const offsetSize = (sizeByte4 >>> 4) & 0x0f;
      const lengthSize = sizeByte4 & 0x0f;
      const baseOffsetSize = (sizeByte5 >>> 4) & 0x0f;
      const indexSize = (version === 1 || version === 2) ? (sizeByte5 & 0x0f) : 0;
      const validSize = s => s === 0 || s === 4 || s === 8;
      if (!validSize(offsetSize) || !validSize(lengthSize) || !validSize(baseOffsetSize) || !validSize(indexSize)) {
        continue;
      }
      let pos;
      let itemCount;
      if (version < 2) {
        itemCount = view.getUint16(box.start + 6);
        pos = box.start + 8;
      } else if (version === 2) {
        if (box.start + 10 > box.end) {
          result.truncated = true;
          continue;
        }
        itemCount = view.getUint32(box.start + 6);
        pos = box.start + 10;
      } else {
        continue;
      }
      const itemIdWidth = version < 2 ? 2 : 4;
      for (let i = 0; i < itemCount; i++) {
        if (pos + itemIdWidth > box.end) {
          result.truncated = true;
          break;
        }
        const itemId = itemIdWidth === 2 ? view.getUint16(pos) : view.getUint32(pos);
        pos += itemIdWidth;
        let constructionMethod = 0;
        if (version === 1 || version === 2) {
          if (pos + 2 > box.end) {
            result.truncated = true;
            break;
          }
          constructionMethod = view.getUint16(pos) & 0x0f;
          pos += 2;
        }
        if (pos + 2 + baseOffsetSize + 2 > box.end) {
          result.truncated = true;
          break;
        }
        const dataReferenceIndex = view.getUint16(pos);
        pos += 2;
        const baseOffset = readUintVar(view, pos, baseOffsetSize);
        pos += baseOffsetSize;
        const extentCount = view.getUint16(pos);
        pos += 2;
        const extentBytes = ((version === 1 || version === 2) ? indexSize : 0) + offsetSize + lengthSize;
        if (extentBytes === 0 && extentCount > 1) {
          result.truncated = true;
          break;
        }
        if (pos + extentCount * extentBytes > box.end) {
          result.truncated = true;
          break;
        }
        const extents = [];
        for (let e = 0; e < extentCount; e++) {
          let index = 0;
          if ((version === 1 || version === 2) && indexSize > 0) {
            index = readUintVar(view, pos, indexSize);
            pos += indexSize;
          }
          const offset = readUintVar(view, pos, offsetSize);
          pos += offsetSize;
          const length = readUintVar(view, pos, lengthSize);
          pos += lengthSize;
          extents.push({ offset, length, index });
        }
        result.locations.set(itemId, {
          itemId,
          constructionMethod,
          dataReferenceIndex,
          baseOffset,
          extents,
        });
      }
    } else if (box.type === 'idat') {
      result.idatRange = { start: box.start, end: box.end };
    } else if (box.type === 'iref') {
      if (box.start + 4 > box.end) {
        result.truncated = true;
        continue;
      }
      const version = view.getUint8(box.start);
      const idSize = version === 0 ? 2 : 4;
      const refBoxes = readBoxesChecked(view, box.start + 4, box.end);
      if (refBoxes.truncated) {
        result.truncated = true;
      }
      for (const refBox of refBoxes.boxes) {
        const targetList =
          refBox.type === 'auxl' ? result.auxRefs :
          refBox.type === 'dimg' ? result.dimgRefs :
          refBox.type === 'cdsc' ? result.cdscRefs : null;
        if (!targetList) {
          continue;
        }
        if (refBox.start + idSize + 2 > refBox.end) {
          continue;
        }
        const from = idSize === 2 ? view.getUint16(refBox.start) : view.getUint32(refBox.start);
        const count = view.getUint16(refBox.start + idSize);
        let pos = refBox.start + idSize + 2;
        for (let r = 0; r < count && pos + idSize <= refBox.end; r++) {
          const to = idSize === 2 ? view.getUint16(pos) : view.getUint32(pos);
          targetList.push({ from, to });
          pos += idSize;
        }
      }
    } else if (box.type === 'iprp') {
      const iprpChildren = readBoxesChecked(view, box.start, box.end);
      if (iprpChildren.truncated) {
        result.truncated = true;
      }
      for (const child of iprpChildren.boxes) {
        if (child.type === 'ipco') {
          const ipcoChildren = readBoxesChecked(view, child.start, child.end);
          if (ipcoChildren.truncated) {
            result.truncated = true;
          }
          const props = ipcoChildren.boxes;
          for (let i = 0; i < props.length; i++) {
            const prop = props[i];
            const propIndex = i + 1;
            if (prop.type === 'av1C') {
              hasAv1Codec = true;
            } else if (prop.type === 'ispe' && prop.start + 12 <= prop.end) {
              ispePropDims.set(propIndex, {
                width: view.getUint32(prop.start + 4),
                height: view.getUint32(prop.start + 8),
              });
            } else if (prop.type === 'auxC' && prop.start + 4 <= prop.end) {
              let endStr = prop.start + 4;
              while (endStr < prop.end && bytes[endStr] !== 0) {
                endStr++;
              }
              const auxType = new TextDecoder('latin1').decode(bytes.subarray(prop.start + 4, endStr));
              const depthType = getDepthAuxType(auxType);
              if (depthType) {
                depthPropTypes.set(propIndex, depthType);
              } else {
                hasNonDepthAuxC = true;
              }
            }
          }
        } else if (child.type === 'ipma' && child.start + 8 <= child.end) {
          const version = view.getUint8(child.start);
          const flags =
            (view.getUint8(child.start + 1) << 16) |
            (view.getUint8(child.start + 2) << 8) |
            view.getUint8(child.start + 3);
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
              if (ispePropDims.has(propIndex)) {
                result.dimensions.set(itemId, ispePropDims.get(propIndex));
              }
            }
            itemProperties.set(itemId, itemProps);
          }
        }
      }
    }
  }

  if (!hasAvifBrand && !hasAv1Codec) {
    return;
  }

  const excludedDepthIds = new Set();
  if (result.primary !== undefined) {
    excludedDepthIds.add(result.primary);
  }
  if (result.stereoPair) {
    excludedDepthIds.add(result.stereoPair[0]);
    excludedDepthIds.add(result.stereoPair[1]);
  }

  // Resolve auxiliary depth / disparity item ID
  const depthCandidates = [];
  for (const [itemId, props] of itemProperties.entries()) {
    if (excludedDepthIds.has(itemId)) {
      continue;
    }
    for (const propIdx of props) {
      if (depthPropTypes.has(propIdx)) {
        depthCandidates.push({ itemId, depthType: depthPropTypes.get(propIdx) });
        break;
      }
    }
  }

  const validAuxRefs = result.auxRefs.filter(ref => !excludedDepthIds.has(ref.from) && ref.from !== ref.to);

  let depthId;
  let depthType;
  if (depthCandidates.length > 0) {
    const primaryTarget = result.primary ?? result.stereoPair?.[0];
    const chosen =
      (primaryTarget !== undefined &&
        depthCandidates.find(c => validAuxRefs.some(ref => ref.from === c.itemId && ref.to === primaryTarget))) ||
      depthCandidates.find(c => validAuxRefs.some(ref => ref.from === c.itemId)) ||
      depthCandidates[0];
    depthId = chosen.itemId;
    depthType = chosen.depthType;
  } else if (depthPropTypes.size > 0 && validAuxRefs.length > 0 && !hasNonDepthAuxC) {
    const primaryTarget = result.primary ?? result.stereoPair?.[0];
    const chosenRef =
      (primaryTarget !== undefined && validAuxRefs.find(ref => ref.to === primaryTarget)) ||
      validAuxRefs[0];
    depthId = chosenRef.from;
    depthType = depthPropTypes.values().next().value;
  }

  if (depthId !== undefined) {
    result.depth = depthId;
    result.depthType = depthType;
  }

  return result;
}

/**
 * Extract raw item bytes for an item ID from an AVIF container using its "iloc" extents.
 * Supports both (bytes, itemId) and (bytes, structure, itemId) call signatures.
 *
 * @param {Uint8Array} bytes
 * @param {Object|number} structureOrItemId
 * @param {number} [maybeItemId]
 * @returns {Uint8Array}
 */
function extractAvifItemBytes(bytes, structureOrItemId, maybeItemId) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('extractAvifItemBytes requires a Uint8Array');
  }
  const structure = typeof structureOrItemId === 'number' ? readAvif(bytes) : (structureOrItemId || readAvif(bytes));
  const itemId = typeof structureOrItemId === 'number' ? structureOrItemId : maybeItemId;

  if (!structure) {
    throw new Error('Not a valid AVIF container');
  }
  const loc = structure.locations?.get(itemId);
  if (!loc) {
    throw new Error(`AVIF item ${itemId} has no iloc entry`);
  }
  if (loc.constructionMethod !== 0 && loc.constructionMethod !== 1) {
    throw new Error(`Unsupported iloc construction_method ${loc.constructionMethod} for item ${itemId}`);
  }

  let baseOrigin = 0;
  let maxEnd = bytes.length;
  if (loc.constructionMethod === 1) {
    if (!structure.idatRange) {
      throw new Error(`Item ${itemId} uses idat_offset construction_method without an idat box`);
    }
    baseOrigin = structure.idatRange.start;
    maxEnd = structure.idatRange.end;
  }

  const slices = [];
  let totalLength = 0;
  for (const extent of loc.extents) {
    const start = baseOrigin + loc.baseOffset + extent.offset;
    const length = extent.length === 0 ? maxEnd - start : extent.length;
    const end = start + length;
    if (start < 0 || length < 0 || end > maxEnd || end > bytes.length) {
      throw new Error(`Out-of-bounds iloc extent for item ${itemId}: [${start}, ${end})`);
    }
    const slice = bytes.subarray(start, end);
    slices.push(slice);
    totalLength += slice.length;
  }

  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const slice of slices) {
    output.set(slice, cursor);
    cursor += slice.length;
  }
  return output;
}

/**
 * Clone AVIF bytes and patch "pitm" in-place to promote `targetItemId` as the primary item,
 * clearing any "infe" hidden flag bit (0x01) on `targetItemId`.
 * Supports both (bytes, targetItemId) and (bytes, structure, targetItemId) call signatures.
 *
 * @param {Uint8Array} bytes
 * @param {Object|number} structureOrItemId
 * @param {number} [maybeItemId]
 * @returns {Uint8Array}
 */
function patchAvifPrimaryItem(bytes, structureOrItemId, maybeItemId) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('patchAvifPrimaryItem requires a Uint8Array');
  }
  const structure = typeof structureOrItemId === 'number' ? readAvif(bytes) : (structureOrItemId || readAvif(bytes));
  const targetItemId = typeof structureOrItemId === 'number' ? structureOrItemId : maybeItemId;

  if (!structure) {
    throw new Error('Not a valid AVIF container');
  }
  if (!Number.isInteger(targetItemId) || targetItemId <= 0) {
    throw new Error(`Invalid target item ID: ${targetItemId}`);
  }
  if (!structure.primaryBox) {
    throw new Error('AVIF container does not contain a pitm box');
  }
  const { itemIdOffset, itemIdSize } = structure.primaryBox;
  if (itemIdSize === 2 && targetItemId > 0xffff) {
    throw new Error(`Target item ID ${targetItemId} exceeds 16-bit pitm capacity`);
  }
  if (structure.items?.size > 0 && !structure.items.has(targetItemId)) {
    throw new Error(`Target item ID ${targetItemId} does not exist in AVIF iinf`);
  }

  const patched = new Uint8Array(bytes);
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
  if (itemIdSize === 2) {
    view.setUint16(itemIdOffset, targetItemId);
  } else {
    view.setUint32(itemIdOffset, targetItemId);
  }

  const itemInfo = structure.items?.get(targetItemId);
  if (itemInfo?.hidden && itemInfo.flagsByteOffset !== undefined) {
    patched[itemInfo.flagsByteOffset] &= 0xfe;
  }

  return patched;
}

/**
 * Invert RGB grayscale values of a disparity image (higher = closer)
 * to metric depth polarity (0 = near, 255 = far) expected by stereo-img.js.
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

async function createImageFromURL(url, signal) {
  signal?.throwIfAborted();
  const image = new Image();
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
      reject(error instanceof Error ? error : new Error(`Failed to load image: ${url}`));
    };
    image.src = url;
  });
}

async function decodeAvifItem(bytes, structure, itemId, sourceUrl, signal) {
  signal?.throwIfAborted();
  const itemMeta = structure.items?.get(itemId);
  const canUseSourceUrl = Boolean(sourceUrl) && itemId === structure.primary && !itemMeta?.hidden;

  let blobUrl = null;
  let targetUrl = sourceUrl;
  if (!canUseSourceUrl) {
    const patched = patchAvifPrimaryItem(bytes, structure, itemId);
    blobUrl = URL.createObjectURL(new Blob([patched], { type: 'image/avif' }));
    targetUrl = blobUrl;
  }

  try {
    const image = await createImageFromURL(targetUrl, signal);
    signal?.throwIfAborted();
    if (!(image.width > 0 && image.height > 0)) {
      throw new Error(`Decoded AVIF item ${itemId} has invalid dimensions (${image.width}x${image.height})`);
    }
    const read = pixelReader(image);
    return read(0, 0, image.width, image.height);
  } finally {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
  }
}

async function readAvifExif(bytes, structure) {
  if (!structure.items || !structure.locations) {
    return {};
  }
  const primaryTarget = structure.primary ?? structure.stereoPair?.[0];
  let exifItemId;
  for (const [itemId, item] of structure.items.entries()) {
    if (item.type === 'Exif') {
      if (primaryTarget !== undefined && structure.cdscRefs.some(ref => ref.from === itemId && ref.to === primaryTarget)) {
        exifItemId = itemId;
        break;
      }
      if (exifItemId === undefined) {
        exifItemId = itemId;
      }
    }
  }
  if (exifItemId === undefined || !structure.locations.has(exifItemId)) {
    return {};
  }
  try {
    const exifBytes = extractAvifItemBytes(bytes, structure, exifItemId);
    if (exifBytes.length < 4) {
      return {};
    }
    const view = new DataView(exifBytes.buffer, exifBytes.byteOffset, exifBytes.byteLength);
    const tiffOffset = 4 + view.getUint32(0);
    if (tiffOffset >= exifBytes.length) {
      return {};
    }
    return await exifr.parse(exifBytes.subarray(tiffOffset), { xmp: true }) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Fetch and parse an AVIF spatial / stereo photo or AVIF auxiliary depth photo.
 *
 * @param {string} url - URL or data URI of the AVIF picture
 * @param {Object} [options] - Parsing options: angle, projection, signal, bytes, structure
 * @returns {Promise<Object>} StereoData ({ leftEye, rightEye, phiLength, thetaStart, thetaLength, projection, depth })
 */
async function parseAVIFStereo(url, options = {}) {
  const signal = options?.signal;
  signal?.throwIfAborted();

  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error(`Invalid or missing URL: ${url}`);
  }

  let bytes = options?.bytes;
  if (!bytes) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Could not fetch ${url}: ${response.status}`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  signal?.throwIfAborted();

  const structure = options?.structure || readAvif(bytes);
  if (!structure) {
    throw new Error('Not an AVIF file');
  }
  if (structure.truncated) {
    throw new Error('Truncated AVIF container');
  }
  if (structure.invalidSter && !structure.stereoPair) {
    throw new Error('Invalid AVIF stereo group (ster): expected 2 distinct non-zero entities');
  }
  if (!structure.stereoPair && structure.depth === undefined) {
    throw new Error('AVIF file does not contain a stereo pair (ster) or depth map');
  }

  if (structure.depth !== undefined) {
    if (!Number.isInteger(structure.depth) || structure.depth <= 0) {
      throw new Error(`Invalid AVIF depth item ID: ${structure.depth}`);
    }
    if (structure.items?.size > 0 && !structure.items.has(structure.depth)) {
      throw new Error(`AVIF depth item ID ${structure.depth} does not exist in iinf`);
    }
  }

  let leftEye;
  let rightEye;
  let depth;

  if (structure.stereoPair) {
    if (!Array.isArray(structure.stereoPair) || structure.stereoPair.length !== 2) {
      throw new Error('Invalid AVIF stereo group (ster): expected 2 distinct non-zero entities');
    }
    const [leftId, rightId] = structure.stereoPair;
    if (!Number.isInteger(leftId) || leftId <= 0 || !Number.isInteger(rightId) || rightId <= 0 || leftId === rightId) {
      throw new Error('Invalid AVIF stereo group (ster): expected 2 distinct non-zero entities');
    }
    if (structure.items?.size > 0 && (!structure.items.has(leftId) || !structure.items.has(rightId))) {
      throw new Error(`AVIF stereo item IDs [${leftId}, ${rightId}] do not exist in iinf`);
    }
    leftEye = await decodeAvifItem(bytes, structure, leftId, url, signal);
    signal?.throwIfAborted();
    rightEye = await decodeAvifItem(bytes, structure, rightId, url, signal);
  } else {
    let primaryId = structure.primary;
    if (primaryId === undefined) {
      for (const [itemId, item] of structure.items.entries()) {
        if (!item.hidden && item.type !== 'Exif' && item.type !== 'mime') {
          primaryId = itemId;
          break;
        }
      }
    }
    if (!Number.isInteger(primaryId) || primaryId <= 0) {
      throw new Error('AVIF depth photo has no valid primary image item');
    }
    if (structure.items?.size > 0 && !structure.items.has(primaryId)) {
      throw new Error(`AVIF primary item ID ${primaryId} does not exist in iinf`);
    }
    leftEye = await decodeAvifItem(bytes, structure, primaryId, url, signal);
    rightEye = leftEye;
  }

  if (structure.depth !== undefined) {
    signal?.throwIfAborted();
    const depthImage = await decodeAvifItem(bytes, structure, structure.depth, url, signal);
    if (structure.depthType === 'disparity') {
      invertDepthData(depthImage);
    }
    depth = imageDataToCanvas(depthImage);
  }

  signal?.throwIfAborted();

  if (!(leftEye?.width > 0 && leftEye?.height > 0 && rightEye?.width > 0 && rightEye?.height > 0)) {
    throw new Error('Decoded AVIF stereo views have invalid non-positive dimensions');
  }

  const exif = await readAvifExif(bytes, structure);
  signal?.throwIfAborted();

  const projection = structure.depth === undefined && options?.projection === 'fisheye' ? 'fisheye' : undefined;
  const angles = anglesOfView(leftEye.width, leftEye.height, { angle: options?.angle, projection, exif });

  return {
    leftEye,
    rightEye,
    ...(depth ? { depth } : {}),
    ...angles,
    ...(projection ? { projection } : {}),
  };
}

export {
  parseAVIFStereo,
  readAvif,
  extractAvifItemBytes,
  patchAvifPrimaryItem,
  invertDepthData,
};

export default parseAVIFStereo;
