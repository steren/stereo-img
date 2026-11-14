/**
 * Messages explaining what does not work without HTTPS.
 */

const INSECURE_PAGE_WARNING = '<stereo-img>: VR is not available because this page is not served over HTTPS. '
	+ 'Browsers only allow WebXR on secure pages (HTTPS or localhost).';

/**
 * A hint to add to the error reported when a picture cannot be loaded.
 * @param {string} src - URL of the picture, absolute or relative to the page
 * @param {string} pageUrl - URL of the page
 * @returns {string} the hint, starting with a space, or an empty string when HTTPS is not the cause
 */
function mixedContentHint( src, pageUrl ) {

	try {

		const page = new URL( pageUrl );
		const picture = new URL( src, page );

		if ( page.protocol === 'https:' && picture.protocol === 'http:' ) {

			return ' This page is served over HTTPS but the picture is not: browsers block or upgrade such requests. Serve the picture over HTTPS.';

		}

	} catch ( e ) {

		// not a URL: nothing to add

	}

	return '';

}

export { INSECURE_PAGE_WARNING, mixedContentHint };
