JPS (JPEG Stereoscopic):

* [`mario.jps`](mario.jps): Real stereoscopic `.jps` photograph (`ti1-1080-fhd.jps`, cross-eyed right-left 1080p) downloaded from [`Bill-Costa/3D-Test-Images`](https://github.com/Bill-Costa/3D-Test-Images/blob/master/JPS/ti1-1080-fhd.jps) (`https://raw.githubusercontent.com/Bill-Costa/3D-Test-Images/master/JPS/ti1-1080-fhd.jps`, MIT License).

PNG Stereoscopic (sTER / PNS):

* [`stereograph.sTER.png`](stereograph.sTER.png): Transcoded from the 1901 Underwood & Underwood stereograph ([`stereograph.left-right.jpg`](https://en.wikipedia.org/wiki/File:Stereograph_as_an_educator.jpg)), embedded with PNG registered ancillary `sTER` chunk before `IDAT` (Mode 1, diverging-fuse, CRC `0xB5E4B59C`). Public Domain.

Google Camera panorama: 

* `pixel3xl.PANO.jpg`: personal panorama picture taken with Google Camera on Pixel 3 XL 
* `pixel5.PANO.jpg`: personal panorama picture taken with Google Camera on Pixel 5
* [`walrus-360.top-bottom.jpg`](https://github.com/googlearchive/vrview/blob/master/examples/hotspots/walrus.jpg): most likely a Cardboard Camera picture transfomced to top - bottom image

VR180: 

* `vr180-lenovo-mirage.vr.jpg`: personal picture taken with Lenovo Mirage camera

Stereograph: 

* [`stereograph.left-right.jpg`](https://en.wikipedia.org/wiki/File:Stereograph_as_an_educator.jpg)

CGI:

* [`capoda.left-right.jpg`](capoda.left-right.jpg): Repository CGI stereo sample ("CAPODA", left-right), Apache-2.0.

GoPro:

* `hand-made.left-right.jpg`: personal picture, taken with 2 Go Pro cameras side by side

Anaglyph: 

* [`wikipedia.anaglyph.jpg`](https://commons.wikimedia.org/wiki/File:3D_dusk_on_Desert.jpg)
* [`persepolis.anaglyph.jpg`](https://commons.wikimedia.org/wiki/File:Persepolis_(By_Abdolazim_Hasseli).jpg)

Canon EOS R5

* `canon-eos-r5-dual-fisheye.jpg`: personal picture taken with Canon EOS R5 and dual fisheye lens, as the file is saved by the camera (fisheye)
* `canon-eos-r5-dual-fisheye-processed.jpg`: personal picture taken with Canon EOS R5 and dual fisheye lens, processed with Canon EOS VR Utility software to: switch the order of the left and right eye images and use an equirectangular projection

[CALF](https://calfglobal.com/)

* `calf-vr180.jpg`: personal picture taken using the CALF 3D VR180 camera using VR180 option (Donated by [Arian Kulp](https://github.com/atkulp) in [this issue](https://github.com/steren/stereo-img/issues/20).
* `calf-left-right.jpg`: personal picture taken using the CALF 3D VR180 camera using the flattened option (Donated by [Arian Kulp](https://github.com/atkulp) in [this issue](https://github.com/steren/stereo-img/issues/20).

[Kandao QooCam EGO 3D Camera](https://us.kandaovr.com/products/qoocam-ego)

* `kandao-qoocam-ego.jpg`: personal picture taken using the Kandao Qoocam Ego camera (Donated by [Adeo](https://twitter.com/deo_pepas))

Panasonic DMC-GX8 with H-FT012

* `Panasonic-DMC-GX8.mpo`: personal picture taken using the Panasonic DMC-GX8 camera with a H-FT012 lens (Donated by [Adeo](https://twitter.com/deo_pepas))
* `Panasonic-DMC-GX8.jpg`: personal picture taken using the Panasonic DMC-GX8 camera with a H-FT012 lens, then converted from `. mpo` to `.jpg` (Donated by [Adeo](https://twitter.com/deo_pepas))
* `Panasonic-DMC-GX8-left.jpg` and `Panasonic-DMC-GX8-right.jpg`: personal picture taken using the Panasonic DMC-GX8 camera with a H-FT012 lens, then converted from `. mpo` to `.jpg`, then split between left and right images.

Leia [Lume Pad 2](https://www.leiainc.com/lume-pad-2)

* `leia_lume_pad2.jpg`: personal picture taken using Lume Pad 2. In Leia Image Format (LIF) (Donated by [Nima Zeighami](https://github.com/VR-Nima))
* `leia_lume_pad2_2x1.jpg`: personal picture taken using Lume Pad 2 converted to regular side by side left-right.

Apple Vision Pro

* [`vision-pro.HEIC`](vision-pro.HEIC): personal picture taken using Apple Vision Pro camera (Donated by [Cyril Dorsaz](https://twitter.com/cyrildorsaz))

Apple iPhone

* [`iphone-spatial.HEIC`](iphone-spatial.HEIC): spatial photo taken using an iPhone 17 Pro (Donated by [Cyril Dorsaz](https://twitter.com/cyrildorsaz))

iPhone with [Spatialify](https://apps.apple.com/us/app/spatialify/id6471922894)

* [`spatialify-iphone_HSBS.jpg`](spatialify-iphone_HSBS.jpg): picture taken with the spatial photo capture mode of Spatialify on iPhone, exported as half side by side (Donated by [Josh3DIRL](https://github.com/Josh3DIRL) in [this issue](https://github.com/steren/stereo-img/issues/33)). Originally named `1704619673618_HSBS.jpg`.

Depth 

* [`Pixel7Pro.PORTRAIT.jpg`](Pixel7Pro.PORTRAIT.jpg): personal picture taken with Google Camera on Pixel 7 Pro, in portrait mode.

Apple Portrait Mode Depth (HEIC `auxC` & JPEG MPF):

* [`apple-portrait-pug.heic`](apple-portrait-pug.heic): Real iPhone Portrait Mode HEIC (`4032×3024` primary + `768×576` HEVC auxiliary disparity map using `urn:mpeg:hevc:2015:auxid:2` with `depth_representation_info` SEI uniform disparity `d-min`/`d-max`), downloaded from [`bigcat88/pillow_heif`](https://github.com/bigcat88/pillow_heif/blob/master/tests/images/heif_other/pug.heic) (`https://raw.githubusercontent.com/bigcat88/pillow_heif/master/tests/images/heif_other/pug.heic`, BSD-3-Clause).
* [`apple-portrait-mug.jpg`](apple-portrait-mug.jpg): Real iPhone Portrait Mode JPEG with Multi-Picture Format (MPF) auxiliary images (primary photo + HDR gain map + XMP `apdi:AuxiliaryImageType="disparity"` disparity map), downloaded from [`lyangas/depthmap_from_jpeg`](https://github.com/lyangas/depthmap_from_jpeg/blob/master/test.jpeg) (`https://raw.githubusercontent.com/lyangas/depthmap_from_jpeg/master/test.jpeg`).

Interlaced:

* [`cork.interlaced.jpg`](cork.interlaced.jpg): Row-interlaced stereoscopic photograph ("Immagine Stereoscopica Interlacciata"), downloaded from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Immagine_Stereoscopica_Interlacciata.jpg) (Public Domain).

RGB-D (Color + Depth Composite):

* [`sample-rgbd.png`](sample-rgbd.png): `1920×540` side-by-side composite (`960×540` color left + `960×540` 8-bit disparity right, 255 = near, 0 = far), built from the indoor color + 16-bit depth pair `example_data/color_12.png` + `example_data/depth_12.png` (`1920×1080`, `884–5253` mm) from [`Aedelon/rgbd-depth`](https://github.com/Aedelon/rgbd-depth) (`https://raw.githubusercontent.com/Aedelon/rgbd-depth/master/example_data/color_12.png` and `depth_12.png`, Apache-2.0).

AVIF Spatial / Stereo Photos (`ster` entity group):

* [`spatial-stereo.avif`](spatial-stereo.avif): `640×553` per-eye AV1 stereo AVIF container with an ISO/IEC 23000-22 MIAF `grpl` / `ster` entity group (`[1, 2]`), transcoded via `heif-enc -A` from the Public Domain 1901 Underwood & Underwood stereograph [`stereograph.left-right.jpg`](stereograph.left-right.jpg) ([Wikimedia](https://en.wikipedia.org/wiki/File:Stereograph_as_an_educator.jpg)).

Looking Glass Quilt (`_qs<Cols>x<Rows>a<Aspect>`):

* [`looking-glass_qs8x6a0.75.png`](looking-glass_qs8x6a0.75.png): `3360×3360` Looking Glass 8×6 Quilt (48 views of `420×560`, `0.75` aspect), downloaded from [`peterwilli/Liquilt`](https://github.com/peterwilli/Liquilt/blob/master/test_quilt.png) (`https://raw.githubusercontent.com/peterwilli/Liquilt/master/test_quilt.png`, MIT License).

Animated Wigglegrams (`.gif`, `.webp`, `.apng`):

* [`london-underground.wiggle.gif`](london-underground.wiggle.gif): `660×500` 2-frame animated GIF wigglegram ("London Underground Train 3D Wigglegram" by Albin Olsson), downloaded from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:London_Underground_Wigglegram.gif) (`https://upload.wikimedia.org/wikipedia/commons/5/54/London_Underground_Wigglegram.gif`, CC BY-SA 3.0).

Insta360 Evo

* [`insta360evo.jpg`](insta360evo.jpg): personal picture taken using Insta360 Evo donated by @azw413 [here](https://github.com/steren/stereo-img/issues/48)

