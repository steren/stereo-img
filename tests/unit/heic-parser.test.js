import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readHeic } from '../../parsers/heic-parser/heic-parser.js';

/** A box: its size, its type, then its content. */
function box(type, ...contents) {
  const content = contents.flatMap(part => Array.from(part));
  const size = 8 + content.length;
  return new Uint8Array([size >>> 24, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...Array.from(type, c => c.charCodeAt(0)), ...content]);
}
const u32 = (...values) => new Uint8Array(values.flatMap(v => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]));
const text = value => new Uint8Array(Array.from(value, c => c.charCodeAt(0)));
const concat = (...parts) => new Uint8Array(parts.flatMap(part => Array.from(part)));

function makeHeif({ brand = 'heic', compatible = ['mif1', 'heic'], primary = 1, stereo = null } = {}) {
  const ftyp = box('ftyp', text(brand), u32(0), ...compatible.map(text));
  const metaChildren = [box('pitm', u32(0).subarray(0, 4), new Uint8Array([0, primary]))];
  if (stereo) {
    // version and flags, group ID, number of entities, entities
    metaChildren.push(box('grpl', box('ster', u32(0, 99, stereo.length, ...stereo))));
  }
  return concat(ftyp, box('meta', u32(0), ...metaChildren));
}

function makeHeicWithAuxDepth({ primary = 1, auxId = 2, auxType = 'urn:com:apple:photo:2018:aux:disparity', extraProps = [] } = {}) {
  const ftyp = box('ftyp', text('heic'), u32(0), text('mif1'), text('heic'));
  const pitm = box('pitm', u32(0).subarray(0, 4), new Uint8Array([0, primary]));
  const auxl = box('auxl', new Uint8Array([0, auxId, 0, 1, 0, primary]));
  const iref = box('iref', u32(0), auxl);

  const auxCText = concat(text(auxType), new Uint8Array([0]));
  const auxC = box('auxC', u32(0), auxCText);
  const ipcoChildren = [auxC];
  for (const ep of extraProps) {
    ipcoChildren.push(box('auxC', u32(0), concat(text(ep), new Uint8Array([0]))));
  }
  const ipco = box('ipco', ...ipcoChildren);

  const ipmaEntries = [
    0, 0, 0, 0, // version & flags
    0, 0, 0, 1, // 1 entry
    0, auxId,   // item ID
    1,          // assoc count
    1           // prop 1
  ];
  const ipma = box('ipma', new Uint8Array(ipmaEntries));
  const iprp = box('iprp', ipco, ipma);

  return concat(ftyp, box('meta', u32(0), pitm, iref, iprp));
}

test('reads the auxiliary disparity item of an Apple Portrait HEIC file', () => {
  const bytes = makeHeicWithAuxDepth({ primary: 1, auxId: 42, auxType: 'urn:com:apple:photo:2018:aux:disparity' });
  const result = readHeic(bytes);
  assert.equal(result.primary, 1);
  assert.equal(result.depth, 42);
  assert.equal(result.stereoPair, undefined);
});

test('handles multiple auxiliary items and selects disparity while ignoring matte masks and gain maps', () => {
  const bytes = makeHeicWithAuxDepth({
    primary: 1,
    auxId: 10,
    auxType: 'urn:com:apple:photo:2018:aux:disparity',
    extraProps: ['urn:com:apple:photo:2020:aux:portraitmatte', 'urn:com:apple:photo:2020:aux:hdrgainmap'],
  });
  const result = readHeic(bytes);
  assert.equal(result.primary, 1);
  assert.equal(result.depth, 10);
  assert.equal(result.stereoPair, undefined);
});

test('a HEIC file with non-depth auxiliary items has no depth map', () => {
  const bytes = makeHeicWithAuxDepth({ primary: 1, auxId: 5, auxType: 'urn:com:apple:photo:2020:aux:portraitmatte' });
  const result = readHeic(bytes);
  assert.equal(result.primary, 1);
  assert.equal(result.depth, undefined);
  assert.equal(result.stereoPair, undefined);
});

test('reads the stereo pair of the Apple Vision Pro sample', () => {
  const bytes = new Uint8Array(readFileSync(new URL('../../examples/vision-pro.HEIC', import.meta.url)));
  assert.deepStrictEqual(readHeic(bytes), { primary: 26, stereoPair: [26, 52] });
});

test('reads the left then the right image of a stereo pair', () => {
  assert.deepStrictEqual(readHeic(makeHeif({ primary: 7, stereo: [8, 7] })), { primary: 7, stereoPair: [8, 7] });
});

test('a HEIC file without stereo pair has only a primary image', () => {
  assert.deepStrictEqual(readHeic(makeHeif({ primary: 3 })), { primary: 3, stereoPair: undefined });
});

test('a group of a single image is not a stereo pair', () => {
  assert.strictEqual(readHeic(makeHeif({ stereo: [1] })).stereoPair, undefined);
});

test('AVIF and other files are not HEIC files', () => {
  assert.strictEqual(readHeic(makeHeif({ brand: 'avif', compatible: ['mif1', 'avif'] })), undefined);
  assert.strictEqual(readHeic(makeHeif({ brand: 'isom', compatible: ['mp41'] })), undefined);
  assert.strictEqual(readHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16])), undefined);
  assert.strictEqual(readHeic(new Uint8Array(0)), undefined);
});

test('a truncated file is still a HEIC file, without stereo pair', () => {
  const bytes = makeHeif({ stereo: [1, 2] });
  assert.deepStrictEqual(readHeic(bytes.subarray(0, bytes.length - 6)), { primary: undefined, stereoPair: undefined });
});
