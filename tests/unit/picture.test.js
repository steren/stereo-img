import test from 'node:test';
import assert from 'node:assert/strict';
import { Picture } from '../../lib/picture.js';

let requests;
let originals;

test.beforeEach(() => {
  requests = [];
  originals = { fetch: global.fetch, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  global.fetch = async (url, options) => {
    requests.push({ url, signal: options?.signal });
    if (url.includes('missing')) {
      return { ok: false, status: 404 };
    }
    return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1, 2, 3])]) };
  };
});

test.afterEach(() => {
  global.fetch = originals.fetch;
  URL.createObjectURL = originals.createObjectURL;
  URL.revokeObjectURL = originals.revokeObjectURL;
});

test('downloads the file once, however it is read', async () => {
  const picture = new Picture('picture.jpg');
  assert.equal(requests.length, 0);

  const [blob, bytes, sameBytes, url, sameUrl] = await Promise.all(
    [picture.blob(), picture.bytes(), picture.bytes(), picture.objectURL(), picture.objectURL()]);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'picture.jpg');
  assert.equal(blob.size, 3);
  assert.deepStrictEqual([...bytes], [1, 2, 3]);
  assert.equal(bytes, sameBytes);
  assert.equal(url, sameUrl);
  assert.match(url, /^blob:/);
  picture.release();
});

test('gives its signal to the download', async () => {
  const controller = new AbortController();
  const picture = new Picture('picture.jpg', controller.signal);

  await picture.blob();

  assert.equal(requests[0].signal, controller.signal);
});

test('fails when the server does not have the file', async () => {
  const picture = new Picture('missing.jpg');

  await assert.rejects(picture.bytes(), /Could not download "missing\.jpg": HTTP 404/);
  await assert.rejects(picture.objectURL(), /HTTP 404/);
  assert.equal(requests.length, 1);
  // nothing to release, and no error
  picture.release();
});

test('releases the URL it created', async () => {
  const revoked = [];
  URL.revokeObjectURL = url => revoked.push(url);
  const picture = new Picture('picture.jpg');
  const url = await picture.objectURL();

  picture.release();
  picture.release();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepStrictEqual(revoked, [url]);
});

test('has nothing to release when no URL was asked for', async () => {
  const revoked = [];
  URL.revokeObjectURL = url => revoked.push(url);
  const picture = new Picture('picture.jpg');
  await picture.bytes();

  picture.release();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepStrictEqual(revoked, []);
});
