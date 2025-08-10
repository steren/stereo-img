import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVR } from '../../parsers/vr-parser/vr-parser.js';
import { readFile } from 'node:fs/promises';
import { loadImage } from 'canvas';

test('parseVR with a real image', async () => {
    const imagePath = './examples/vr180-lenovo-mirage.vr.jpg';
    const data = await readFile(imagePath);
    
    const result = await parseVR(data);

    assert.ok(result.leftEye, 'leftEye is present');
    const leftEyeImage = await loadImage(result.leftEye);
    assert.strictEqual(leftEyeImage.width, 3016, 'leftEye width is correct');
    assert.strictEqual(leftEyeImage.height, 3016, 'leftEye height is correct');

    assert.ok(result.rightEye, 'rightEye is present');
    const rightEyeImage = await loadImage(Buffer.from(result.rightEye.split(',')[1], 'base64'));
    assert.strictEqual(rightEyeImage.width, 3016, 'rightEye width is correct');
    assert.strictEqual(rightEyeImage.height, 3016, 'rightEye height is correct');
});

test('parseVR with pitch and roll', async () => {
    const imagePath = './examples/vr180-lenovo-pitch-roll.vr.jpg';
    const data = await readFile(imagePath);

    const result = await parseVR(data);

    assert.ok(Math.abs(result.pitch - 0.5222936881968275) < 0.0001, 'pitch is correct');
    assert.ok(Math.abs(result.roll - 0.9743192862443497) < 0.0001, 'roll is correct');
});