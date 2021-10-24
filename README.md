# stereo-img


## TODO

- clicking Enter VR on a second image returns `DOMException: Failed to execute 'requestSession' on 'XRSystem': There is already an active, immersive XRSession.`  
- improve non-VR experience (e.g. panning? allow switching between left / right eye?)
- fix anaglyph parser to handle the [many types of color schemes](https://en.wikipedia.org/wiki/Anaglyph_3D#Stereo_conversion_(single_2D_image_to_3D)) (red-blue, red-green, red-cyan...)
- Add a simple type that takes 2 images as input: `type="single" src="" src-right=""`