import {
	Matrix3,
	ShaderMaterial,
	UniformsUtils,
	Vector2,
	OrthographicCamera,
	Scene,
	StereoCamera,
	LinearFilter,
	NearestFilter,
	RGBAFormat,
	WebGLRenderTarget,
	Mesh,
	PlaneGeometry,
	NoBlending
} from '../vendor/three/three.module.min.js';

/**
 * Anaglyph effect
 */

const AnaglyphShader = {

	uniforms: {

		'mapLeft': { value: null },
		'mapRight': { value: null },

		'colorMatrixLeft': { value: new Matrix3().fromArray( [ 1, 0, 0, 0, 0, 0, 0, 0, 0 ] ) },
		'colorMatrixRight': { value: new Matrix3().fromArray( [ 0, 0, 0, 0, 1, 0, 0, 0, 1 ] ) }

	},

	vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

	fragmentShader: /* glsl */`

		uniform sampler2D mapLeft;
		uniform sampler2D mapRight;
		varying vec2 vUv;

		uniform mat3 colorMatrixLeft;
		uniform mat3 colorMatrixRight;

		// These functions implement sRGB linearization and gamma correction

		float lin( float c ) {
			return c <= 0.04045 ? c * 0.0773993808 : pow( c * 0.9478672986 + 0.0521327014, 2.4 );
		}

		vec4 lin( vec4 c ) {
			return vec4( lin( c.r ), lin( c.g ), lin( c.b ), c.a );
		}

		float dev( float c ) {
			return c <= 0.0031308 ? c * 12.92 : 1.055 * pow( c, 0.41666 ) - 0.055;
		}


		void main() {

			vec2 uv = vUv;

			vec4 colorL = texture2D( mapLeft, uv );
			vec4 colorR = texture2D( mapRight, uv );

			vec3 color = clamp(
				colorMatrixLeft * colorL.rgb +
				colorMatrixRight * colorR.rgb,
				0., 1. );

			gl_FragColor = vec4( dev( color.r ), dev( color.g ), dev( color.b ),
				max( colorL.a, colorR.a ) );

		}`

};

class AnaglyphEffect {

	constructor( renderer, width = 512, height = 512 ) {

		this.renderer = renderer;

		const _camera = new OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

		const _scene = new Scene();

		const _stereo = new StereoCamera();

		const _params = { minFilter: LinearFilter, magFilter: NearestFilter, format: RGBAFormat };

		const _renderTargetL = new WebGLRenderTarget( width, height, _params );
		const _renderTargetR = new WebGLRenderTarget( width, height, _params );

		const _material = new ShaderMaterial( {

			uniforms: UniformsUtils.clone( AnaglyphShader.uniforms ),
			vertexShader: AnaglyphShader.vertexShader,
			fragmentShader: AnaglyphShader.fragmentShader,
			transparent: true,
			blending: NoBlending

		} );

		const _mesh = new Mesh( new PlaneGeometry( 2, 2 ), _material );
		_scene.add( _mesh );

		this.setSize = function ( width, height ) {

			renderer.setSize( width, height );

			const pixelRatio = renderer.getPixelRatio();

			_renderTargetL.setSize( width * pixelRatio, height * pixelRatio );
			_renderTargetR.setSize( width * pixelRatio, height * pixelRatio );

		};

		this.render = function ( scene, camera ) {

			const currentRenderTarget = renderer.getRenderTarget();

			_stereo.update( camera );

			renderer.setRenderTarget( _renderTargetL );
			renderer.clear();
			renderer.render( scene, _stereo.cameraL );

			renderer.setRenderTarget( _renderTargetR );
			renderer.clear();
			renderer.render( scene, _stereo.cameraR );

			_material.uniforms[ 'mapLeft' ].value = _renderTargetL.texture;
			_material.uniforms[ 'mapRight' ].value = _renderTargetR.texture;

			renderer.setRenderTarget( null );
			renderer.render( _scene, _camera );

			renderer.setRenderTarget( currentRenderTarget );

		};

		this.dispose = function () {

			_renderTargetL.dispose();
			_renderTargetR.dispose();
			_mesh.geometry.dispose();
			_mesh.material.dispose();

		};

	}

}

export { AnaglyphEffect };
