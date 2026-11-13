import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDepth } from '../../parsers/depth-parser/depth-parser.js';

class FakeImage {
  constructor() {
    this._src = '';
    this._onload = null;
  }
  set src(v) {
    this._src = v;
    if (this._onload) setImmediate(this._onload);
  }
  get src() { return this._src; }
  set onload(fn) {
    this._onload = fn;
    if (this._src) setImmediate(fn);
  }
  get onload() { return this._onload; }
}

/** A minimal JPEG: start of image, optional segments, a payload and end of image. */
function makeJPEG(payload, segments = []) {
  return new Uint8Array([0xff, 0xd8, ...segments.flat(), ...payload, 0xff, 0xd9]);
}

/** An APP1 segment with XMP metadata listing the images appended to the file. */
function makeContainerSegment(items) {
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:Container="http://ns.google.com/photos/1.0/container/"
    xmlns:Item="http://ns.google.com/photos/1.0/container/item/">
   <Container:Directory>
    <rdf:Seq>
${items.map(({ semantic, length }) => `     <rdf:li rdf:parseType="Resource">
      <Container:Item Item:Mime="image/jpeg" Item:Semantic="${semantic}" Item:Length="${length}"/>
     </rdf:li>`).join('\n')}
    </rdf:Seq>
   </Container:Directory>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
  const content = [...Buffer.from('http://ns.adobe.com/xap/1.0/\0' + xmp, 'latin1')];
  const length = content.length + 2;
  return [0xff, 0xe1, length >> 8, length & 0xff, ...content];
}

/**
 * Run parseDepth on the given file content and return the bytes it picked as
 * the depth map.
 */
async function parseDepthMapBytes(file) {
  const originals = { Image: global.Image, fetch: global.fetch, createObjectURL: URL.createObjectURL };
  let depthBlob;
  global.Image = FakeImage;
  global.fetch = async () => ({ arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) });
  URL.createObjectURL = blob => {
    depthBlob = blob;
    return 'blob:depth';
  };
  try {
    await parseDepth('portrait.jpg');
    return Array.from(new Uint8Array(await depthBlob.arrayBuffer()));
  } finally {
    global.Image = originals.Image;
    global.fetch = originals.fetch;
    URL.createObjectURL = originals.createObjectURL;
  }
}

test('parseDepth finds the depth map described by the Container metadata', async () => {
  const depth = makeJPEG([1, 2, 3]);
  const confidence = makeJPEG([4, 5]);
  const primary = makeJPEG([0], [makeContainerSegment([
    { semantic: 'Primary', length: 0 },
    { semantic: 'Depth', length: depth.length },
    { semantic: 'Confidence', length: confidence.length },
  ])]);

  const bytes = await parseDepthMapBytes(new Uint8Array([...primary, ...depth, ...confidence]));

  assert.deepStrictEqual(bytes, Array.from(depth));
});

test('parseDepth finds a depth map that is the last image of the file', async () => {
  const gainMap = makeJPEG([9, 9, 9, 9]);
  const depth = makeJPEG([1, 2, 3]);
  const primary = makeJPEG([0], [makeContainerSegment([
    { semantic: 'Primary', length: 0 },
    { semantic: 'GainMap', length: gainMap.length },
    { semantic: 'Depth', length: depth.length },
  ])]);

  const bytes = await parseDepthMapBytes(new Uint8Array([...primary, ...gainMap, ...depth]));

  assert.deepStrictEqual(bytes, Array.from(depth));
});

test('parseDepth falls back to the fifth image without metadata', async () => {
  const images = [0, 1, 2, 3, 4, 5].map(value => makeJPEG([value]));

  const bytes = await parseDepthMapBytes(new Uint8Array(images.flatMap(image => [...image])));

  assert.deepStrictEqual(bytes, Array.from(images[4]));
});

test('parseDepth rejects a picture without depth map', async () => {
  await assert.rejects(parseDepthMapBytes(makeJPEG([0])), /No depth map found/);
});
