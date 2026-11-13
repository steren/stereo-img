import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeColors } from '../../lib/edgeColors.js';

/** A picture where every row has one colour. */
function makePicture(rows, width = 4) {
  const data = new Uint8ClampedArray(rows.length * width * 4);
  rows.forEach((color, y) => {
    for (let x = 0; x < width; x++) {
      data.set(color, (y * width + x) * 4);
    }
  });
  return { data, width, height: rows.length };
}

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

test('gives the colours of the first and last rows of a small picture', () => {
  const colors = edgeColors(makePicture([RED, GREEN, GREEN, BLUE]));

  assert.deepStrictEqual(colors, { top: [255, 0, 0], bottom: [0, 0, 255] });
});

test('averages a band at each edge of a larger picture', () => {
  // 20 rows: each edge is 2 rows
  const rows = [RED, BLUE, ...Array(16).fill(GREEN), BLUE, BLUE];

  const colors = edgeColors(makePicture(rows));

  assert.deepStrictEqual(colors, { top: [127.5, 0, 127.5], bottom: [0, 0, 255] });
});

test('uses the share of the height it is given', () => {
  const rows = [RED, RED, RED, RED, GREEN, GREEN, BLUE, BLUE, BLUE, BLUE];

  assert.deepStrictEqual(edgeColors(makePicture(rows), { band: 0.4 }), { top: [255, 0, 0], bottom: [0, 0, 255] });
  assert.deepStrictEqual(edgeColors(makePicture(rows), { band: 0.5 }).top, [204, 51, 0]);
});

test('ignores transparent pixels', () => {
  const picture = makePicture([RED, GREEN]);
  // half of the first row is transparent
  picture.data.set(CLEAR, 0);
  picture.data.set(CLEAR, 4);

  assert.deepStrictEqual(edgeColors(picture).top, [255, 0, 0]);
});

test('gives black for an edge that is entirely transparent', () => {
  const colors = edgeColors(makePicture([CLEAR, GREEN, BLUE]));

  assert.deepStrictEqual(colors, { top: [0, 0, 0], bottom: [0, 0, 255] });
});

test('handles a picture of one row', () => {
  assert.deepStrictEqual(edgeColors(makePicture([GREEN])), { top: [0, 255, 0], bottom: [0, 255, 0] });
});

test('samples large pictures instead of reading every pixel', () => {
  // 1000 rows: each edge is 100 rows of 2000 pixels
  const rows = [...Array(100).fill(RED), ...Array(800).fill(GREEN), ...Array(100).fill(BLUE)];
  const picture = makePicture(rows, 2000);
  let reads = 0;
  const counted = { width: picture.width, height: picture.height, data: new Proxy(picture.data, {
    get(target, property) {
      reads++;
      return target[property];
    },
  }) };

  const colors = edgeColors(counted);

  assert.deepStrictEqual(colors, { top: [255, 0, 0], bottom: [0, 0, 255] });
  assert.ok(reads < 20000, `read ${reads} values of a picture of ${picture.data.length}`);
});

test('ignores what is around the disc of a fisheye picture', () => {
  // a white disc on black, with a red top and a blue bottom
  const size = 100;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const inside = dx * dx + dy * dy <= 1;
      const color = !inside ? [0, 0, 0, 255] : y < 20 ? RED : y >= 80 ? BLUE : [255, 255, 255, 255];
      data.set(color, (y * size + x) * 4);
    }
  }
  const picture = { data, width: size, height: size };

  assert.deepStrictEqual(edgeColors(picture, { circle: true }), { top: [255, 0, 0], bottom: [0, 0, 255] });
  // without knowing about the disc, the black corners darken the colours
  assert.ok(edgeColors(picture).top[0] < 200);
});
