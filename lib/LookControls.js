/**
 * Controls to look at a picture by grabbing it: it follows the pointer.
 * The wheel, or a pinch, zooms.
 *
 * Two ways of moving, depending on the picture:
 * - 'look': the picture surrounds the viewer, like in a street view. The camera turns on itself.
 * - 'pan': the picture is flat, in front of the viewer. The camera slides sideways and keeps looking straight ahead.
 */

const DEGREES = Math.PI / 180;

class LookControls {

	/**
	 * @param {PerspectiveCamera} camera - the camera to move. It looks down its negative Z axis when looking straight.
	 * @param {HTMLElement} domElement - the element that receives the gestures
	 */
	constructor( camera, domElement ) {

		this.camera = camera;
		this.domElement = domElement;

		// How the view moves: 'look' or 'pan'
		this.mode = 'look';

		// In 'look' mode: direction the camera looks at, in degrees, to the right and up from straight ahead.
		this.lon = 0;
		this.lat = 0;

		// In 'pan' mode: position of the camera, to the right and up, in units of the scene.
		this.x = 0;
		this.y = 0;
		// Distance of the flat picture that is panned, in units of the scene.
		this.distance = 1;

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

		// Optional rule on what can be looked at: a function that tells if a view is allowed, given
		// its two coordinates (lon and lat in 'look' mode, x and y in 'pan' mode) and its vertical
		// field of view in degrees. The controls stay on allowed views.
		this.isAllowed = null;

		// The last view that was allowed, and the view in the middle of what can be looked at
		this._allowed = [ 0, 0 ];
		this._center = [ 0, 0 ];

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
	 * Look at the middle of what can be looked at, as wide as allowed.
	 * @param {number} fov - widest vertical field of view to use, in degrees
	 * @param {{lon: number, lat: number}} [center] - in 'look' mode, direction to look at if looking straight ahead is not allowed
	 */
	reset( fov, center ) {

		this._center = [ 0, 0 ];

		if ( this.mode === 'look' && this.isAllowed && center && ! this.isAllowed( 0, 0, this.minFov ) ) {

			this._center = [ center.lon, center.lat ];

		}

		this._set( this._center );
		this._allowed = this._center;
		this.camera.fov = this._widestAllowedFov( fov );
		this.camera.updateProjectionMatrix();
		this.update();

	}

	/**
	 * Move the camera to the view of the controls, within their limits.
	 */
	update() {

		if ( this.mode === 'look' ) {

			this.lon = Math.min( this.maxLon, Math.max( this.minLon, this.lon ) );
			this.lat = Math.min( this.maxLat, Math.max( this.minLat, this.lat ) );

		}

		if ( this.isAllowed ) {

			// Go as far as allowed towards the view asked for, sideways then vertically:
			// along an edge, the view keeps sliding in the direction that is free.
			const fov = this.camera.fov;
			const from = this._allowed;
			const to = this._get();

			if ( this.isAllowed( from[ 0 ], from[ 1 ], fov ) ) {

				const first = this._furthestAllowed( from[ 0 ], to[ 0 ], value => this.isAllowed( value, from[ 1 ], fov ) );
				const second = this._furthestAllowed( from[ 1 ], to[ 1 ], value => this.isAllowed( first, value, fov ) );
				this._set( [ first, second ] );

			}

		}

		this._allowed = this._get();

		if ( this.mode === 'pan' ) {

			this.camera.position.set( this.x, this.y, 0 );
			this.camera.lookAt( this.x, this.y, - 1 );

		} else {

			const lon = this.lon * DEGREES;
			const lat = this.lat * DEGREES;
			this.camera.position.set( 0, 0, 0 );
			this.camera.lookAt( Math.sin( lon ) * Math.cos( lat ), Math.sin( lat ), - Math.cos( lon ) * Math.cos( lat ) );

		}

	}

	/**
	 * Zoom by changing the field of view.
	 * @param {number} fov - vertical field of view, in degrees
	 */
	setFov( fov ) {

		fov = Math.min( this.maxFov, Math.max( this.minFov, fov ) );
		const view = this._get();

		if ( this.isAllowed && fov > this.camera.fov && ! this.isAllowed( view[ 0 ], view[ 1 ], fov ) ) {

			// Zooming out near an edge: move away from the edge, towards the middle, where a wider view fits.
			const center = this._center;
			const towardsCenter = amount => [ center[ 0 ] + ( view[ 0 ] - center[ 0 ] ) * amount, center[ 1 ] + ( view[ 1 ] - center[ 1 ] ) * amount ];
			const allowedAt = amount => this.isAllowed( ...towardsCenter( amount ), fov );

			if ( allowedAt( 0 ) ) {

				this._set( towardsCenter( this._furthestAllowed( 0, 1, allowedAt ) ) );

			} else {

				// Not even from the middle: zoom out as much as fits there.
				this._set( center );
				fov = Math.max( this.camera.fov, this._widestAllowedFov( fov ) );

			}

			this._allowed = this._get();

		}

		this.camera.fov = fov;
		this.camera.updateProjectionMatrix();
		this.update();

	}

	/**
	 * Apply the rule again, after what can be looked at changed: the shape of the element, for example.
	 */
	constrain() {

		const view = this._get();

		if ( this.isAllowed && ! this.isAllowed( view[ 0 ], view[ 1 ], this.camera.fov ) ) {

			const fov = this.camera.fov;
			// zoom in until the view fits where it is, or go back to the middle
			this.camera.fov = this._widestAllowedFov( fov );

			if ( ! this.isAllowed( view[ 0 ], view[ 1 ], this.camera.fov ) ) {

				this._set( this._center );
				this.camera.fov = this._widestAllowedFov( fov );

			}

			this._allowed = this._get();
			this.camera.updateProjectionMatrix();

		}

		this.update();

	}

	dispose() {

		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.removeEventListener( 'pointerup', this._onPointerUp );
		this.domElement.removeEventListener( 'pointercancel', this._onPointerUp );
		this.domElement.removeEventListener( 'wheel', this._onWheel );

	}

	/** The two coordinates of the view, in the current mode. */
	_get() {

		return this.mode === 'pan' ? [ this.x, this.y ] : [ this.lon, this.lat ];

	}

	_set( [ first, second ] ) {

		if ( this.mode === 'pan' ) {

			this.x = first;
			this.y = second;

		} else {

			this.lon = first;
			this.lat = second;

		}

	}

	/**
	 * The widest field of view allowed for the current view.
	 * @param {number} fov - widest field of view wanted, in degrees
	 * @returns {number} a field of view, in degrees, not narrower than the minimum of the controls
	 */
	_widestAllowedFov( fov ) {

		if ( ! this.isAllowed ) return fov;

		const view = this._get();

		return this._furthestAllowed( this.minFov, fov, value => this.isAllowed( view[ 0 ], view[ 1 ], value ) );

	}

	/**
	 * The value closest to a target that is allowed, starting from a value that is allowed.
	 * @param {number} from - a value that is allowed
	 * @param {number} to - the value wanted
	 * @param {function(number): boolean} allowed - tells if a value is allowed
	 * @returns {number} `to` if it is allowed, otherwise the last allowed value on the way to it
	 */
	_furthestAllowed( from, to, allowed ) {

		if ( from === to || allowed( to ) ) return to;

		let inside = from;
		let outside = to;

		for ( let i = 0; i < 20; i ++ ) {

			const middle = ( inside + outside ) / 2;

			if ( allowed( middle ) ) {

				inside = middle;

			} else {

				outside = middle;

			}

		}

		return inside;

	}

	/**
	 * Where a point of the element is, from the middle of the view.
	 * @returns {{x: number, y: number}} to the right and down, as the tangents of the angles from the direction of the camera
	 */
	_tangentsAt( clientX, clientY ) {

		const rect = this.domElement.getBoundingClientRect();
		// distance at which one pixel of the element is one unit
		const focal = rect.height / 2 / Math.tan( this.camera.fov * DEGREES / 2 );

		return {
			x: ( clientX - rect.left - rect.width / 2 ) / focal,
			y: ( clientY - rect.top - rect.height / 2 ) / focal,
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

			// Move the camera so that what was under the pointer stays under it.
			const from = this._tangentsAt( previous.x, previous.y );
			const to = this._tangentsAt( current.x, current.y );

			if ( this.mode === 'pan' ) {

				this.x -= ( to.x - from.x ) * this.distance;
				this.y += ( to.y - from.y ) * this.distance;

			} else {

				this.lon -= ( Math.atan( to.x ) - Math.atan( from.x ) ) / DEGREES;
				this.lat += ( Math.atan( to.y ) - Math.atan( from.y ) ) / DEGREES;

			}

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
