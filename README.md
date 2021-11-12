# `<stereo-img>`

`<stereo-img>` is a web component to display stereographic pictures on web pages, with VR support.
It supports various stereo picture formats: VR Photos (VR180, Google Camera panorama, Photosphere), left-right, and anaglyph.

## How to use

Load the `stereo-img.js` JavaScript module. For example using a `<script>` tag in your your HTML file:

```html
<script type="module" src="stereo-img.js"></script>
```

Then use the `<stereo-img>` custom element anywhere:

```html
<stereo-img src="picture.vr.jpg" type="vr"></stereo-img>
```


### Options

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
| Cardboard   | Android     | Chrome          | ❌ ([Chrome bug](https://bugs.chromium.org/p/chromium/issues/detail?id=1267732))
| Cardboard   | Android     | Firefox         | ❌

## TODO

- Panoramas don't load on mobile, likely due to max WebGL texture size of 4096, see https://webglreport.com 
- Add support for sound (GAudio)
- clicking Enter VR on a second image returns `DOMException: Failed to execute 'requestSession' on 'XRSystem': There is already an active, immersive XRSession.`  
- fix anaglyph parser to handle the [many types of color schemes](https://en.wikipedia.org/wiki/Anaglyph_3D#Stereo_conversion_(single_2D_image_to_3D)) (red-blue, red-green, red-cyan...)
- Add a simple type that takes 2 images as input: `type="single" src="" src-right=""`
- add loading when parsing image
- make sure the component renders when size is updated
- Do not start a Three.js scene before the user interacts with the component (to avoid potentially creating too many WebGL contexts), use a canvas2d fallback in the meanwhile.
- In index.html, go to previous / next using VR controllers
- OrbitControls is probably not the best choice for panning in non-VR mode
- better adjust field of view in non-VR mode so that no black margins appear
- strip `examples/` and other hidden folders before publishing to npm