import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERAS, findCamera, cameraType, fisheyeCircleSquares, fisheyeCirclesFit } from '../../parsers/stereo-parser/cameras.js';

const CANON = { Make: 'Canon', LensModel: 'RF5.2mm F2.8 L DUAL FISHEYE' };

test('finds the Canon dual fisheye lens from the metadata', () => {
  const camera = findCamera(CANON, 'picture.jpg');

  assert.equal(camera.name, 'Canon RF5.2mm F2.8 L Dual Fisheye');
  assert.deepStrictEqual(camera.angle, { horizontal: 180, vertical: 180 });
});

test('pictures of the Canon dual fisheye lens are right-left, unless processed with EOS VR Utility', () => {
  const camera = findCamera(CANON, 'picture.jpg');

  assert.equal(cameraType(camera, CANON), 'right-left');
  assert.equal(cameraType(camera, { ...CANON, Software: 'EOS VR Utility 1.2.10' }), 'left-right');
  assert.equal(cameraType(camera, { ...CANON, Software: 'Adobe Photoshop' }), 'right-left');
});

test('places the fisheye circles of the Canon lens as on the reference picture', () => {
  const { fisheyeCircles } = findCamera(CANON, 'picture.jpg');

  assert.deepStrictEqual(fisheyeCircleSquares(fisheyeCircles, 8192, 5464), {
    left: { x: 133, y: 882, size: 3700 },
    right: { x: 4359, y: 882, size: 3700 },
  });
});

test('scales the fisheye circles to the size of the picture', () => {
  const { fisheyeCircles } = findCamera(CANON, 'picture.jpg');

  assert.deepStrictEqual(fisheyeCircleSquares(fisheyeCircles, 4096, 2732), {
    left: { x: 67, y: 441, size: 1850 },
    right: { x: 2180, y: 441, size: 1850 },
  });
});

test('keeps the fisheye circles round and in the middle of a picture of another shape', () => {
  const { fisheyeCircles } = findCamera(CANON, 'picture.jpg');

  // a frame of a video is less high than a photo
  assert.deepStrictEqual(fisheyeCircleSquares(fisheyeCircles, 8192, 4320), {
    left: { x: 133, y: 310, size: 3700 },
    right: { x: 4359, y: 310, size: 3700 },
  });
});

test('places a fisheye circle lower than the other one', () => {
  const { fisheyeCircles } = findCamera(CANON, 'picture.jpg');

  // the circle on the right is 18 pixels lower: each one takes half of it
  assert.deepStrictEqual(fisheyeCircleSquares(fisheyeCircles, 8192, 5464, 18), {
    left: { x: 133, y: 873, size: 3700 },
    right: { x: 4359, y: 891, size: 3700 },
  });
  // and the other way round
  assert.deepStrictEqual(fisheyeCircleSquares(fisheyeCircles, 8192, 5464, -32), {
    left: { x: 133, y: 898, size: 3700 },
    right: { x: 4359, y: 866, size: 3700 },
  });
});

test('finds a GoPro from the metadata or from the file name', () => {
  for (const [exif, url] of [
    [{ Make: 'GoPro' }, 'picture.jpg'],
    [{}, 'GOPR0123.JPG'],
    [undefined, 'examples/GOPR0.left-right.jpg'],
    [{ Make: 'Other' }, 'https://example.com/pictures/gopro-beach.jpg?size=large#top'],
  ]) {
    const camera = findCamera(exif, url);
    assert.equal(camera?.name, 'GoPro', `${JSON.stringify(exif)} ${url}`);
    assert.deepStrictEqual(camera.angle, { horizontal: 122.6, vertical: 94.4 });
    assert.equal(cameraType(camera, exif), undefined);
  }
});

test('finds the Insta360 Evo from the metadata', () => {
  const camera = findCamera({ Make: 'Arashi Vision', Model: 'insta360 evo' }, 'picture.jpg');

  assert.equal(camera.name, 'Insta360 Evo');
});

test('finds nothing for other pictures', () => {
  for (const [exif, url] of [
    [{}, 'picture.jpg'],
    [undefined, 'picture.jpg'],
    [{ Make: 'Canon', LensModel: 'RF50mm F1.8 STM' }, 'picture.jpg'],
    [{ Make: 'Canon' }, 'picture.jpg'],
    [{ Model: 'Insta360 EVO' }, 'picture.jpg'],
    [{}, 'https://example.com/gopro/picture.jpg'],
    [{}, 'https://example.com/picture.jpg?camera=GOPR0123'],
    [{}, 'data:image/jpeg;base64,AAAA/GOPR0123'],
    [{}, undefined],
  ]) {
    assert.equal(findCamera(exif, url), undefined, `${JSON.stringify(exif)} ${url}`);
  }
  assert.equal(cameraType(undefined, {}), undefined);
});

test('matches metadata exactly or with a regular expression, and uses the first entry that matches', () => {
  const cameras = [
    { name: 'exact', exif: { Make: 'Acme', Model: 'One' } },
    { name: 'pattern', exif: { Make: 'Acme', Model: /^Two/ }, type: 'top-bottom' },
    { name: 'any Acme', exif: { Make: 'Acme' } },
  ];

  assert.equal(findCamera({ Make: 'Acme', Model: 'One' }, 'a.jpg', cameras).name, 'exact');
  assert.equal(findCamera({ Make: 'Acme', Model: 'Two Pro' }, 'a.jpg', cameras).name, 'pattern');
  assert.equal(findCamera({ Make: 'Acme', Model: 'Three' }, 'a.jpg', cameras).name, 'any Acme');
  assert.equal(findCamera({ Make: 'Acme', Model: 2 }, 'a.jpg', cameras).name, 'any Acme');
  assert.equal(findCamera({ Make: 'Other', Model: 'One' }, 'a.jpg', cameras), undefined);
  assert.equal(cameraType(cameras[1], {}), 'top-bottom');
});

test('every camera of the list is well formed', () => {
  for (const camera of CAMERAS) {
    assert.equal(typeof camera.name, 'string');
    assert.ok(camera.exif || camera.fileName, `${camera.name} can be matched`);
    assert.ok(camera.type || camera.angle || camera.fisheyeCircles, `${camera.name} says something`);
    if (camera.angle) {
      assert.ok(camera.angle.horizontal > 0 && camera.angle.horizontal <= 360);
      assert.ok(camera.angle.vertical > 0 && camera.angle.vertical <= 180);
    }
    if (camera.fisheyeCircles) {
      const { width, diameter, leftCenter } = camera.fisheyeCircles;
      assert.ok(diameter > 0 && leftCenter - diameter / 2 >= 0 && leftCenter + diameter / 2 <= width / 2);
    }
  }
  assert.equal(new Set(CAMERAS.map(camera => camera.name)).size, CAMERAS.length);
});

test('the circles of the Canon lens do not fit in pictures much shorter than them', () => {
  const { fisheyeCircles } = findCamera(CANON, 'picture.jpg');

  assert.equal(fisheyeCirclesFit(fisheyeCircles, 8192, 5464), true);
  assert.equal(fisheyeCirclesFit(fisheyeCircles, 8192, 4320), true);
  assert.equal(fisheyeCirclesFit(fisheyeCircles, 32000, 64), false);
  assert.equal(fisheyeCirclesFit(fisheyeCircles, 8192, 0), false);
});
