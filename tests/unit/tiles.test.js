import test from 'node:test';
import assert from 'node:assert/strict';
import { tilePadding, planTiles, pickTriangles, tileUvs, cropPixels } from '../../lib/tiles.js';

/**
 * The triangles of a picture drawn on a grid: two triangles per cell, the way three.js cuts a plane.
 * @returns {Array<number>} u, v of each corner of each triangle
 */
function gridUvs(columns, rows) {
  const uvs = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const left = column / columns;
      const right = (column + 1) / columns;
      const top = 1 - row / rows;
      const bottom = 1 - (row + 1) / rows;
      uvs.push(left, top, left, bottom, right, top);
      uvs.push(left, bottom, right, bottom, right, top);
    }
  }
  return uvs;
}

/** Check what must be true of any plan. */
function checkPlan(tiles, uvs, width, height, maxSize) {
  const seen = new Set();
  for (const tile of tiles) {
    assert.ok(tile.width >= 1 && tile.width <= maxSize, `a tile is ${tile.width} wide`);
    assert.ok(tile.height >= 1 && tile.height <= maxSize, `a tile is ${tile.height} high`);
    assert.ok(tile.x >= 0 && tile.x + tile.width <= width, 'a tile goes out of the picture, horizontally');
    assert.ok(tile.y >= 0 && tile.y + tile.height <= height, 'a tile goes out of the picture, vertically');
    assert.ok(Number.isInteger(tile.x) && Number.isInteger(tile.y) && Number.isInteger(tile.width) && Number.isInteger(tile.height));
    for (const triangle of tile.triangles) {
      assert.ok(!seen.has(triangle), `triangle ${triangle} is in two tiles`);
      seen.add(triangle);
      for (let corner = 0; corner < 3; corner++) {
        const x = uvs[triangle * 6 + corner * 2] * width;
        const y = (1 - uvs[triangle * 6 + corner * 2 + 1]) * height;
        assert.ok(x >= tile.x - 0.011 && x <= tile.x + tile.width + 0.011, `triangle ${triangle} goes out of its tile, horizontally`);
        assert.ok(y >= tile.y - 0.011 && y <= tile.y + tile.height + 0.011, `triangle ${triangle} goes out of its tile, vertically`);
      }
    }
  }
  assert.equal(seen.size, uvs.length / 6, 'every triangle is in a tile');
}

test('the room around a tile grows with the tiles, up to 64 pixels', () => {
  assert.equal(tilePadding(4096), 64);
  assert.equal(tilePadding(16384), 64);
  assert.equal(tilePadding(256), 32);
  assert.equal(tilePadding(100), 12);
});

test('a picture that fits is one tile, the whole picture', () => {
  const uvs = gridUvs(4, 4);

  const tiles = planTiles(uvs, 1000, 500, 1024);

  assert.equal(tiles.length, 1);
  assert.deepStrictEqual({ ...tiles[0], triangles: undefined }, { x: 0, y: 0, width: 1000, height: 500, triangles: undefined });
  assert.equal(tiles[0].triangles.length, 32);
});

test('a wide picture is cut in columns', () => {
  const uvs = gridUvs(8, 1);

  const tiles = planTiles(uvs, 4000, 500, 1024, 0);

  checkPlan(tiles, uvs, 4000, 500, 1024);
  assert.deepStrictEqual(tiles.map(tile => [tile.x, tile.y, tile.width, tile.height]), [
    [0, 0, 1000, 500], [1000, 0, 1000, 500], [2000, 0, 1000, 500], [3000, 0, 1000, 500],
  ]);
});

test('a large picture is cut in columns and rows', () => {
  const uvs = gridUvs(4, 2);

  const tiles = planTiles(uvs, 4000, 2000, 1024, 0);

  checkPlan(tiles, uvs, 4000, 2000, 1024);
  assert.equal(tiles.length, 8);
  // from the top left corner, row after row
  assert.deepStrictEqual(tiles.slice(0, 5).map(tile => [tile.x, tile.y]), [[0, 0], [1000, 0], [2000, 0], [3000, 0], [0, 1000]]);
  assert.deepStrictEqual(tiles[0].triangles, [0, 1]);
  assert.deepStrictEqual(tiles[4].triangles, [8, 9]);
});

test('a tile takes pixels beyond its triangles, where the picture has them', () => {
  const uvs = gridUvs(4, 1);

  const tiles = planTiles(uvs, 4000, 500, 1100, 50);

  checkPlan(tiles, uvs, 4000, 500, 1100);
  assert.deepStrictEqual(tiles.map(tile => [tile.x, tile.width]), [[0, 1050], [950, 1100], [1950, 1100], [2950, 1050]]);
  // nothing beyond the top and the bottom of the picture
  assert.deepStrictEqual(tiles.map(tile => [tile.y, tile.height]), [[0, 500], [0, 500], [0, 500], [0, 500]]);
});

test('tiles get smaller until their triangles and the room around them fit', () => {
  // 3 cells of 1000 pixels: 2 tiles of 1024 cannot hold them
  const uvs = gridUvs(3, 1);

  const tiles = planTiles(uvs, 3000, 100, 1600, 20);

  checkPlan(tiles, uvs, 3000, 100, 1600);
  assert.equal(tiles.length, 3);
  assert.deepStrictEqual(tiles.map(tile => [tile.x, tile.width]), [[0, 1020], [980, 1040], [1980, 1020]]);
});

test('positions stored with little precision do not make tiles larger', () => {
  // 5 cells of 384 pixels: on 32 bits, a fifth of the width is a hair more than 384 pixels
  const uvs = new Float32Array(gridUvs(5, 3));

  const tiles = planTiles(uvs, 1920, 1080, 512, 64);

  assert.equal(tiles.length, 15);
  assert.deepStrictEqual(tiles.slice(0, 5).map(tile => [tile.x, tile.width]), [[0, 448], [320, 512], [704, 512], [1088, 512], [1472, 448]]);
  assert.deepStrictEqual([tiles[0], tiles[5], tiles[10]].map(tile => [tile.y, tile.height]), [[0, 424], [296, 488], [656, 424]]);
});

test('triangles that are not aligned with the tiles are held whole by one tile', () => {
  // 7 columns of triangles over 3 or 4 columns of tiles
  const uvs = gridUvs(7, 5);

  const tiles = planTiles(uvs, 7000, 5000, 3000);

  checkPlan(tiles, uvs, 7000, 5000, 3000);
  assert.ok(tiles.length >= 6);
});

test('parts of the picture that no triangle shows are in no tile', () => {
  // triangles only on the left half of the picture
  const uvs = gridUvs(2, 1).map((value, i) => i % 2 === 0 ? value / 2 : value);

  const tiles = planTiles(uvs, 4000, 1000, 1000, 0);

  checkPlan(tiles, uvs, 4000, 1000, 1000);
  assert.deepStrictEqual(tiles.map(tile => [tile.x, tile.width]), [[0, 1000], [1000, 1000]]);
});

test('positions outside of the picture are brought back to its edges', () => {
  const uvs = [-0.1, 1.2, -0.1, -0.2, 1.1, 0.5];

  const tiles = planTiles(uvs, 100, 100, 128);

  assert.deepStrictEqual(tiles.map(tile => [tile.x, tile.y, tile.width, tile.height]), [[0, 0, 100, 100]]);
});

test('a triangle that is a single point of the edge of the picture still gets a pixel', () => {
  const uvs = [1, 0, 1, 0, 1, 0];

  const tiles = planTiles(uvs, 100, 50, 128, 0);

  assert.deepStrictEqual(tiles.map(tile => [tile.x, tile.y, tile.width, tile.height]), [[99, 49, 1, 1]]);
});

test('gives up when the triangles are larger than the tiles', () => {
  // two triangles for the whole picture
  assert.equal(planTiles(gridUvs(1, 1), 4000, 4000, 1024), null);
});

test('picks the values of the corners of some triangles', () => {
  // 3 triangles, 2 values per corner
  const values = Array.from({ length: 18 }, (_, i) => i);

  assert.deepStrictEqual([...pickTriangles(values, 2, [2, 0])], [12, 13, 14, 15, 16, 17, 0, 1, 2, 3, 4, 5]);
  assert.deepStrictEqual([...pickTriangles(values, 2, [])], []);
  // 2 triangles, 3 values per corner
  assert.deepStrictEqual([...pickTriangles(values, 3, [1])], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
});

test('places the corners of the triangles on their tile', () => {
  // a triangle over the right half of the top half of the picture
  const uvs = [0.5, 1, 0.5, 0.5, 1, 1];
  const tile = { x: 500, y: 0, width: 500, height: 250, triangles: [0] };

  // the tile is the top right quarter: its bottom left corner is the middle of the picture
  assert.deepStrictEqual([...tileUvs(uvs, tile, 1000, 500)], [0, 1, 0, 0, 1, 1]);
});

test('places the corners inside a tile that has room around its triangles', () => {
  const uvs = [0.5, 0.5, 0.5, 0.25, 0.75, 0.5];
  const tile = { x: 400, y: 200, width: 400, height: 200, triangles: [0] };

  const local = [...tileUvs(uvs, tile, 1000, 500)].map(value => Math.round(value * 1000) / 1000);

  // corners at 500, 250 then 500, 375 then 750, 250 of the picture
  assert.deepStrictEqual(local, [0.25, 0.75, 0.25, 0.125, 0.875, 0.75]);
});

test('copies a rectangle of pixels', () => {
  // 4 by 3 pixels: the red of a pixel is its column, its green is its row
  const data = new Uint8ClampedArray(4 * 3 * 4);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) {
      data.set([x, y, 0, 255], (y * 4 + x) * 4);
    }
  }

  const cropped = cropPixels(data, 4, { x: 1, y: 1, width: 2, height: 2 });

  assert.deepStrictEqual([...cropped], [1, 1, 0, 255, 2, 1, 0, 255, 1, 2, 0, 255, 2, 2, 0, 255]);
  // the copy does not share memory with the picture
  cropped[0] = 99;
  assert.equal(data[(1 * 4 + 1) * 4], 1);
});
