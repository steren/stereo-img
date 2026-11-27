/**
 * A picture file, downloaded once for everything that reads it:
 * its metadata, its pixels, the pictures embedded in it.
 */
class Picture {

	/**
	 * @param {string} url - URL of the picture
	 * @param {AbortSignal} [signal] - Aborted when the picture is not needed anymore: the download stops.
	 * @param {(loaded: number, total: number) => void} [onProgress] - Called as bytes arrive when the response size is known.
	 */
	constructor( url, signal, onProgress ) {

		this.url = url;
		this.signal = signal;
		this.onProgress = onProgress;

	}

	/**
	 * @returns {Promise<Blob>} the content of the file. It is downloaded on the first call.
	 */
	blob() {

		if ( ! this._blob ) {

			this._blob = fetch( this.url, { signal: this.signal } ).then( async response => {

				if ( ! response.ok ) {

					throw new Error( `Could not download "${this.url}": HTTP ${response.status}` );

				}

				const total = Number( response.headers?.get?.( 'content-length' ) );
				if ( this.onProgress && total > 0 && response.body?.getReader ) {

					const reader = response.body.getReader();
					const chunks = [];
					let loaded = 0;
					try {

						while ( true ) {

							const { done, value } = await reader.read();
							if ( done ) {

								break;

							}
							chunks.push( value );
							loaded += value.byteLength;
							this.onProgress( loaded, total );

						}

					} catch ( error ) {

						reader.cancel().catch( () => {} );
						throw error;

					}

					const type = response.headers?.get?.( 'content-type' ) || '';
					return new Blob( chunks, { type } );

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
