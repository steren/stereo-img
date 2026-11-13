import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDepth } from '../../parsers/depth-parser/depth-parser.js';

/** An image that records where it is loaded from. */
class FakeImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this._src = '';
  }
  set src(value) { this._src = value; if (value) setImmediate(() => this.onload?.()); }
  get src() { return this._src; }
}

/** A JPEG whose metadata holds the given XMP attributes. */
function makeJpeg(attributes) {
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:GDepth="http://ns.google.com/photos/1.0/depthmap/"
    xmlns:GImage="http://ns.google.com/photos/1.0/image/"
${Object.entries(attributes).map(([name, value]) => `    ${name}="${value}"`).join('\n')}/>
 </rdf:RDF>
</x:xmpmeta>`;
  const content = [...Buffer.from('http://ns.adobe.com/xap/1.0/\0' + xmp, 'latin1')];
  const length = content.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...content, 0x00, 0xff, 0xd9]);
}

async function parse(file, options) {
  const originals = { Image: global.Image, fetch: global.fetch };
  global.Image = FakeImage;
  global.fetch = async () => ({ arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) });
  try {
    return await parseDepth('picture.jpg', options);
  } finally {
    Object.assign(global, originals);
  }
}

const DEPTH = { 'GDepth:Format': 'RangeInverse', 'GDepth:Near': '1.5', 'GDepth:Far': '20', 'GDepth:Mime': 'image/png', 'GDepth:Data': 'REVQVEg=' };

test('parseDepth reads a depth map stored in the GDepth metadata', async () => {
  const result = await parse(makeJpeg(DEPTH));

  assert.equal(result.depth.src, 'data:image/png;base64,REVQVEg=');
  // the picture is the file itself
  assert.equal(result.leftEye.src, 'picture.jpg');
  assert.equal(result.rightEye, result.leftEye);
});

test('parseDepth displays the original picture stored next to a GDepth depth map', async () => {
  const result = await parse(makeJpeg({ ...DEPTH, 'GImage:Mime': 'image/jpeg', 'GImage:Data': 'T1JJR0lOQUw=' }));

  assert.equal(result.depth.src, 'data:image/png;base64,REVQVEg=');
  assert.equal(result.leftEye.src, 'data:image/jpeg;base64,T1JJR0lOQUw=');
  assert.equal(result.rightEye, result.leftEye);
});

test('parseDepth assumes a PNG depth map and a JPEG picture when their types are not given', async () => {
  const result = await parse(makeJpeg({ 'GDepth:Data': 'REVQVEg=', 'GImage:Data': 'T1JJR0lOQUw=' }));

  assert.equal(result.depth.src, 'data:image/png;base64,REVQVEg=');
  assert.equal(result.leftEye.src, 'data:image/jpeg;base64,T1JJR0lOQUw=');
});

test('parseDepth uses the metadata it is given', async () => {
  // the file itself has no metadata
  const result = await parse(new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9]), { exif: { GDepth: { Mime: 'image/jpeg', Data: 'QUJD' } } });

  assert.equal(result.depth.src, 'data:image/jpeg;base64,QUJD');
});

test('parseDepth does not take a second image alone for a depth map', async () => {
  // a VR photo holds a second image, but no depth map
  await assert.rejects(parse(makeJpeg({ 'GImage:Mime': 'image/jpeg', 'GImage:Data': 'T1JJR0lOQUw=' })), /No depth map found/);
});
