import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMpoIndex, readStereoPair } from '../../parsers/mpo-parser/mpo-parser.js';

const DISPARITY = 0x020002;
const LARGE_THUMBNAIL = 0x010001;
const PRIMARY = 0x030000;

/**
 * Build a Multi-Picture Format file: a first JPEG holding the index, followed by the other ones.
 * @param {Array<number>} types - type of each image
 * @param {Object} [options] - littleEndian: byte order of the index, corruptOffsets: point the index outside of the file
 */
function makeMpo(types, { littleEndian = true, corruptOffsets = false } = {}) {
  const others = types.slice(1).map((_, i) => new Uint8Array([0xff, 0xd8, 0xaa, i, 0xff, 0xd9]));

  // header (8 bytes) + directory (2 + 3 * 12 + 4 bytes) + one entry of 16 bytes per image
  const entriesOffset = 8 + 2 + 3 * 12 + 4;
  const index = new DataView(new ArrayBuffer(entriesOffset + 16 * types.length));
  index.setUint8(0, littleEndian ? 0x49 : 0x4d);
  index.setUint8(1, littleEndian ? 0x49 : 0x4d);
  index.setUint16(2, 42, littleEndian);
  index.setUint32(4, 8, littleEndian);
  index.setUint16(8, 3, littleEndian);
  const tags = [[0xb000, 7, 4, 0x30303130], [0xb001, 4, 1, types.length], [0xb002, 7, 16 * types.length, entriesOffset]];
  tags.forEach(([tag, type, count, value], i) => {
    index.setUint16(10 + 12 * i, tag, littleEndian);
    index.setUint16(12 + 12 * i, type, littleEndian);
    index.setUint32(14 + 12 * i, count, littleEndian);
    index.setUint32(18 + 12 * i, value, littleEndian);
  });

  // first image: start of image, APP2 segment with the index, a payload, end of image
  const segmentLength = 2 + 4 + index.byteLength;
  const first = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, segmentLength >> 8, segmentLength & 0xff, 0x4d, 0x50, 0x46, 0x00,
    ...new Uint8Array(index.buffer), 0xff, 0xdb, 0x00, 0x03, 0x00, 0xff, 0xd9]);
  const headerPosition = 10;

  let position = first.length;
  types.forEach((type, i) => {
    const entry = entriesOffset + 16 * i;
    const size = i === 0 ? first.length : others[i - 1].length;
    const offset = i === 0 ? 0 : position - headerPosition + (corruptOffsets ? 100000 : 0);
    index.setUint32(entry, (i === 0 ? 0x20000000 : 0) | type, littleEndian);
    index.setUint32(entry + 4, size, littleEndian);
    index.setUint32(entry + 8, offset, littleEndian);
    if (i > 0) {
      position += size;
    }
  });
  first.set(new Uint8Array(index.buffer), headerPosition);

  return new Uint8Array([...first, ...others.flatMap(image => [...image])]);
}

test('reads the index of a picture taken with a Panasonic DMC-GX8', () => {
  const bytes = new Uint8Array(readFileSync(new URL('../../examples/Panasonic-DMC-GX8.mpo', import.meta.url)));

  assert.deepStrictEqual(readMpoIndex(bytes), [
    { type: DISPARITY, offset: 0, size: 1250914 },
    { type: DISPARITY, offset: 1251328, size: 1260771 },
  ]);

  const views = readStereoPair(bytes);
  assert.equal(views.length, 2);
  for (const view of views) {
    assert.deepStrictEqual([...view.subarray(0, 2)], [0xff, 0xd8]);
    assert.deepStrictEqual([...view.subarray(-2)], [0xff, 0xd9]);
  }
});

for (const littleEndian of [true, false]) {
  test(`extracts the two views of a ${littleEndian ? 'little' : 'big'} endian file`, () => {
    const bytes = makeMpo([DISPARITY, DISPARITY], { littleEndian });

    const views = readStereoPair(bytes);

    assert.equal(views.length, 2);
    assert.equal(views[0].byteOffset - bytes.byteOffset, 0);
    assert.deepStrictEqual([...views[1]], [0xff, 0xd8, 0xaa, 0, 0xff, 0xd9]);
  });
}

test('ignores the previews stored next to a regular picture', () => {
  const bytes = makeMpo([PRIMARY, LARGE_THUMBNAIL, LARGE_THUMBNAIL]);

  assert.equal(readMpoIndex(bytes).length, 3);
  assert.deepStrictEqual(readStereoPair(bytes), []);
});

test('uses the first two views of a file with more views', () => {
  const bytes = makeMpo([DISPARITY, LARGE_THUMBNAIL, DISPARITY, DISPARITY]);

  const views = readStereoPair(bytes);

  assert.equal(views.length, 2);
  assert.deepStrictEqual([...views[1]], [0xff, 0xd8, 0xaa, 1, 0xff, 0xd9]);
});

test('ignores index entries pointing outside of the file', () => {
  const bytes = makeMpo([DISPARITY, DISPARITY], { corruptOffsets: true });

  assert.equal(readMpoIndex(bytes).length, 1);
  assert.deepStrictEqual(readStereoPair(bytes), []);
});

test('finds nothing in files that are not Multi-Picture Format', () => {
  const jpeg = new Uint8Array(readFileSync(new URL('../../examples/Panasonic-DMC-GX8-left.jpg', import.meta.url)));
  const truncated = makeMpo([DISPARITY, DISPARITY]).subarray(0, 30);

  for (const bytes of [jpeg, truncated, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), new Uint8Array([1, 2, 3]), new Uint8Array(0)]) {
    assert.deepStrictEqual(readMpoIndex(bytes), []);
    assert.deepStrictEqual(readStereoPair(bytes), []);
  }
});
