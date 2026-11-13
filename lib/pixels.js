/**
 * Reading the pixels of a picture with canvases that every browser accepts.
 *
 * To read pixels, a picture is copied on a canvas. Safari on iOS leaves a canvas of more than 4096 by 4096 pixels blank,
 * and a canvas of the size of a large picture takes memory that phones lack: the picture of a camera with two fisheye
 * lenses can have 45 million pixels. Such a picture is read in parts: only what is asked for, on canvases that are small enough.
 */

/** The limits of the browsers. An object, so that tests can lower them. */
const limits = {
	// the most pixels a canvas can have everywhere: 4096 by 4096
	canvasArea: 4096 * 4096,
};

// The canvas that the parts of large pictures are copied on, kept from one read to the next.
let scratch = null;

/**
 * Tell if a picture can be copied whole on one canvas.
 *
 * @param {number} width - width of the picture, in pixels
 * @param {number} height - height of the picture, in pixels
 * @returns {boolean}
 */
function fitsInCanvas( width, height ) {

	return width * height <= limits.canvasArea;

}

/**
 * Read a rectangle of the pixels of a picture, whatever the size of the picture and of the rectangle.
 * Only the rectangle is copied on a canvas, in several bands when it is too large for one.
 *
 * @param {CanvasImageSource} image - the picture
 * @param {number} x - left of the rectangle, in pixels
 * @param {number} y - top of the rectangle, in pixels
 * @param {number} width - width of the rectangle, in pixels
 * @param {number} height - height of the rectangle, in pixels
 * @returns {ImageData} the pixels of the rectangle. Outside of the picture, they are transparent.
 */
function readPixels( image, x, y, width, height ) {

	// whole pixels, as a canvas counts them
	x = Math.trunc( x );
	y = Math.trunc( y );
	width = Math.trunc( width );
	height = Math.trunc( height );

	const pixels = new ImageData( width, height );
	const bandHeight = Math.max( 1, Math.min( height, Math.floor( limits.canvasArea / width ) ) );

	if ( scratch === null ) {

		const canvas = document.createElement( 'canvas' );
		scratch = { canvas, ctx: canvas.getContext( '2d', { willReadFrequently: true } ) };

	}

	const { canvas, ctx } = scratch;

	// changing the size of a canvas empties it
	if ( canvas.width !== width || canvas.height !== bandHeight ) {

		canvas.width = width;
		canvas.height = bandHeight;

	}

	for ( let done = 0; done < height; done += bandHeight ) {

		const rows = Math.min( bandHeight, height - done );
		ctx.clearRect( 0, 0, width, bandHeight );
		ctx.drawImage( image, x, y + done, width, rows, 0, 0, width, rows );
		pixels.data.set( ctx.getImageData( 0, 0, width, rows ).data, done * width * 4 );

	}

	if ( width * bandHeight > 1024 * 1024 ) {

		// do not keep the memory of a large canvas
		canvas.width = 1;
		canvas.height = 1;

	}

	return pixels;

}

/**
 * Get ready to read pixels of a picture.
 *
 * @param {CanvasImageSource} image - the picture
 * @returns {function(number, number, number, number): ImageData} gives the pixels of a rectangle of the picture: its left, top, width and height
 */
function pixelReader( image ) {

	const { width, height } = image;

	if ( fitsInCanvas( width, height ) ) {

		// One canvas with the whole picture: reading from it many times is fast.
		const canvas = document.createElement( 'canvas' );
		const ctx = canvas.getContext( '2d', { willReadFrequently: true } );
		canvas.width = width;
		canvas.height = height;
		ctx.drawImage( image, 0, 0 );
		return ( x, y, w, h ) => ctx.getImageData( x, y, w, h );

	}

	return ( x, y, w, h ) => readPixels( image, x, y, w, h );

}

export { limits, fitsInCanvas, readPixels, pixelReader };
