// Forked from https://github.com/mrdoob/three.js/blob/master/examples/jsm/webxr/VRButton.js

import { INSECURE_PAGE_WARNING } from './https.js';

class VRButton {

	static createButton( renderer ) {

		const button = document.createElement( 'button' );

		function showEnterVR( /*device*/ ) {

			let currentSession = null;

			async function onSessionStarted( session ) {

				session.addEventListener( 'end', onSessionEnded );
				VRButton.activeSession = session;

				await renderer.xr.setSession( session );
				button.textContent = 'EXIT VR';

				currentSession = session;

			}

			function onSessionEnded( event ) {

				event.session.removeEventListener( 'end', onSessionEnded );

				if ( VRButton.activeSession === event.session ) {

					VRButton.activeSession = null;

				}

				button.textContent = 'ENTER VR';

				currentSession = null;

			}

			async function enterVR() {

				// A page can only have one immersive session:
				// leave the one started from another element before starting a new one.
				const otherSession = VRButton.activeSession;

				if ( otherSession !== null ) {

					try {

						await otherSession.end();

					} catch ( err ) {

						// it was already ending

					}

				}

				try {

					await onSessionStarted( await navigator.xr.requestSession( 'immersive-vr', sessionInit ) );

				} catch ( err ) {

					console.warn( '<stereo-img>: could not enter VR.', err );

				}

			}

			//

			button.style.display = '';

			button.style.cursor = 'pointer';
			button.style.left = 'calc(50% - 50px)';
			button.style.width = '100px';

			button.textContent = 'ENTER VR';

			// WebXR's requestReferenceSpace only works if the corresponding feature
			// was requested at session creation time. For simplicity, just ask for
			// the interesting ones as optional features, but be aware that the
			// requestReferenceSpace call will fail if it turns out to be unavailable.
			// ('local' is always available for immersive sessions and doesn't need to
			// be requested separately.)

			const sessionInit = { optionalFeatures: [ 'local-floor', 'bounded-floor', 'hand-tracking', 'layers' ] };

			button.onmouseenter = function () {

				button.style.opacity = '1.0';

			};

			button.onmouseleave = function () {

				button.style.opacity = '0.5';

			};

			button.onclick = function () {

				if ( currentSession === null ) {

					enterVR();

				} else {

					currentSession.end();

					if ( navigator.xr.offerSession !== undefined ) {

						navigator.xr.offerSession( 'immersive-vr', sessionInit )
							.then( onSessionStarted )
							.catch( ( err ) => {

								console.warn( err );

							} );

					}

				}

			};
			button.setAttribute('aria-label', 'Enter VR');

			if ( navigator.xr.offerSession !== undefined ) {

				navigator.xr.offerSession( 'immersive-vr', sessionInit )
					.then( onSessionStarted )
					.catch( ( err ) => {

						console.warn( err );

					} );

			}

		}

		function disableButton() {

			button.style.display = '';

			button.style.cursor = 'auto';
			button.style.left = 'calc(50% - 75px)';
			button.style.width = '150px';

			button.onmouseenter = null;
			button.onmouseleave = null;

			button.onclick = null;

		}

		function showWebXRNotFound() {

			disableButton(); // Keep internal state consistent if needed elsewhere

			// Hide the button instead of showing text
			button.style.display = 'none';

		}

		function showVRNotAllowed( exception ) {

			disableButton(); // Keep internal state consistent if needed elsewhere

			console.warn( 'Exception when trying to call xr.isSessionSupported', exception );

			// Hide the button instead of showing text
			button.style.display = 'none';

		}

		function stylizeElement( element ) {

			element.style.position = 'absolute';
			element.style.bottom = '20px';
			element.style.padding = '12px 6px';
			element.style.border = '1px solid #fff';
			element.style.borderRadius = '4px';
			element.style.background = 'rgba(0,0,0,0.1)';
			element.style.color = '#fff';
			element.style.font = 'normal 13px sans-serif';
			element.style.textAlign = 'center';
			element.style.opacity = '0.5';
			element.style.outline = 'none';
			element.style.zIndex = '999';

		}

		if ( 'xr' in navigator ) {

			button.id = 'VRButton';
			button.style.display = 'none';

			stylizeElement( button );

			navigator.xr.isSessionSupported( 'immersive-vr' ).then( function ( supported ) {

				supported ? showEnterVR() : showWebXRNotFound();

				if ( supported && VRButton.xrSessionIsGranted ) {

					button.click();

				}

			} ).catch( showVRNotAllowed );

			return button;

		} else {

			// WebXR is hidden from pages that are not served over HTTPS: say so, once per page.
			if ( window.isSecureContext === false && ! VRButton.insecurePageWarned ) {

				VRButton.insecurePageWarned = true;
				console.warn( INSECURE_PAGE_WARNING );

			}

			// Instead of creating a message link, create an empty element
			// or simply don't return anything visible.
			// Returning an empty div ensures a DOM element is returned,
			// preventing potential errors if the caller expects one.
			const message = document.createElement( 'div' );
			message.style.display = 'none'; // Ensure it's not visible

			// Remove message styling and content assignment
			// message.href = ...
			// message.innerHTML = ...
			// message.style.left = ...
			// message.style.width = ...
			// message.style.textDecoration = ...
			// stylizeElement( message ); // No need to style an invisible element

			return message; // Return the invisible element

		}

	}

	static registerSessionGrantedListener() {

		if ( typeof navigator !== 'undefined' && 'xr' in navigator ) {

			// WebXRViewer (based on Firefox) has a bug where addEventListener
			// throws a silent exception and aborts execution entirely.
			if ( /WebXRViewer\//i.test( navigator.userAgent ) ) return;

			navigator.xr.addEventListener( 'sessiongranted', () => {

				VRButton.xrSessionIsGranted = true;

			} );

		}

	}

}

VRButton.xrSessionIsGranted = false;
// The immersive session in progress on this page, whichever button started it.
VRButton.activeSession = null;
VRButton.insecurePageWarned = false;
VRButton.registerSessionGrantedListener();

export { VRButton };
