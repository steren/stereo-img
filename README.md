# `<stereo-img>`

`<stereo-img>` is a web component to display stereographic pictures on web pages, with VR support.
It supports various stereo picture formats: VR Photos (VR180, Google Camera panorama, Photosphere), left-right, and anaglyph.

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
  - `pair`: separate files for left and right image. Left eye image read from `src` attribute, right eye image read from attribute `src-right`. Adding the `src-right` attribute will enable the `pair` type without the need to use the `type` attribute.
  - `mpo`: [Multi-Picture Format](https://en.wikipedia.org/wiki/JPEG#JPEG_Multi-Picture_Format) file of a stereo camera, holding the left and right pictures. Files ending with `.mpo` are detected without the `type` attribute.
  - `lif`: Leia Image Format, the pictures of the Lume Pad tablets. They are detected without the `type` attribute.
  - `anaglyph`: [Anaglyph 3D](https://en.wikipedia.org/wiki/Anaglyph_3D). The colours of the picture are detected. To name them instead, use `anaglyph-red-cyan`, `anaglyph-red-green`, `anaglyph-red-blue`, `anaglyph-green-magenta` or `anaglyph-amber-blue`: the first colour is the one of the left eye.
  - `depth`: Picture with depth map (e.g. portrait or lens blur mode on Google Camera). Detected from the metadata of the picture.
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
* `wiggle`: (Deprecated) Use the `flat="wiggle"` attribute instead.
* `controlslist`: (Optional) A space-separated list of controls to display.
  - `vr`: Show the "Enter VR" button.
  - `left`: Allow the "left" flat mode.
  - `right`: Allow the "right" flat mode.
  - `wiggle`: Allow the "wiggle" flat mode.
  - `anaglyph`: Allow the "anaglyph" flat mode.
  - `sound`: Show the sound button, for pictures that have sound.
* `muted`: (Optional) When set, the sound of the picture does not start by itself when entering VR. The sound button still plays it.
* `debug`: (Optional) When set, logs diagnostic information to the console and displays the wireframe of the 3D geometry.

## Events

In VR, the viewer can ask for another picture without leaving VR. The element does not know which picture comes next: it tells the page, which changes `src`.

* `next`: the trigger of the right controller, a pinch of the right hand, the button of a Cardboard viewer, or a thumbstick pushed to the right.
* `previous`: the trigger of the left controller, a pinch of the left hand, or a thumbstick pushed to the left.

The `detail` of the event tells what the viewer used: `input` is `"select"` or `"thumbstick"`, `handedness` is `"left"`, `"right"` or `"none"`. The events bubble.

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

## Outside of VR

The picture fills the element, like an image with `object-fit: cover`. To see more of it:

* Drag the picture. A flat picture slides; a picture that surrounds the viewer, such as a VR180 photo or a panorama, turns around them.
* Zoom with the wheel, or with a pinch on a touch screen.

The view stops at the edges of the picture: no empty margin is shown around it.

## In VR

A stereo picture is what two eyes saw from one place: the viewer is kept in the middle of it. Turning the head looks around; moving the head does not move the viewer in the picture, which has no other side to show. A picture with a depth map is the exception: it has relief, stays where it is in the room, and moving the head shows it from another angle.

A picture does not always surround the viewer: a flat picture floats in front of them, a VR180 photo leaves what is behind them empty. What is around the picture takes the colours of its edges, dimmed: the colour of its top above it, the colour of its bottom below it, and a gradient from one to the other beside it.

## Pictures from other sites

A picture can come from another site than the page, like with `<img>`. But unlike `<img>`, the component has to read the pixels of the picture, which browsers only allow when the server of the picture agrees. That server must send this header with the picture:

```
Access-Control-Allow-Origin: *
```

(or the origin of your page instead of `*`). Without it, nothing is displayed and the reason is logged in the console.

## Compatibility

### Large pictures

A GPU limits the size of a texture: often 4096 pixels on a phone, when the picture of one eye of a VR180 camera can be 8192 pixels wide. A picture larger than this limit is cut into tiles, each in its own texture: it keeps all of its details.

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
| ✔️     | Pixel phone                         | depth               | (none)                                |  X           | X 
| ✔️     | Panasonic DMC-GX8 with H-FT012 lens | MPO                 | (none)                                |  ✓           | X 
| ✔️     | Leia Lume Pad 2                     | Leia Image Format   | (none)                                |  ✓           | X 
| ✔️     | Leia Lume Pad 2                     | left-right          | (none)                                |  X           | X 
| ❌     | Vision Pro                          |                     |                                       |              | 

### Supported viewers and headsets

Entering VR requires the page to be served over HTTPS (or from `localhost`): browsers do not expose WebXR to other pages. The component logs a warning in the console when that is the case.

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

The package has no dependency to install or to map: its copies of [three.js](https://threejs.org/) and [exifr](https://github.com/MikeKovarik/exifr) are included in its `vendor` folder and imported with relative paths.

Load the module from where it is installed:

```html
<script type="module" src="./node_modules/stereo-img/stereo-img.js"></script>
```

Or, to import it by name, use a JavaScript bundler or an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap):

```html
<script type="importmap">
  {
    "imports": {
      "stereo-img": "./node_modules/stereo-img/stereo-img.js"
    }
  }
</script>
<script type="module">import "stereo-img";</script>
```

## Contributing

See [development instructions and contribution guidelines](CONTRIBUTING.md)
