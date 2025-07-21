# `<stereo-img>`

`<stereo-img>` is a web component to display stereographic pictures on web pages, with VR support.
It supports various stereo picture formats: VR Photos (VR180, Google Camera panorama, Photosphere), left-right, and anaglyph.

See the [demo](https://stereo-img.steren.fr/) for an example.

## How to use

Load the module:

```html
<script type="module" src="https://stereo-img.steren.fr/stereo-img.js"></script>
```

Then use the `<stereo-img>` custom element anywhere in your page or app, reference a stereo picture in the `src` attribute:

```html
<stereo-img src="picture.vr.jpg"></stereo-img>
```

Alternatively, you can serve the module from your own server, install it via npm:

```bash
npm install stereo-img
```

## Attributes

* `src`: (Required) source of the stereo picture (absolute or relative)
* `src-right`: (Optional) source of the right eye picture (absolute or relative) for the `pair` type. If used, the source for the left eye picture is read from the `src` attribute.
* `type`: (Optional) type of stereo picture:
  - If unset, type is inferred from heuristics
  - `vr`: [VR Photo](https://developers.google.com/vr/reference/cardboard-camera-vr-photo-format) - VR180, Google Camera panorama, Cardboard Camera, Photosphere images (Where right eye image and angle of view info are embedded in the image metadata) 
  - `left-right`: left eye on the left, right eye on the right, Exif angle of view is used if present.
  - `right-left`: left eye on the right, right eye on the left, Exif angle of view is used if present.
  - `top-bottom`: left eye on the top, right eye on the bottom, Exif angle of view is used if present.
  - `bottom-top`: left eye on the bottom, right eye on the top, Exif angle of view is used if present.
  - `pair`: separate files for left and right image. Left eye image read from `src` attribute, right eye image read from attribute `src-right`. Adding the `src-right` attribute will enable the `pair` type without the need to use the `type` attribute.
  - `anaglyph`: [Anaglyph 3D](https://en.wikipedia.org/wiki/Anaglyph_3D) - currently only supporting red / green
  - `depth`: Picture with depth map (e.g. portrait mode on Google Camera)
* `angle`: (Optional) hint at angle of view for `left-right`, `top-bottom`, or `pair` types
  - If unset, Exif angle of view is used if present.
  - `DEGREE`: any degree number between 0 and 360
  - `180`: Half sphere (VR180)
  - `360`: Full sphere
* `projection`: (Optional) hint at projection (most VR pictures use equirectangular projection)
  - If unset, projection is inferred from heuristics.
  - `equirectangular`: Equirectangular projection
  - `fisheye`: Fisheye projection
* `wiggle`: (Optional) When viewing in 2D, alternate between left and right images to help the user see the 3D effect
  - `enabled`: wiggle is enabled
  - `disabled`: wiggle is disabled

## Compatibility

### Supported cameras

This component has been manually tested to load pictures taken with the following cameras:

| Status | Camera                              | Picture type        | Attributes required                   |  Field of view | Orientation |
| ------ | ----------------------------------- | ------------------- | ------------------------------------- | ------------- | ----------- |
| ✔️     | Lenovo Mirage Camera                | VR180               | (none)                                |  ✓           | ✓ 
| ✔️     | Canon RF5.2mm F2.8 L Dual Fisheye unprocessed | left-right fisheye           | (none)             |  X           | X 
| ✔️     | Canon RF5.2mm F2.8 L Dual Fisheye processed with EOS VR Utility | left-right | (none)             |  X           | X 
| ✔️     | Insta360 Evo                        | left-right          | (none)                                |  X           | X 
| ✔️     | CALF VR180                          | left-right          | (none)                                |  X           | X 
| ✔️     | CALF VR180                          | "vr180"             | `angle="180"`                         |  X           | X 
| ✔️     | Kandao QooCam EGO 3D Camera         | left-right          | (none)                                |  X           | X 
| ✔️     | Pixel phone                         | depth               | `type="depth"`                        |  X           | X 
| ❌     | Vision Pro                          |                     |                                       |              | 

### Supported viewers and headsets

This component has been manually tested on the following hardware, OS and browsers:

| Hardware    | OS          | Browser         | Status |
| ----------- | -------     | --------------- | ------ |
| HTC Vive    | Windows     | Chrome          | ✔️
| HTC Vive    | Windows     | Firefox         | ✔️⚠️ With [WebXR polyfill](https://github.com/immersive-web/webxr-polyfill)
| HTC Vive    | Windows     | Firefox Reality | ✔️
| Cardboard   | Android     | Chrome          | ✔️
| Cardboard   | Android     | Firefox         | ❌
| Cardboard   | iOS         |                 | ❌ [#18](https://github.com/steren/stereo-img/issues/18)
| Quest 1     |             | Default         | ✔️
| Quest 2     |             | Default         | ✔️️
| Quest 3     |             | Default         | ✔️️
| Vision Pro  |             | Safari          | ❌ [#34](https://github.com/steren/stereo-img/issues/34)

## Installing using npm

Instead of a CDN, you can install the module locally using [npm](https://www.npmjs.com/):

```bash
npm install stereo-img
```

Then, use a JavaScript builder or [import-maps](https://github.com/WICG/import-maps) to load the module and its dependencies:

If using import-maps:

```html
<!-- Shim for importmap -->
<script async src="https://unpkg.com/es-module-shims@1.3.0/dist/es-module-shims.js"></script>
<script type="importmap">
  {
    "imports": {
      "stereo-img": "./node_modules/stereo-img/stereo-img.js",
      "exifr": "./node_modules/exifr/dist/full.esm.js",
      "three": "./node_modules/three/build/three.module.js",
      "three/": "./node_modules/three/"
    }
  }
</script>
```

Then load the `stereo-img` module:

```html
<script type="module">import "stereo-img";</script>
```

## Contributing

See [development instructions and contribution guidelines](CONTRIBUTING.md)
