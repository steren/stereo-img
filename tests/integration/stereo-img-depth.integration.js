import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

async function waitFor(condition, description, timeout = 30000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/** Draw something and return it as an image file. */
async function drawPicture(width, height, type, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'));
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

const base64 = bytes => btoa(String.fromCharCode(...bytes));

/**
 * A picture in the "GDepth" format of Google Camera: a JPEG whose metadata holds a depth map,
 * and optionally the original picture.
 * @returns {Promise<string>} its URL
 */
async function makeGDepthPicture({ withOriginal }) {
  const picture = await drawPicture(96, 64, 'image/jpeg', ctx => {
    ctx.fillStyle = 'rgb(90, 120, 150)';
    ctx.fillRect(0, 0, 96, 64);
  });
  const depth = await drawPicture(48, 32, 'image/png', ctx => {
    const gradient = ctx.createLinearGradient(0, 0, 48, 0);
    gradient.addColorStop(0, 'black');
    gradient.addColorStop(1, 'white');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 48, 32);
  });
  const original = await drawPicture(192, 128, 'image/jpeg', ctx => {
    ctx.fillStyle = 'rgb(200, 180, 60)';
    ctx.fillRect(0, 0, 192, 128);
  });

  const attributes = { 'GDepth:Format': 'RangeInverse', 'GDepth:Near': '1.5', 'GDepth:Far': '20', 'GDepth:Mime': 'image/png', 'GDepth:Data': base64(depth) };
  if (withOriginal) {
    Object.assign(attributes, { 'GImage:Mime': 'image/jpeg', 'GImage:Data': base64(original) });
  }
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:GDepth="http://ns.google.com/photos/1.0/depthmap/"
    xmlns:GImage="http://ns.google.com/photos/1.0/image/"
${Object.entries(attributes).map(([name, value]) => `    ${name}="${value}"`).join('\n')}/>
 </rdf:RDF>
</x:xmpmeta>`;
  const content = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0' + xmp);
  const length = content.length + 2;
  expect(length, 'size of the metadata segment').to.be.lessThan(65536);
  // insert the metadata right after the start of the JPEG
  const file = new Uint8Array([...picture.subarray(0, 2), 0xff, 0xe1, length >> 8, length & 0xff, ...content, ...picture.subarray(2)]);
  return URL.createObjectURL(new Blob([file], { type: 'image/jpeg' }));
}

describe('stereo-img depth pictures', function () {
  this.timeout(60000);

  let element;

  afterEach(() => {
    element?.remove();
    element?.renderer?.setAnimationLoop(null);
    element = null;
  });

  async function display(attributes) {
    element = document.createElement('stereo-img');
    element.style.width = '400px';
    element.style.height = '300px';
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
    return element.stereoData;
  }

  const hasRelief = () => element.stereoImageGroup.children.every(mesh => !!mesh.material.displacementMap);

  it('should detect a Pixel portrait picture from its metadata, whatever its name', async () => {
    const response = await fetch('/examples/Pixel7Pro.PORTRAIT.jpg');
    const src = URL.createObjectURL(await response.blob());

    const stereoData = await display({ src });

    expect(stereoData.depth.naturalWidth).to.equal(2024);
    expect(stereoData.leftEye.naturalWidth).to.equal(3072);
    expect(stereoData.leftEye === stereoData.rightEye).to.be.true;
    expect(hasRelief()).to.be.true;
  });

  for (const type of [undefined, 'depth']) {
    it(`should display a GDepth picture${type ? ` with type="${type}"` : ', detected from its metadata'}`, async () => {
      const src = await makeGDepthPicture({ withOriginal: false });

      const stereoData = await display(type ? { src, type } : { src });

      expect(stereoData.depth.naturalWidth).to.equal(48);
      expect(stereoData.depth.naturalHeight).to.equal(32);
      // the picture is the file itself
      expect(stereoData.leftEye.naturalWidth).to.equal(96);
      expect(stereoData.leftEye === stereoData.rightEye).to.be.true;
      expect(hasRelief()).to.be.true;
    });
  }

  it('should display the original picture stored in a GDepth picture, not as a VR photo', async () => {
    const src = await makeGDepthPicture({ withOriginal: true });

    const stereoData = await display({ src });

    expect(stereoData.depth.naturalWidth).to.equal(48);
    // the original picture, larger than the file itself, in both eyes
    expect(stereoData.leftEye.naturalWidth).to.equal(192);
    expect(stereoData.leftEye === stereoData.rightEye).to.be.true;
    expect(hasRelief()).to.be.true;
  });

  it('should still display a VR photo as a VR photo', async () => {
    const stereoData = await display({ src: '/examples/vr180-lenovo-mirage.vr.jpg' });

    expect(stereoData.depth).to.equal(undefined);
    expect(typeof stereoData.rightEye).to.equal('string');
    expect(hasRelief()).to.be.false;
  });

  it('should not look for a depth map in a picture named like a portrait one', async () => {
    // only the metadata counts
    const stereoData = await display({ src: '/examples/Panasonic-DMC-GX8-left.jpg?name=PORTRAIT.jpg' });

    expect(stereoData.depth).to.equal(undefined);
    expect(stereoData.leftEye.width).to.equal(1824);
  });
});
