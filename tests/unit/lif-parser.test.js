import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLif, readStereoPair, angleOfView } from '../../parsers/lif-parser/lif-parser.js';

const JSON_FIELD = 7;
const jpeg = (...payload) => new Uint8Array([0xff, 0xd8, ...payload, 0xff, 0xd9]);
const uint32 = value => [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

/**
 * Build a LIF file: a first view followed by fields and by the footer.
 * @param {Uint8Array} image - first view
 * @param {Array<[number, Uint8Array]>} fields - type and data of each field
 * @param {Object} [metadata] - description of the views, stored as a JSON field
 */
function makeLif(image, fields, metadata) {
  const all = [...fields];
  if (metadata) {
    all.push([JSON_FIELD, new TextEncoder().encode(JSON.stringify(metadata))]);
  }
  const region = [...uint32(all.length), ...all.flatMap(([type, data]) => [...uint32(type), ...uint32(data.length), ...data])];
  return new Uint8Array([...image, ...region, ...uint32(region.length + 6), 0x1e, 0x1a]);
}

const views = (...list) => ({ views: list.map(([albedoId, xLocation]) => ({ albedoId, disparityId: 0, xLocation, yLocation: 0 })) });

test('reads a picture taken with a Lume Pad 2', () => {
  const bytes = new Uint8Array(readFileSync(new URL('../../examples/leia_lume_pad2.jpg', import.meta.url)));

  const lif = readLif(bytes);
  assert.equal(lif.image.length, 12209881);
  assert.deepStrictEqual([...lif.fields].map(([type, data]) => [type, data.length]), [[0, 4], [1, 4], [1000001, 12039223], [JSON_FIELD, 370]]);
  assert.equal(lif.metadata.views.length, 2);

  const pair = readStereoPair(bytes);
  assert.equal(pair.left.length, 12209881);
  assert.equal(pair.right.length, 12039223);
  for (const view of [pair.left, pair.right]) {
    assert.deepStrictEqual([...view.subarray(0, 2)], [0xff, 0xd8]);
    assert.deepStrictEqual([...view.subarray(-2)], [0xff, 0xd9]);
  }
  assert.ok(Math.abs(angleOfView(pair.metadata) - 65.5) < 0.1);
});

test('uses the first view as the left one when it is on the left', () => {
  const first = jpeg(1);
  const second = jpeg(2);
  const pair = readStereoPair(makeLif(first, [[1000001, second]], views([-1, 0], [1000001, 1])));

  assert.deepStrictEqual([...pair.left], [...first]);
  assert.deepStrictEqual([...pair.right], [...second]);
});

test('orders the views by their horizontal position', () => {
  const first = jpeg(1);
  const second = jpeg(2);
  const pair = readStereoPair(makeLif(first, [[1000001, second]], views([-1, 1], [1000001, 0])));

  assert.deepStrictEqual([...pair.left], [...second]);
  assert.deepStrictEqual([...pair.right], [...first]);
});

test('uses the outermost views of a file with more than two views', () => {
  const images = [jpeg(1), jpeg(2), jpeg(3), jpeg(4)];
  const bytes = makeLif(images[0], [[1000001, images[1]], [1000002, images[2]], [1000003, images[3]]],
    views([-1, 0], [1000001, 1], [1000002, 2], [1000003, 3]));

  const pair = readStereoPair(bytes);

  assert.deepStrictEqual([...pair.left], [...images[0]]);
  assert.deepStrictEqual([...pair.right], [...images[3]]);
});

test('uses the images in the order of the file when the views are not described', () => {
  const first = jpeg(1);
  const second = jpeg(2);
  const pair = readStereoPair(makeLif(first, [[0, new Uint8Array(uint32(4))], [1000001, second]]));

  assert.deepStrictEqual([...pair.left], [...first]);
  assert.deepStrictEqual([...pair.right], [...second]);
});

test('finds no pair in a file with a single view', () => {
  const bytes = makeLif(jpeg(1), [[1000001, new Uint8Array([1, 2, 3])]], views([-1, 0]));

  assert.ok(readLif(bytes));
  assert.equal(readStereoPair(bytes), undefined);
});

test('ignores views whose image is missing', () => {
  const bytes = makeLif(jpeg(1), [], views([-1, 0], [1000001, 1]));

  assert.equal(readStereoPair(bytes), undefined);
});

test('rejects files that are not in the Leia Image Format', () => {
  const lif = makeLif(jpeg(1), [[1000001, jpeg(2)]], views([-1, 0], [1000001, 1]));
  const wrongSize = lif.slice();
  wrongSize.set(uint32(lif.length + 10), lif.length - 6);
  const wrongCount = lif.slice();
  wrongCount.set(uint32(50), jpeg(1).length);

  for (const bytes of [
    new Uint8Array(readFileSync(new URL('../../examples/Panasonic-DMC-GX8-left.jpg', import.meta.url))),
    lif.subarray(0, lif.length - 1),
    lif.subarray(1),
    wrongSize,
    wrongCount,
    jpeg(1),
    new Uint8Array([0x1e, 0x1a]),
    new Uint8Array(0),
  ]) {
    assert.equal(readLif(bytes), undefined);
    assert.equal(readStereoPair(bytes), undefined);
  }
});

test('computes the angle of view from the focal length', () => {
  assert.ok(Math.abs(angleOfView({ cameraFocalRatioToWidth: 0.5 }) - 90) < 1e-9);
  assert.equal(angleOfView({}), undefined);
  assert.equal(angleOfView({ cameraFocalRatioToWidth: 0 }), undefined);
  assert.equal(angleOfView(undefined), undefined);
});
