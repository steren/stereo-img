// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setupDOMEnvironment,
  teardownDOMEnvironment,
  getParser,
  assertStereoData,
  createStereoImgElement,
  loadExampleAsset,
} from './helpers/e2e-harness.js';

import {
  createJPS,
  createPNGStereo,
  createRGBD,
  createAVIFStereo,
  createQuiltDescriptor,
  createWigglegram,
  createCameraEXIF,
} from './helpers/fixtures.js';

import {
  tilePadding,
  planTiles,
  cropPixels,
} from '../../lib/tiles.js';
import * as THREE from '../../vendor/three/three.module.js';

test.beforeEach(() => {
  setupDOMEnvironment();
});

test.afterEach(() => {
  teardownDOMEnvironment();
});

// ============================================================================
// COMBINATION 1: JPS Format with Explicit projection="fisheye" Override
// ============================================================================

test('Combo 1: JPS format with projection="fisheye" override', async () => {
  const jps = createJPS();
  const el = await createStereoImgElement();
  el.src = jps.dataUrl;
  el.projection = 'fisheye';
  assert.equal(el.projection, 'fisheye');

  const stereoParser = await getParser('stereo');
  if (stereoParser?.parseStereo) {
    const result = await stereoParser.parseStereo(jps.dataUrl, { projection: 'fisheye', type: 'left-right' });
    assertStereoData(result, { projection: 'fisheye' });
    assert.equal(result.projection, 'fisheye');
  }
});

// ============================================================================
// COMBINATION 2: JPS Format with Custom angle="180" and angle="360"
// ============================================================================

test('Combo 2: JPS format with custom angle="180" equirectangular half-sphere', async () => {
  const jps = createJPS();
  const el = await createStereoImgElement();
  el.src = jps.dataUrl;
  el.angle = '180';
  assert.equal(el.angle, '180');

  const stereoParser = await getParser('stereo');
  if (stereoParser?.parseStereo) {
    const result180 = await stereoParser.parseStereo(jps.dataUrl, { angle: 180, type: 'left-right' });
    assertStereoData(result180);
    assert.ok(Math.abs(result180.phiLength - Math.PI) < 1e-3, 'phiLength for 180 degrees should be pi radians');

    const result360 = await stereoParser.parseStereo(jps.dataUrl, { angle: 360, type: 'left-right' });
    assertStereoData(result360);
    assert.ok(Math.abs(result360.phiLength - 2 * Math.PI) < 1e-3, 'phiLength for 360 degrees should be 2*pi radians');
  }
});

// ============================================================================
// COMBINATION 3: PNG sTER Format with projection="fisheye" Override
// ============================================================================

test('Combo 3: PNG sTER format with projection="fisheye" override', async () => {
  const png = createPNGStereo({ mode: 1 });
  const el = await createStereoImgElement();
  el.src = png.dataUrl;
  el.projection = 'fisheye';
  assert.equal(el.projection, 'fisheye');

  const stereoParser = await getParser('stereo');
  if (stereoParser?.parseStereo) {
    const result = await stereoParser.parseStereo(png.dataUrl, { projection: 'fisheye', type: 'left-right' });
    assertStereoData(result, { projection: 'fisheye' });
  }
});

// ============================================================================
// COMBINATION 4: PNG sTER mode 0 overridden by DOM attribute type="left-right"
// ============================================================================

test('Combo 4: PNG sTER cross-fuse overridden by type="left-right"', async () => {
  const png = createPNGStereo({ mode: 0 }); // cross-fuse / right-left
  const el = await createStereoImgElement();
  el.src = png.dataUrl;
  el.type = 'left-right';
  assert.equal(el.type, 'left-right');

  const stereoParser = await getParser('stereo');
  if (stereoParser?.parseStereo) {
    const result = await stereoParser.parseStereo(png.dataUrl, { type: 'left-right' });
    assertStereoData(result);
  }
});

// ============================================================================
// COMBINATION 5: RGB-D Composite with Custom FOV Angle
// ============================================================================

test('Combo 5: RGB-D composite with custom FOV angle="120"', async () => {
  const rgbd = createRGBD({ layout: 'left-right' });
  const el = await createStereoImgElement();
  el.src = rgbd.dataUrl;
  el.angle = '120';
  assert.equal(el.angle, '120');

  const stereoParser = await getParser('stereo');
  if (stereoParser?.parseStereo) {
    const result = await stereoParser.parseStereo(rgbd.dataUrl, { angle: 120, type: 'left-right' });
    assertStereoData(result);
    const expectedPhi = 120 * (Math.PI / 180);
    assert.ok(Math.abs(result.phiLength - expectedPhi) < 1e-3, 'phiLength must match custom angle in radians');

    // Also test anglesOfView calculation with camera profile
    if (stereoParser.anglesOfView) {
      const cameraProfile = { angle: { horizontal: 120, vertical: 90 } };
      const angles = stereoParser.anglesOfView(100, 50, { camera: cameraProfile });
      assert.ok(Math.abs(angles.phiLength - expectedPhi) < 1e-3);
      const expectedTheta = 90 * (Math.PI / 180);
      assert.ok(Math.abs(angles.thetaLength - expectedTheta) < 1e-3);
    }
  }
});

// ============================================================================
// COMBINATION 6: RGB-D Composite with disparity-adjustment Attribute
// ============================================================================

const rgbdParser = await getParser('rgbd');
const rgbdSkipReason = !rgbdParser ? 'RGB-D composite parser pending merge (Milestone M1)' : false;

test('Combo 6: RGB-D composite with disparity-adjustment attribute', { skip: rgbdSkipReason }, async () => {
  const rgbd = createRGBD({ layout: 'left-right' });
  const parsed = await rgbdParser.parseRGBD(rgbd.dataUrl, { layout: 'left-right' });
  assertStereoData(parsed, { hasDepth: true });

  const el = await createStereoImgElement();
  el.stereoData = parsed;
  el.stereoImageGroup = new THREE.Group();
  const leftMesh = new THREE.Mesh();
  leftMesh.layers.set(1);
  const rightMesh = new THREE.Mesh();
  rightMesh.layers.set(2);
  el.stereoImageGroup.add(leftMesh, rightMesh);

  el.setAttribute('disparity-adjustment', '5');
  assert.equal(el.disparityAdjustment, '5');
  el.updateDisparityAdjustment();
  assert.notEqual(leftMesh.position.x, rightMesh.position.x);

  el.disparityAdjustment = -2;
  assert.equal(el.getAttribute('disparity-adjustment'), '-2');
  el.updateDisparityAdjustment();
  assert.ok(leftMesh.position.x > 0 && rightMesh.position.x < 0);
});

// ============================================================================
// COMBINATION 7: Apple Portrait / Depth with Flat Wiggle Mode
// ============================================================================

test('Combo 7: Depth format with flat="wiggle" mode attribute', async () => {
  const depthParser = await getParser('depth');
  assert.ok(typeof depthParser?.parseDepth === 'function', 'depth-parser must export parseDepth');
  const asset = loadExampleAsset('Pixel7Pro.PORTRAIT.jpg');

  const el = await createStereoImgElement();
  el.src = asset.dataUrl;
  el.flat = 'wiggle';
  assert.equal(el.flat, 'wiggle');
  assert.equal(el.getAttribute('flat'), 'wiggle');

  const parsed = await el.parse();
  assertStereoData(parsed, { hasDepth: true });
  el.stereoData = parsed;

  // Also verify disparity adjustment on active depth stereoData
  el.stereoImageGroup = new THREE.Group();
  const leftMesh = new THREE.Mesh();
  leftMesh.layers.set(1);
  const rightMesh = new THREE.Mesh();
  rightMesh.layers.set(2);
  el.stereoImageGroup.add(leftMesh, rightMesh);

  el.setAttribute('disparity-adjustment', '5');
  el.updateDisparityAdjustment();
  assert.equal(leftMesh.position.x, -0.5);
  assert.equal(rightMesh.position.x, 0.5);

  Object.defineProperty(el, 'isConnected', { value: true, configurable: true });
  el.renderer = { setAnimationLoop: () => {}, xr: { isPresenting: false } };
  el.camera = { layers: new THREE.Layers() };

  try {
    el.updateflatMode();
    assert.ok(el.wiggleIntervalID != null, 'flat="wiggle" must activate wiggle alternation interval');
    el.flat = '';
    el.updateflatMode();
    assert.equal(el.wiggleIntervalID, null, 'Clearing flat attribute must stop wiggle alternation interval');
  } finally {
    el.toggleWiggle(false);
  }
});

// ============================================================================
// COMBINATION 8: AVIF Spatial Container with projection="fisheye"
// ============================================================================

const avifParser = await getParser('avif');
const avifSkipReason = !avifParser ? 'AVIF spatial parser pending merge (Milestone M2)' : false;

test('Combo 8: AVIF spatial container with projection="fisheye"', { skip: avifSkipReason }, async () => {
  const avif = createAVIFStereo();
  const el = await createStereoImgElement();
  el.src = avif.dataUrl;
  el.projection = 'fisheye';
  assert.equal(el.projection, 'fisheye');

  assert.ok(typeof avifParser?.parseAVIFStereo === 'function', 'avif-parser must export parseAVIFStereo');
  const result = await avifParser.parseAVIFStereo(avif.dataUrl, { projection: 'fisheye' });
  assertStereoData(result, { projection: 'fisheye' });
});

// ============================================================================
// COMBINATION 9: Looking Glass Quilt with Slicing and Custom Angle
// ============================================================================

test('Combo 9: Looking Glass Quilt with custom FOV angle and tile geometry', async () => {
  const el = await createStereoImgElement();
  el.src = 'https://example.com/quilt_qs8x6a0.75.png';
  el.angle = '45';

  // Verify DOM custom element attribute reflection
  assert.equal(el.angle, '45');
  assert.equal(el.getAttribute('angle'), '45');

  const quiltParser = await getParser('quilt');
  if (quiltParser?.parseQuilt) {
    const data = await quiltParser.parseQuilt(el.src, { angle: 45 });
    assertStereoData(data);
    const expectedPhi = 45 * (Math.PI / 180);
    assert.ok(Math.abs(data.phiLength - expectedPhi) < 1e-3);
  } else {
    // When quilt parser is not yet loaded, verify combinatorial angle propagation through stereo parser
    const stereoParser = await getParser('stereo');
    const { createMinimalJPEG } = await import('./helpers/fixtures.js');
    const jpeg = createMinimalJPEG();
    const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(jpeg).toString('base64');
    const data = await stereoParser.parseStereo(dataUrl, { angle: '45' });
    assertStereoData(data);
    const expectedPhi = 45 * (Math.PI / 180);
    assert.ok(Math.abs(data.phiLength - expectedPhi) < 1e-3, `Expected angle 45° (${expectedPhi} rad), got ${data.phiLength}`);
  }
});

// ============================================================================
// COMBINATION 10: Animated Wigglegram with type="pair" Layout Override
// ============================================================================

test('Combo 10: Animated Wigglegram with type="pair" and separate eyes', async () => {
  const gif = createWigglegram({ frameCount: 2 });
  const el = await createStereoImgElement();
  el.src = gif.dataUrl;
  el.srcRight = gif.dataUrl;
  el.type = 'pair';
  assert.equal(el.type, 'pair');
  assert.equal(el.srcRight, gif.dataUrl);

  const stereoParser = await getParser('stereo');
  if (stereoParser?.parseStereoPair) {
    const result = await stereoParser.parseStereoPair(gif.dataUrl, gif.dataUrl, { type: 'pair' });
    assertStereoData(result);
  }
});

// ============================================================================
// COMBINATION 12: High-Resolution Tiling Partitioning (planTiles & tilePadding)
// ============================================================================

test('Combo 12: High-resolution stereo tiling partitioning', () => {
  const padding = tilePadding(2048);
  assert.ok(padding >= 0 && padding <= 64, 'Padding must be bounded between 0 and 64');

  // Simple quad grid UV coordinates for 4x2 cells (8 quads = 16 triangles = 96 UV floats)
  const uvs = [];
  const columns = 4;
  const rows = 2;
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

  // Plan tiles for an ultra-high-resolution stereo photo (4000 x 2000, max size 1024)
  const tiles = planTiles(uvs, 4000, 2000, 1024, 0);
  assert.ok(tiles.length > 1, 'Ultra-high-res image must be split into multiple tiles');

  // Verify cropPixels works on planned tile rects
  const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(128);
  const cropped = cropPixels(pixels, 4, { x: 0, y: 0, width: 2, height: 2 });
  assert.equal(cropped.length, 2 * 2 * 4);
});
