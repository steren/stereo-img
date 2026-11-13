/**
 * The average colours of the top and bottom edges of a picture.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} imageData - RGBA pixels of the picture
 * @param {Object} [options]
 * @param {number} [options.band] - share of the height of the picture that counts as an edge
 * @param {boolean} [options.circle] - the picture is a disc that touches the four sides, as a fisheye lens gives: ignore what is around the disc
 * @returns {{top: Array<number>, bottom: Array<number>}} red, green and blue of each edge, from 0 to 255
 */
function edgeColors( imageData, options = {} ) {

	const { data, width, height } = imageData;
	const { band = 0.1, circle = false } = options;
	const rows = Math.max( 1, Math.round( height * band ) );

	// a sample of the pixels is enough for an average: large pictures have millions of them
	const stepX = Math.max( 1, Math.floor( width / 64 ) );
	const stepY = Math.max( 1, Math.floor( rows / 8 ) );

	const insideDisc = ( x, y ) => {

		const dx = ( x + 0.5 ) / width * 2 - 1;
		const dy = ( y + 0.5 ) / height * 2 - 1;
		return dx * dx + dy * dy <= 1;

	};

	const average = ( firstRow ) => {

		const sum = [ 0, 0, 0 ];
		let count = 0;

		for ( let y = firstRow; y < firstRow + rows; y += stepY ) {

			for ( let x = 0; x < width; x += stepX ) {

				const i = ( y * width + x ) * 4;

				// transparent pixels have no colour
				if ( data[ i + 3 ] === 0 ) continue;

				if ( circle && ! insideDisc( x, y ) ) continue;

				sum[ 0 ] += data[ i ];
				sum[ 1 ] += data[ i + 1 ];
				sum[ 2 ] += data[ i + 2 ];
				count ++;

			}

		}

		return sum.map( value => count > 0 ? value / count : 0 );

	};

	return { top: average( 0 ), bottom: average( Math.max( 0, height - rows ) ) };

}

export { edgeColors };
