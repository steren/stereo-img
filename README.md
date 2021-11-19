# `<stereo-img>`

`<stereo-img>` is a web component to display stereographic pictures on web pages, with VR support.
It supports various stereo picture formats: VR Photos (VR180, Google Camera panorama, Photosphere), left-right, and anaglyph.

See the [demo](https://stereo-img.steren.fr/) for an example.

## How to use

Load the module and its dependencies from a CDN:

```html
<script type="module" src="https://cdn.skypack.dev/stereo-img"></script>
```

Then use the `<stereo-img>` custom element anywhere in your page or app, reference a stereo picture in the `src` attribute:

```html
<stereo-img src="picture.vr.jpg"></stereo-img>
```

## Attributes

* `src`: (Required) source of the stereo picture (absolute or relative)
* `type`: (Optional) type of stereo picture:
  - `vr`: [VR Photo](https://developers.google.com/vr/reference/cardboard-camera-vr-photo-format) - VR180, Google Camera panorama, Carboard Camera, Photosphere images (Where right eye image and angle of view info are embedded in the image metadata) 
  - `left-right`: left eye on the left, right eye on the right, Exif angle of view is used if present.
  - `top-bottom`: left eye on the top, right eye on the bottom, Exif angle of view is used if present.
  - `anaglyph`: [Anaglyph 3D](https://en.wikipedia.org/wiki/Anaglyph_3D) - currently only supporting red / green
  - If unset, type is inferred from heuristics.
* `angle`: (Optional) hint at angle of view for `left-right` or `top-bottom` types
  - `180`: Half sphere (VR180)
  - `360`: Full sphere
  - If unset, Exif angle of view is used if present.

## Compatibility

This component has been manually tested on the following hardware, OS and browsers:

| Hardware    | OS          | Browser         | Status |
| ----------- | -------     | --------------- | ------ |
| HTC Vive    | Windows     | Chrome          | ✔️
| HTC Vive    | Windows     | Firefox         | ✔️⚠️ With [WebXR polyfill](https://github.com/immersive-web/webxr-polyfill)
| HTC Vive    | Windows     | Firefox Reality | ✔️
| Cardboard   | Android     | Chrome          | ✔️
| Cardboard   | Android     | Firefox         | ❌

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