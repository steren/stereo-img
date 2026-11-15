/**
 * How much lower a view of a stereo picture is than the other one, measured from what they show.
 *
 * Two lenses side by side see the same thing at the same height: only its horizontal position changes with its distance.
 * So the second view is moved over the first one, in both directions, until they match best: the vertical part of
 * that move is how much the second view is lower.
 *
 * Give it the same part of each view, around the middle, where this holds best.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} first - RGBA pixels of a part of a view
 * @param {{data: Uint8ClampedArray, width: number, height: number}} second - RGBA pixels of the same part of the other view, of the same size
 * @param {Object} [options]
 * @param {number} [options.maxVertical] - largest vertical offset to look for, in pixels. An eighth of the height by default.
 * @param {number} [options.maxHorizontal] - largest horizontal offset between the two views, in pixels. An eighth of the width by default.
 * @param {number} [options.minScore] - how alike the two views must be for the offset to be trusted, from 0 to 1
 * @returns {number} how many pixels lower the content of the second view is: negative when it is higher.
 *     0 when it can't be told: views that are too small, plain, or too different.
 */
function verticalOffset( first, second, options = {} ) {

	const { width, height } = first;

	if ( second.width !== width || second.height !== height ) {

		return 0;

	}

	const { maxVertical = height / 8, maxHorizontal = width / 8, minScore = 0.75 } = options;

	// Views are compared at a lower resolution: it is faster, and the offset is still found within a fraction of a pixel.
	const scale = Math.max( 1, Math.round( Math.min( width, height ) / COMPARED_SIZE ) );
	const a = shrink( first, scale );
	const b = shrink( second, scale );
	const w = a.width;
	const h = a.height;

	const reachX = Math.ceil( maxHorizontal / scale );
	const reachY = Math.ceil( maxVertical / scale );

	// The part of the first view that is compared: what remains inside the second one, however it is moved.
	const innerWidth = w - 2 * reachX;
	const innerHeight = h - 2 * reachY;

	if ( innerWidth < SMALLEST_COMPARED || innerHeight < SMALLEST_COMPARED ) {

		return 0;

	}

	const count = innerWidth * innerHeight;
	let sumA = 0;
	let sumAA = 0;

	for ( let y = reachY; y < reachY + innerHeight; y ++ ) {

		for ( let x = reachX; x < reachX + innerWidth; x ++ ) {

			const value = a.values[ y * w + x ];
			sumA += value;
			sumAA += value * value;

		}

	}

	const varianceA = sumAA - sumA * sumA / count;

	if ( varianceA <= count * FLAT_VARIANCE ) {

		// nothing to recognise in a plain picture
		return 0;

	}

	// How alike the views are for each move of the second one: 1 for the same picture, whatever its brightness and contrast.
	const columns = 2 * reachX + 1;
	const scores = new Float32Array( columns * ( 2 * reachY + 1 ) );
	let best = - Infinity;
	let bestX = 0;
	let bestY = 0;

	for ( let dy = - reachY; dy <= reachY; dy ++ ) {

		for ( let dx = - reachX; dx <= reachX; dx ++ ) {

			let sumB = 0;
			let sumBB = 0;
			let sumAB = 0;

			for ( let y = reachY; y < reachY + innerHeight; y ++ ) {

				let i = y * w + reachX;
				let j = ( y + dy ) * w + reachX + dx;

				for ( let x = 0; x < innerWidth; x ++, i ++, j ++ ) {

					const value = b.values[ j ];
					sumB += value;
					sumBB += value * value;
					sumAB += a.values[ i ] * value;

				}

			}

			const varianceB = sumBB - sumB * sumB / count;
			const score = varianceB > 0 ? ( sumAB - sumA * sumB / count ) / Math.sqrt( varianceA * varianceB ) : 0;
			scores[ ( dy + reachY ) * columns + dx + reachX ] = score;

			if ( score > best ) {

				best = score;
				bestX = dx;
				bestY = dy;

			}

		}

	}

	// A best match at the end of what was tried is not one: a better one may be further.
	if ( best < minScore || Math.abs( bestY ) === reachY ) {

		return 0;

	}

	// The best match is between two tries: place it from how good its two neighbours are.
	const at = ( dy ) => scores[ ( dy + reachY ) * columns + bestX + reachX ];
	const above = at( bestY - 1 );
	const below = at( bestY + 1 );
	const curve = above - 2 * best + below;
	const between = curve < 0 ? 0.5 * ( above - below ) / curve : 0;

	return ( bestY + between ) * scale;

}

// Width and height, in pixels, of the pictures that are compared: larger ones are shrunk to about that size.
const COMPARED_SIZE = 140;
// Smallest width and height, in pixels, of what is compared, for the result to mean something.
const SMALLEST_COMPARED = 16;
// Variance of the brightness of a pixel, from 0 to 765, under which a picture is plain.
const FLAT_VARIANCE = 4;

/**
 * The brightness of a picture, at a lower resolution.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} imageData - RGBA pixels of the picture
 * @param {number} scale - how many times smaller, a whole number
 * @returns {{values: Float32Array, width: number, height: number}} sum of red, green and blue of each pixel, averaged
 */
function shrink( imageData, scale ) {

	const { data } = imageData;
	const width = Math.floor( imageData.width / scale );
	const height = Math.floor( imageData.height / scale );
	const values = new Float32Array( width * height );

	for ( let y = 0; y < height; y ++ ) {

		for ( let x = 0; x < width; x ++ ) {

			let sum = 0;

			for ( let j = 0; j < scale; j ++ ) {

				let i = ( ( y * scale + j ) * imageData.width + x * scale ) * 4;

				for ( let k = 0; k < scale; k ++, i += 4 ) {

					sum += data[ i ] + data[ i + 1 ] + data[ i + 2 ];

				}

			}

			values[ y * width + x ] = sum / ( scale * scale );

		}

	}

	return { values, width, height };

}

export { verticalOffset };
