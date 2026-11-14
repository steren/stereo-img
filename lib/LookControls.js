/**
 * Controls to look around a picture from where the camera is, like in a street view:
 * the picture is grabbed and follows the pointer. The wheel, or a pinch, zooms.
 */

const DEGREES = Math.PI / 180;

class LookControls {

	/**
	 * @param {PerspectiveCamera} camera - the camera to turn. It looks down its negative Z axis when looking straight.
	 * @param {HTMLElement} domElement - the element that receives the gestures
	 */
	constructor( camera, domElement ) {

		this.camera = camera;
		this.domElement = domElement;

		// Direction the camera looks at, in degrees: to the right and up from straight ahead.
		this.lon = 0;
		this.lat = 0;

		// Limits of the direction, in degrees.
		this.minLon = - Infinity;
		this.maxLon = Infinity;
		this.minLat = - 85;
		this.maxLat = 85;

		// Limits of the vertical field of view when zooming, in degrees.
		this.minFov = 20;
		this.maxFov = 100;

		// Set to false to ignore the gestures, in VR for example.
		this.enabled = true;

		// Pointers that are down: their identifier and position
		this._pointers = new Map();

		this._onPointerDown = this._onPointerDown.bind( this );
		this._onPointerMove = this._onPointerMove.bind( this );
		this._onPointerUp = this._onPointerUp.bind( this );
		this._onWheel = this._onWheel.bind( this );

		domElement.addEventListener( 'pointerdown', this._onPointerDown );
		domElement.addEventListener( 'pointermove', this._onPointerMove );
		domElement.addEventListener( 'pointerup', this._onPointerUp );
		domElement.addEventListener( 'pointercancel', this._onPointerUp );
		domElement.addEventListener( 'wheel', this._onWheel, { passive: false } );

		// The gestures are for the picture, not for the page.
		domElement.style.touchAction = 'none';
		domElement.style.cursor = 'grab';

		this.update();

	}

	/**
	 * Look straight ahead, with the given field of view.
	 * @param {number} [fov] - vertical field of view, in degrees
	 */
	reset( fov ) {

		this.lon = 0;
		this.lat = 0;

		if ( fov ) {

			this.camera.fov = fov;
			this.camera.updateProjectionMatrix();

		}

		this.update();

	}

	/**
	 * Turn the camera to the direction of the controls, within their limits.
	 */
	update() {

		this.lon = Math.min( this.maxLon, Math.max( this.minLon, this.lon ) );
		this.lat = Math.min( this.maxLat, Math.max( this.minLat, this.lat ) );

		const lon = this.lon * DEGREES;
		const lat = this.lat * DEGREES;
		const { x, y, z } = this.camera.position;

		this.camera.lookAt(
			x + Math.sin( lon ) * Math.cos( lat ),
			y + Math.sin( lat ),
			z - Math.cos( lon ) * Math.cos( lat )
		);

	}

	/**
	 * Zoom by changing the field of view.
	 * @param {number} fov - vertical field of view, in degrees
	 */
	setFov( fov ) {

		this.camera.fov = Math.min( this.maxFov, Math.max( this.minFov, fov ) );
		this.camera.updateProjectionMatrix();

	}

	dispose() {

		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.removeEventListener( 'pointerup', this._onPointerUp );
		this.domElement.removeEventListener( 'pointercancel', this._onPointerUp );
		this.domElement.removeEventListener( 'wheel', this._onWheel );

	}

	/**
	 * The angles of the direction under a point of the element, from the direction of the camera.
	 * @returns {{x: number, y: number}} angles in degrees: to the right and down
	 */
	_anglesAt( clientX, clientY ) {

		const rect = this.domElement.getBoundingClientRect();
		// distance at which one pixel of the element is one unit
		const focal = rect.height / 2 / Math.tan( this.camera.fov * DEGREES / 2 );

		return {
			x: Math.atan( ( clientX - rect.left - rect.width / 2 ) / focal ) / DEGREES,
			y: Math.atan( ( clientY - rect.top - rect.height / 2 ) / focal ) / DEGREES,
		};

	}

	_onPointerDown( event ) {

		if ( ! this.enabled || ( event.pointerType === 'mouse' && event.button !== 0 ) ) return;

		this._pointers.set( event.pointerId, { x: event.clientX, y: event.clientY } );

		try {

			// keep receiving the moves when the pointer leaves the element
			this.domElement.setPointerCapture( event.pointerId );

		} catch ( e ) {

			// the pointer is gone already

		}

		this.domElement.style.cursor = 'grabbing';

	}

	_onPointerMove( event ) {

		const previous = this._pointers.get( event.pointerId );

		if ( ! this.enabled || ! previous ) return;

		const current = { x: event.clientX, y: event.clientY };

		if ( this._pointers.size === 1 ) {

			// Turn the camera so that what was under the pointer stays under it.
			const from = this._anglesAt( previous.x, previous.y );
			const to = this._anglesAt( current.x, current.y );
			this.lon -= to.x - from.x;
			this.lat += to.y - from.y;
			this.update();

		} else if ( this._pointers.size === 2 ) {

			// Pinch: zoom by how much the two pointers moved apart.
			const other = [ ...this._pointers ].find( ( [ id ] ) => id !== event.pointerId )[ 1 ];
			const before = Math.hypot( previous.x - other.x, previous.y - other.y );
			const after = Math.hypot( current.x - other.x, current.y - other.y );

			if ( before > 0 && after > 0 ) {

				this.setFov( this.camera.fov * before / after );

			}

		}

		this._pointers.set( event.pointerId, current );

	}

	_onPointerUp( event ) {

		this._pointers.delete( event.pointerId );

		if ( this._pointers.size === 0 ) {

			this.domElement.style.cursor = 'grab';

		}

	}

	_onWheel( event ) {

		if ( ! this.enabled ) return;

		// the wheel zooms the picture instead of scrolling the page
		event.preventDefault();
		this.setFov( this.camera.fov + event.deltaY * 0.05 );

	}

}

export { LookControls };
