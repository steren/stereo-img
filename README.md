# `<stereo-img>`

`<stereo-img>` is a web component to display stereographic pictures on web pages, with VR support.
It supports various stereo and spatial picture formats: VR Photos (VR180, Google Camera panorama, Photosphere), side-by-side / top-bottom / interlaced, JPS, PNG Stereoscopic (PNS / `sTER`), MPO, HEIC, AVIF, Leia Image Format (LIF), RGB-D, depth/portrait photos, Looking Glass quilts, animated wigglegrams, and anaglyph.

See the [demo](https://stereo-img.steren.fr/) for an example of the component in action.

See [stereo-viewer.com](https://stereo-viewer.com/) for a real-world stereo viewer web app using this component.

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


## Compatibility

### Supported cameras

This component has been manually tested to load pictures taken with the following cameras:

| Status | Camera                              | Picture type        | Attributes required                   |  Field of view | Orientation |
| ------ | ----------------------------------- | ------------------- | ------------------------------------- | ------------- | ----------- |
| ✔️     | Lenovo Mirage Camera                | VR180               | (none)                                |  ✓           | ✓ 
| ✔️     | Canon RF5.2mm F2.8 L Dual Fisheye unprocessed | right-left fisheye           | (none)             |  X           | X 
| ✔️     | Canon RF5.2mm F2.8 L Dual Fisheye processed with EOS VR Utility | left-right | (none)             |  X           | X 
| ✔️     | Insta360 Evo                        | left-right          | (none)                                |  X           | X 
| ✔️     | CALF VR180                          | left-right          | (none)                                |  X           | X 
| ✔️     | CALF VR180                          | "vr180"             | `angle="180"`                         |  X           | X 
| ✔️     | Kandao QooCam EGO 3D Camera         | left-right          | (none)                                |  X           | X 
| ✔️     | Pixel phone                         | depth               | (none)                                |  X           | X 
| ✔️     | Panasonic DMC-GX8 with H-FT012 lens | MPO                 | (none)                                |  ✓           | X 
| ✔️     | Leia Lume Pad 2                     | Leia Image Format   | (none)                                |  ✓           | X 
| ✔️     | Leia Lume Pad 2                     | left-right          | (none)                                |  X           | X 
| ✔️     | Apple Vision Pro                    | HEIC                | (none)                                |  ✓           | X 
| ✔️     | iPhone 17 Pro spatial photo         | HEIC                | (none)                                |  ✓           | X 
| ✔️     | iPhone Portrait Mode                | depth (HEIC `auxC`) | (none)                                |  ✓           | X 
| ✔️     | iPhone Portrait Mode                | depth (JPEG MPF)    | (none)                                |  X           | X 
| ✔️     | Spatialify (half side by side)      | half-left-right     | (none) if the file name has `HSBS`, otherwise `type="half-left-right"` |  X           | X 

### Supported viewers and headsets

Entering VR requires the page to be served over HTTPS (or from `localhost`): browsers do not expose WebXR to other pages. The component logs a warning in the console when that is the case.

This component has been manually tested on the following hardware, OS and browsers:

| Hardware    | OS          | Browser         | Status |
| ----------- | -------     | --------------- | ------ |
| HTC Vive    | Windows     | Chrome          | ✔️
| HTC Vive    | Windows     | Firefox         | ✔️
| HTC Vive    | Windows     | Firefox Reality | ✔️
| Cardboard   | Android     | Chrome          | ✔️
| Cardboard   | Android     | Firefox         | ❌
| Cardboard   | iOS         |                 | ❌ [#18](https://github.com/steren/stereo-img/issues/18)
| Quest 1     |             | Default         | ✔️
| Quest 2     |             | Default         | ✔️️
| Quest 3     |             | Default         | ✔️️
| Vision Pro  |             | Safari          | ✔️️ [to be confirmed](https://github.com/steren/stereo-img/issues/34)

## Attributes

* `src`: (Required) source of the stereo picture (absolute or relative)
* `src-right`: (Optional) source of the right eye picture (absolute or relative) for the `pair` type. If used, the source for the left eye picture is read from the `src` attribute.
* `type`: (Optional) type of stereo picture:
  - If unset, type is inferred from heuristics
  - `vr` (or its alias `vr180`): [VR Photo](https://developers.google.com/vr/reference/cardboard-camera-vr-photo-format) - VR180, Google Camera panorama, Cardboard Camera, Photosphere images (Where right eye image and angle of view info are embedded in the image metadata)  When the picture holds the sound recorded with it, a button plays it, and it plays in VR.
  - `left-right`: left eye on the left, right eye on the right, Exif angle of view is used if present.
  - `right-left`: left eye on the right, right eye on the left, Exif angle of view is used if present.
  - `top-bottom`: left eye on the top, right eye on the bottom, Exif angle of view is used if present.
  - `bottom-top`: left eye on the bottom, right eye on the top, Exif angle of view is used if present.
  - `interlaced`: rows alternate between the eyes, the first row being for the left eye.
  - `interlaced-reverse`: rows alternate between the eyes, the first row being for the right eye.
  - `column-interlaced`: columns alternate between the eyes, the first column being for the left eye.
  - `column-interlaced-reverse`: columns alternate between the eyes, the first column being for the right eye.
  - `half-left-right`, `half-right-left`, `half-top-bottom`, `half-bottom-top`: like `left-right`, `right-left`, `top-bottom` and `bottom-top`, for pictures whose two views were squeezed to half of their width (or height) to fit in the size of one, like the "Half SBS" pictures of Spatialify. Nothing in such a picture tells it apart from a regular one: without the `type` attribute, it is only detected when its file name has `HSBS` or `half-SBS` (side by side), or `HOU`, `HTAB` or `half-OU` (top and bottom).
  - `pair`: separate files for left and right image. Left eye image read from `src` attribute, right eye image read from attribute `src-right`. Adding the `src-right` attribute will enable the `pair` type without the need to use the `type` attribute.
  - `mpo`: [Multi-Picture Format](https://en.wikipedia.org/wiki/JPEG#JPEG_Multi-Picture_Format) file of a stereo camera, holding the left and right pictures. Files ending with `.mpo` are detected without the `type` attribute.
  - `jps`: [JPEG Stereoscopic](https://en.wikipedia.org/wiki/JPS_(file_format)) file holding a stereo pair and an optional `APP3` `_JPSJPS_` descriptor (supporting side-by-side, over-under, interleaved, anaglyph, mono, half-width/half-height, and eye-order flags). Files ending with `.jps` or containing an `_JPSJPS_` marker are detected without the `type` attribute.
  - `pns`: PNG Stereoscopic file (`.pns` or a PNG containing the registered `sTER` ancillary chunk). Mode `0` (cross-fuse) is displayed as `right-left` and mode `1` (diverging-fuse) as `left-right`, with Adam7 padding columns stripped when present. Detected automatically without the `type` attribute.
  - `heic`: HEIC picture, like the spatial photos of the Apple Vision Pro and of iPhones (holding the left and right pictures), or Apple Portrait Mode HEIC photos containing `auxC` disparity or metric depth maps. They are detected without the `type` attribute, and displayed in browsers that cannot display HEIC pictures: the decoder ([libheif](https://github.com/strukturag/libheif), about 1.4 MB) is only downloaded for them. A HEIC picture that is not stereoscopic or depth-mapped is displayed as `mono`.
  - `avif` (or `avif-spatial`): AVIF picture with an ISO/IEC 23000-22 `ster` stereo pair entity group or auxiliary `auxC` depth/disparity map. Decoded natively by the browser without downloading a WASM decoder. Detected automatically without the `type` attribute.
  - `lif`: Leia Image Format, the pictures of the Lume Pad tablets. They are detected without the `type` attribute.
  - `anaglyph`: [Anaglyph 3D](https://en.wikipedia.org/wiki/Anaglyph_3D). The colours of the picture are detected. To name them instead, use `anaglyph-red-cyan`, `anaglyph-red-green`, `anaglyph-red-blue`, `anaglyph-green-magenta` or `anaglyph-amber-blue`: the first colour is the one of the left eye.
  - `depth`: Picture with depth or disparity map (e.g., portrait or lens blur mode on Google Camera `GDepth` / Dynamic Depth, or Apple Portrait Mode JPEG MPF disparity maps). Detected automatically from the metadata of the picture.
  - `rgbd` (or `rgbd-sbs`, `rgbd-left-right`, `rgbd-right-left`, `rgbd-top-bottom`, `rgbd-ou`, `rgbd-tb`, `rgbd-bottom-top`): Composite color + depth-map image. `rgbd` chooses side-by-side when `width >= height` and top-bottom otherwise; the layout variants explicitly set which half holds the color image and which holds the depth map (e.g., `rgbd-left-right` / `rgbd-sbs` has color on the left and depth on the right). Without the `type` attribute, files whose name includes an explicit marker (`rgbd`, `rgb-d`, `color-depth`, `rgb-depth`) are detected automatically.
  - `quilt`: Looking Glass Quilt multi-view light-field grid (tiles ordered bottom-left to top-right). Extracts the leftmost and rightmost views as a stereo pair. Detected automatically when the file name includes a `_qs<Cols>x<Rows>a<Aspect>` descriptor (e.g., `render_qs8x6a0.75.png`); otherwise set `type="quilt"` (defaults to `8` columns, `6` rows, `0.75` aspect).
  - `wigglegram` (or `wiggle`, `wiggle-left-right`, `wiggle-right-left`): Animated multi-frame wigglegram (GIF, animated WebP, or APNG with 2 or more frames). Extracts extreme parallax frames as left and right eye views (`wiggle-right-left` reverses the eye order). Multi-frame GIF/WebP/APNG files are detected automatically without the `type` attribute; static single-frame files are unaffected. (Note: `type="wiggle"` specifies the input format, whereas `flat="wiggle"` sets the 2D display mode.)
  - `mono`: A regular, non-stereo picture. The same image is displayed on both eyes.
* `angle`: (Optional) hint at angle of view for `left-right`, `top-bottom`, `interlaced`, `pair` or `anaglyph` types
  - If unset, Exif angle of view is used if present.
  - `DEGREE`: any degree number between 0 and 360
  - `180`: Half sphere (VR180)
  - `360`: Full sphere
* `projection`: (Optional) hint at projection (most VR pictures use equirectangular projection)
  - If unset, projection is inferred from heuristics.
  - `equirectangular`: Equirectangular projection
  - `fisheye`: Fisheye projection
* `disparity-adjustment`: (Optional) Distance to add between the pictures of the two eyes, in percent of the width of one of them. Useful when the two lenses of the camera were further apart, or closer, than human eyes.
  - A negative value moves the pictures closer together: the left one to the right and the right one to the left.
  - A positive value moves them apart.
  - Each picture moves by half of the value. The picture is not loaded again when the value changes.
* `flat`: (Optional) When viewing in 2D, set the display mode.
  - `left`: (Default) Show the left eye image.
  - `right`: Show the right eye image.
  - `wiggle`: Alternate between left and right images to help the user see the 3D effect.
  - `anaglyph`: Show a red-cyan anaglyph image.
* `controlslist`: (Optional) A space-separated list of controls to display.
  - `vr`: Show the "Enter VR" button.
  - `left`: Allow the "left" flat mode.
  - `right`: Allow the "right" flat mode.
  - `wiggle`: Allow the "wiggle" flat mode.
  - `anaglyph`: Allow the "anaglyph" flat mode.
  - `sound`: Show the sound button, for pictures that have sound.
* `muted`: (Optional) When set, the sound of the picture does not start by itself when entering VR. The sound button still plays it.
* `start`: (Optional) Set it to `interaction` on pages with many pictures. See [Pages with many pictures](#pages-with-many-pictures).
* `width` and `height`: (Optional) Size of the element in CSS pixels, like the `width` and `height` attributes of `<img>`. Set them to reserve the space of the element and avoid layout shifts. The CSS of the page wins over them: with both attributes set, an element styled with `width: 100%; height: auto;` keeps their aspect ratio. Without them, an element with no height is given three quarters of its width.
  - The attributes take effect once the script has defined `<stereo-img>`. Until then, the browser lays it out as an unknown inline element of no height, and the content below moves when the script loads. To reserve the space from the first paint, also give the element its layout and size in the CSS of the page, for example for `<stereo-img src="picture.vr.jpg" width="700" height="400">`:
    ```css
    stereo-img {
      display: block;
      width: 100%;
      height: auto;
      aspect-ratio: 700 / 400;
    }
    ```
* `debug`: (Optional) When set, logs diagnostic information to the console and displays the wireframe of the 3D geometry.

## Events

In VR, the viewer can ask for another picture without leaving VR. The element does not know which picture comes next: it tells the page, which changes `src`.

* `next`: the trigger of the right controller, a pinch of the right hand, the button of a Cardboard viewer, or a thumbstick pushed to the right.
* `previous`: the trigger of the left controller, a pinch of the left hand, or a thumbstick pushed to the left.

```js
const pictures = ['first.jpg', 'second.jpg', 'third.jpg'];
let index = 0;
const stereoImg = document.querySelector('stereo-img');

function show(newIndex) {
  index = (newIndex + pictures.length) % pictures.length;
  stereoImg.src = pictures[index];
}

stereoImg.addEventListener('next', () => show(index + 1));
stereoImg.addEventListener('previous', () => show(index - 1));
```

## Pages with many pictures

Each element draws with WebGL, and browsers limit the WebGL contexts of a page.

With `start="interaction"`, an element shows a still of its picture, drawn without a WebGL context of its own, and starts 3D when the viewer points at it, presses on it or touches it:

```html
<stereo-img src="first.jpg" start="interaction"></stereo-img>
<stereo-img src="second.jpg" start="interaction"></stereo-img>
```

## Pictures from other sites

A picture can come from another site than the page, like with `<img>`. But unlike `<img>`, the component has to read the pixels of the picture, which browsers only allow when the server of the picture agrees. That server must send this header with the picture:

```
Access-Control-Allow-Origin: *
```

(or the origin of your page instead of `*`). Without it, nothing is displayed and the reason is logged in the console.

## Contributing

See [development instructions and contribution guidelines](CONTRIBUTING.md)
