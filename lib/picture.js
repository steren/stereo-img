/**
 * A picture file, downloaded once for everything that reads it:
 * its metadata, its pixels, the pictures embedded in it.
 */
class Picture {

	/**
	 * @param {string} url - URL of the picture
	 * @param {AbortSignal} [signal] - Aborted when the picture is not needed anymore: the download stops.
	 */
	constructor( url, signal ) {

		this.url = url;
		this.signal = signal;

	}

	/**
	 * @returns {Promise<Blob>} the content of the file. It is downloaded on the first call.
	 */
	blob() {

		if ( ! this._blob ) {

			this._blob = fetch( this.url, { signal: this.signal } ).then( response => {

				if ( ! response.ok ) {

					throw new Error( `Could not download "${this.url}": HTTP ${response.status}` );

				}

				return response.blob();

			} );

		}

		return this._blob;

	}

	/**
	 * @returns {Promise<Uint8Array>} the bytes of the file
	 */
	bytes() {

		if ( ! this._bytes ) {

			this._bytes = this.blob().then( async blob => new Uint8Array( await blob.arrayBuffer() ) );

		}

		return this._bytes;

	}

	/**
	 * @returns {Promise<string>} a URL to read the downloaded file from, valid until release() is called
	 */
	objectURL() {

		if ( ! this._objectURL ) {

			this._objectURL = this.blob().then( blob => URL.createObjectURL( blob ) );

		}

		return this._objectURL;

	}

	/**
	 * Free what objectURL() created.
	 */
	release() {

		if ( this._objectURL ) {

			this._objectURL.then( url => URL.revokeObjectURL( url ), () => {} );
			this._objectURL = null;

		}

	}

}

export { Picture };
