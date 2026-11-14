/**
 * Cutting a picture that is too large for one texture into tiles.
 *
 * A picture is drawn on triangles. Each triangle is given to one tile, and a tile holds the pixels of all its triangles,
 * so a triangle never needs the pixels of two tiles.
 */

/**
 * How many pixels a tile takes beyond the triangles it is drawn on.
 * Where two tiles meet, each then blends the same pixels of the picture, at the reduced sizes too: the seam does not show.
 *
 * @param {number} maxSize - largest width and height of a tile, in pixels
 * @returns {number} pixels
 */
function tilePadding( maxSize ) {

	return Math.min( 64, Math.floor( maxSize / 8 ) );

}

/**
 * Plan how to cut a picture into tiles.
 *
 * @param {ArrayLike<number>} uvs - where the corners of the triangles are on the picture: u then v for each corner, three corners per triangle.
 * u goes from 0 on the left to 1 on the right, v from 0 at the bottom to 1 at the top.
 * @param {number} width - width of the picture, in pixels
 * @param {number} height - height of the picture, in pixels
 * @param {number} maxSize - largest width and height of a tile, in pixels
 * @param {number} [padding] - pixels a tile takes beyond its triangles, where the picture has them
 * @returns {Array<{x: number, y: number, width: number, height: number, triangles: Array<number>}>|null} for each tile,
 * its rectangle in pixels from the top left corner of the picture, and which triangles it is drawn on.
 * Parts of the picture that no triangle shows are in no tile. Null if the triangles are too large for the tiles.
 */
function planTiles( uvs, width, height, maxSize, padding = tilePadding( maxSize ) ) {

	const triangleCount = Math.floor( uvs.length / 6 );
	const clamp = ( value, min, max ) => Math.max( min, Math.min( max, value ) );

	let columns = Math.ceil( width / maxSize );
	let rows = Math.ceil( height / maxSize );

	// More tiles than this means that the triangles are larger than the tiles.
	const most = 64;

	// A hundredth of a pixel: more than the error of a position stored on 32 bits, for the largest pictures.
	const nearly = 0.01;

	while ( columns <= most && rows <= most ) {

		const cells = new Map();

		for ( let triangle = 0; triangle < triangleCount; triangle ++ ) {

			const offset = triangle * 6;

			// a triangle goes to the tile its middle is in
			const u = ( uvs[ offset ] + uvs[ offset + 2 ] + uvs[ offset + 4 ] ) / 3;
			const v = ( uvs[ offset + 1 ] + uvs[ offset + 3 ] + uvs[ offset + 5 ] ) / 3;
			const column = clamp( Math.floor( u * columns ), 0, columns - 1 );
			const row = clamp( Math.floor( ( 1 - v ) * rows ), 0, rows - 1 );
			const key = row * columns + column;

			let cell = cells.get( key );
			if ( cell === undefined ) {

				cell = { left: Infinity, right: - Infinity, top: Infinity, bottom: - Infinity, triangles: [] };
				cells.set( key, cell );

			}

			for ( let corner = 0; corner < 3; corner ++ ) {

				const x = clamp( uvs[ offset + corner * 2 ], 0, 1 ) * width;
				const y = ( 1 - clamp( uvs[ offset + corner * 2 + 1 ], 0, 1 ) ) * height;
				cell.left = Math.min( cell.left, x );
				cell.right = Math.max( cell.right, x );
				cell.top = Math.min( cell.top, y );
				cell.bottom = Math.max( cell.bottom, y );

			}

			cell.triangles.push( triangle );

		}

		let tooWide = false;
		let tooHigh = false;
		const tiles = [];

		for ( const key of [ ...cells.keys() ].sort( ( a, b ) => a - b ) ) {

			const cell = cells.get( key );

			// Whole pixels, with room around them. A tile has at least one pixel.
			// Positions are not exact: a corner a hair beyond the edge of a pixel does not take one more pixel.
			const left = clamp( Math.floor( cell.left + nearly ) - padding, 0, width - 1 );
			const top = clamp( Math.floor( cell.top + nearly ) - padding, 0, height - 1 );
			const right = clamp( Math.ceil( cell.right - nearly ) + padding, left + 1, width );
			const bottom = clamp( Math.ceil( cell.bottom - nearly ) + padding, top + 1, height );

			tooWide = tooWide || right - left > maxSize;
			tooHigh = tooHigh || bottom - top > maxSize;

			tiles.push( { x: left, y: top, width: right - left, height: bottom - top, triangles: cell.triangles } );

		}

		if ( ! tooWide && ! tooHigh ) return tiles;

		// smaller tiles
		if ( tooWide ) columns ++;
		if ( tooHigh ) rows ++;

	}

	return null;

}

/**
 * The values of the corners of some triangles.
 *
 * @param {ArrayLike<number>} values - values of every corner of every triangle, three corners per triangle
 * @param {number} itemSize - how many values a corner has: 3 for a position, 2 for a place on the picture
 * @param {Array<number>} triangles - which triangles to keep
 * @returns {Float32Array} the values of the corners of these triangles
 */
function pickTriangles( values, itemSize, triangles ) {

	const size = itemSize * 3;
	const picked = new Float32Array( triangles.length * size );

	triangles.forEach( ( triangle, index ) => {

		for ( let i = 0; i < size; i ++ ) {

			picked[ index * size + i ] = values[ triangle * size + i ];

		}

	} );

	return picked;

}

/**
 * Where the corners of the triangles of a tile are on the tile, instead of on the whole picture.
 *
 * @param {ArrayLike<number>} uvs - where the corners of every triangle are on the picture, as given to planTiles
 * @param {{x: number, y: number, width: number, height: number, triangles: Array<number>}} tile - a tile from planTiles
 * @param {number} width - width of the picture, in pixels
 * @param {number} height - height of the picture, in pixels
 * @returns {Float32Array} u then v for each corner of the triangles of the tile, from 0 to 1 over the tile
 */
function tileUvs( uvs, tile, width, height ) {

	const local = pickTriangles( uvs, 2, tile.triangles );

	for ( let i = 0; i < local.length; i += 2 ) {

		const x = local[ i ] * width;
		const y = ( 1 - local[ i + 1 ] ) * height;
		local[ i ] = ( x - tile.x ) / tile.width;
		local[ i + 1 ] = 1 - ( y - tile.y ) / tile.height;

	}

	return local;

}

/**
 * Copy a rectangle of the pixels of a picture.
 *
 * @param {Uint8ClampedArray} data - RGBA pixels of the picture, row after row
 * @param {number} sourceWidth - width of the picture, in pixels
 * @param {{x: number, y: number, width: number, height: number}} rectangle - what to copy, in pixels from the top left corner
 * @returns {Uint8ClampedArray} RGBA pixels of the rectangle
 */
function cropPixels( data, sourceWidth, rectangle ) {

	const { x, y, width, height } = rectangle;
	const cropped = new Uint8ClampedArray( width * height * 4 );

	for ( let row = 0; row < height; row ++ ) {

		const start = ( ( y + row ) * sourceWidth + x ) * 4;
		cropped.set( data.subarray( start, start + width * 4 ), row * width * 4 );

	}

	return cropped;

}

export { tilePadding, planTiles, pickTriangles, tileUvs, cropPixels };
