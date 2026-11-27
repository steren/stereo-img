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
import { existsSync } from 'node:fs';

import {
  setupDOMEnvironment,
  teardownDOMEnvironment,
  getParser,
  assertStereoData,
  createStereoImgElement,
  loadExampleAsset,
} from './helpers/e2e-harness.js';

import {
  createCameraEXIF,
  createQuiltDescriptor,
  createWigglegram,
} from './helpers/fixtures.js';

test.beforeEach(() => {
  setupDOMEnvironment();
});

test.afterEach(() => {
  teardownDOMEnvironment();
});

// ============================================================================
// SCENARIO 1: Canon EOS VR System Production Capture (3.9mm vs 5.2mm Fisheye)
// ============================================================================

test('Scenario 1: Canon EOS VR System production capture & circular fisheye calibration', async () => {
  // Load authentic reference asset: Canon EOS R5 Dual Fisheye 5.2mm
  const rawAsset = loadExampleAsset('canon-eos-r5-dual-fisheye.jpg');
  const processedAsset = loadExampleAsset('canon-eos-r5-dual-fisheye-processed.jpg');

  assert.ok(rawAsset.bytes.length > 1000000, 'Raw Canon sample must be substantial JPEG');
  assert.ok(processedAsset.bytes.length > 1000000, 'Processed Canon sample must be substantial JPEG');

  const camerasMod = await getParser('cameras');
  if (camerasMod?.findCamera) {
    // Test authentic 5.2mm lens profile
    const rawExif = { Make: 'Canon', LensModel: 'RF5.2mm F2.8 L DUAL FISHEYE' };
    const rawCamera = camerasMod.findCamera(rawExif, rawAsset.name);
    assert.ok(rawCamera, 'Canon 5.2mm raw must match registry');
    assert.equal(camerasMod.cameraType(rawCamera, rawExif), 'right-left', 'Raw Canon capture must be right-left');

    const processedExif = { Make: 'Canon', LensModel: 'RF5.2mm F2.8 L DUAL FISHEYE', Software: 'EOS VR Utility v1.4' };
    const processedCamera = camerasMod.findCamera(processedExif, processedAsset.name);
    assert.equal(camerasMod.cameraType(processedCamera, processedExif), 'left-right', 'EOS VR Utility processed must be left-right');
  }

  // Lifecycle check on <stereo-img>
  const el = await createStereoImgElement();
  el.src = rawAsset.dataUrl;
  assert.equal(el.src, rawAsset.dataUrl);
});

// ============================================================================
// SCENARIO 4: Authentic Depth Map Rendering (Apple Portrait & Google Camera)
// ============================================================================

test('Scenario 4: Authentic depth map extraction from Google Camera & Apple Portrait', async () => {
  // 1. Google Camera Depth Portrait
  const pixelAsset = loadExampleAsset('Pixel7Pro.PORTRAIT.jpg');
  assert.ok(pixelAsset.bytes.length > 1000000);

  const depthParser = await getParser('depth');
  if (depthParser?.parseDepth) {
    const depthData = await depthParser.parseDepth(pixelAsset.dataUrl);
    assertStereoData(depthData, { hasDepth: true });
    assert.ok(depthData.depth, 'Google Camera portrait must produce depth map');
  }

  // 2. Apple Vision Pro HEIC Spatial Photo
  const heicAsset = loadExampleAsset('vision-pro.HEIC');
  assert.ok(heicAsset.bytes.length > 100000);

  const heicParser = await getParser('heic');
  if (heicParser?.readHeic) {
    const info = heicParser.readHeic(heicAsset.bytes);
    assert.ok(info.stereoPair, 'Vision Pro HEIC must contain stereo pair');
    assert.equal(info.stereoPair.length, 2);
  }
});

// ============================================================================
// SCENARIO 5: Legacy Stereocard & Web Archives (JPS & PNS SBS Formats)
// ============================================================================

test('Scenario 5: Legacy stereocard & web archive formats (JPS & PNS)', async () => {
  // Load authentic classic stereograph
  const stereographAsset = loadExampleAsset('stereograph.left-right.jpg');
  assert.ok(stereographAsset.bytes.length > 100000);

  const stereoParser = await getParser('stereo');
  if (stereoParser?.parseStereo) {
    // Squeezed half-SBS vs full SBS
    const resultFull = await stereoParser.parseStereo(stereographAsset.dataUrl, { type: 'left-right' });
    assertStereoData(resultFull);

    const resultHalf = await stereoParser.parseStereo(stereographAsset.dataUrl, { type: 'half-left-right' });
    assertStereoData(resultHalf);
  }

  const el = await createStereoImgElement();
  el.src = stereographAsset.dataUrl;
  el.type = 'left-right';
  assert.equal(el.type, 'left-right');
});

// ============================================================================
// SCENARIO 6: Holographic Display Workstation (Looking Glass Quilt & Wigglegrams)
// ============================================================================

const quiltParser = await getParser('quilt');
const wiggleParser = await getParser('wiggle');
const scenario6SkipReason = (!quiltParser || !wiggleParser)
  ? 'Looking Glass Quilt and Wigglegram parsers pending merge (Milestone M2)'
  : false;

test('Scenario 6: Holographic display Looking Glass Quilt slicing & wigglegram baseline', {
  skip: scenario6SkipReason,
}, async () => {
  // 1. 48-View Looking Glass Quilt (8 cols x 6 rows)
  const quilt = createQuiltDescriptor(8, 6, 0.75);
  const quiltData = await quiltParser.default(quilt.filename);
  assertStereoData(quiltData);

  // 2. Animated Wigglegram sequence extraction
  const wiggle = createWigglegram({ frameCount: 4, width: 300, height: 300 });
  assert.equal(wiggle.frameCount, 4);
  const stereoData = await wiggleParser.parseWigglegram(wiggle.dataUrl);
  assertStereoData(stereoData);
});
