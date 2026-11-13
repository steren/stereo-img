import test from 'node:test';
import assert from 'node:assert/strict';
import { directionOfSelect, directionOfThumbstick } from '../../lib/xrInput.js';

/** A controller whose thumbstick is at a position. */
const controller = (x = 0, y = 0) => ({ handedness: 'right', gamepad: { axes: [0, 0, x, y] } });

/** Move the thumbstick of a controller through positions and collect what it asks for. */
function move(positions) {
  const pushed = new WeakSet();
  const source = controller();
  return positions.map(position => {
    const [x, y] = [].concat(position);
    source.gamepad.axes[2] = x;
    source.gamepad.axes[3] = y || 0;
    return directionOfThumbstick(pushed, source);
  });
}

test('the trigger of the right hand asks for the next picture, the left hand for the previous one', () => {
  assert.equal(directionOfSelect('right'), 'next');
  assert.equal(directionOfSelect('left'), 'previous');
});

test('a device without hands asks for the next picture', () => {
  assert.equal(directionOfSelect('none'), 'next');
  assert.equal(directionOfSelect(undefined), 'next');
});

test('a thumbstick pushed to the right asks for the next picture, to the left for the previous one', () => {
  assert.deepStrictEqual(move([0, 1]), [null, 'next']);
  assert.deepStrictEqual(move([0, -1]), [null, 'previous']);
});

test('a thumbstick that stays pushed asks once', () => {
  assert.deepStrictEqual(move([0, 0.5, 0.8, 1, 1, 0.9, 0.75]), [null, null, 'next', null, null, null, null]);
});

test('a thumbstick asks again after coming back to its centre', () => {
  assert.deepStrictEqual(move([1, 0.5, 1, 0.2, 1, 0, -1]), ['next', null, null, null, 'next', null, 'previous']);
});

test('a thumbstick pushed from one side to the other without stopping at the centre asks once', () => {
  assert.deepStrictEqual(move([1, -1, 0, -1]), ['next', null, null, 'previous']);
});

test('a thumbstick that is not pushed far enough asks for nothing', () => {
  assert.deepStrictEqual(move([0.3, 0.6, 0.69, -0.69]), [null, null, null, null]);
});

test('a thumbstick pushed up or down asks for nothing', () => {
  assert.deepStrictEqual(move([[0, 1], [0, -1], [0.75, 0.9], [-0.8, -1]]), [null, null, null, null]);
  // and must come back before asking, even when it then leans to the side
  assert.deepStrictEqual(move([[0.2, 1], [0.9, 0.5], [0, 0], [0.9, 0.5]]), [null, 'next', null, 'next']);
});

test('each controller is followed on its own', () => {
  const pushed = new WeakSet();
  const left = controller(1);
  const right = controller(1);

  assert.equal(directionOfThumbstick(pushed, left), 'next');
  assert.equal(directionOfThumbstick(pushed, right), 'next');
  assert.equal(directionOfThumbstick(pushed, left), null);
  right.gamepad.axes[2] = 0;
  assert.equal(directionOfThumbstick(pushed, right), null);
  right.gamepad.axes[2] = -1;
  assert.equal(directionOfThumbstick(pushed, right), 'previous');
  assert.equal(directionOfThumbstick(pushed, left), null);
});

test('a controller without a thumbstick asks for nothing', () => {
  const pushed = new WeakSet();

  assert.equal(directionOfThumbstick(pushed, { handedness: 'none' }), null);
  assert.equal(directionOfThumbstick(pushed, { gamepad: null }), null);
  // a touchpad only
  assert.equal(directionOfThumbstick(pushed, { gamepad: { axes: [1, 0] } }), null);
});
