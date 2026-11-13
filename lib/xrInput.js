/**
 * What the controllers of a headset ask for: the previous picture or the next one.
 */

// How far a thumbstick is pushed to ask for a picture, and how far it comes back before it can ask again.
const PUSHED = 0.7;
const RELEASED = 0.3;

/**
 * Which picture a press of the trigger, or a pinch of the fingers, asks for.
 *
 * @param {string} handedness - the hand of the controller: "left", "right" or "none"
 * @returns {string} "previous" for the left hand, "next" for the right hand and for devices without hands, such as a Cardboard viewer
 */
function directionOfSelect( handedness ) {

	return handedness === 'left' ? 'previous' : 'next';

}

/**
 * Which picture the thumbstick of a controller asks for, if any. To be called on every frame.
 * A push asks once: the thumbstick has to come back to its centre before it asks again.
 *
 * @param {WeakSet<Object>} pushed - the controllers whose thumbstick is being pushed, kept between calls
 * @param {Object} inputSource - a controller: an XRInputSource
 * @returns {string|null} "previous" when the thumbstick has just been pushed to the left, "next" to the right, null otherwise
 */
function directionOfThumbstick( pushed, inputSource ) {

	// The standard layout of the controllers of headsets: a touchpad on the first two axes, a thumbstick on the next two.
	const axes = inputSource.gamepad?.axes;
	if ( ! axes || axes.length < 4 ) return null;

	const x = axes[ 2 ];
	const y = axes[ 3 ];

	if ( pushed.has( inputSource ) ) {

		if ( Math.abs( x ) <= RELEASED && Math.abs( y ) <= RELEASED ) pushed.delete( inputSource );
		return null;

	}

	// to the side, not up or down
	if ( Math.abs( x ) >= PUSHED && Math.abs( x ) > Math.abs( y ) ) {

		pushed.add( inputSource );
		return x > 0 ? 'next' : 'previous';

	}

	return null;

}

export { directionOfSelect, directionOfThumbstick };
