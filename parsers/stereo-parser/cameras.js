// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Cameras and lenses whose pictures do not say enough about themselves:
 * what is known about them is written here.
 *
 * To support a new one, add an entry to this list. A picture uses the first entry it matches.
 *
 * How a picture is matched. At least one of:
 * - exif: metadata fields of the picture and the value they must have. A value is a string, for an exact match, or a regular expression.
 * - fileName: regular expression that the name of the file must match.
 * With both, matching one is enough.
 *
 * What is known about its pictures. All optional:
 * - type: layout of the picture, such as 'right-left', whatever was asked for.
 *     Can be a function of the metadata, when it depends on how the picture was processed.
 * - angle: horizontal and vertical angles of view, in degrees. Used when the picture has no focal length.
 * - fisheyeCircles: for fisheye pictures, where the two circles are, as measured on a reference picture:
 *     width of that picture, diameter of the circle that 180° cover and horizontal position of the centre of the left one.
 *     The viewer displays these 180°, on half a sphere: what a lens sees beyond is left out.
 *     It expects an equidistant fisheye, where the distance to the centre of the circle is proportional to the angle to the axis of the lens.
 *     Circles are placed symmetrically, around the middle of the height.
 */
const CAMERAS = [
  {
    name: 'Canon RF5.2mm F2.8 L Dual Fisheye',
    exif: { Make: 'Canon', LensModel: 'RF5.2mm F2.8 L DUAL FISHEYE' },
    // Unprocessed pictures are right-left. Pictures processed with EOS VR Utility software are left-right.
    type: exif => exif.Software?.includes('EOS VR Utility') ? 'left-right' : 'right-left',
    // This lens has a 190º angle of view, of which the 180° in the middle are displayed.
    angle: { horizontal: 180, vertical: 180 },
    // The lens is equidistant, see https://paulbourke.net/stereoscopy/Canon_RF_dual_fisheye/
    // Measured on examples/canon-eos-r5-dual-fisheye.jpg, by comparing it with what EOS VR Utility makes of it,
    // which is examples/canon-eos-r5-dual-fisheye-processed.jpg: 180° cover 3700 pixels, so the 190° of the lens cover 3905.
    // Centres are where both eyes see at the same place what is far away.
    fisheyeCircles: { width: 8192, diameter: 3700, leftCenter: 1983 },
  },
  {
    name: 'GoPro',
    exif: { Make: 'GoPro' },
    // GoPro cameras name their pictures "GOPR0001.JPG".
    fileName: /^gopr/i,
    // https://gopro.com/help/articles/question_answer/hero7-field-of-view-fov-information
    angle: { horizontal: 122.6, vertical: 94.4 },
  },
  {
    name: 'Insta360 Evo',
    exif: { Model: 'insta360 evo' },
    angle: { horizontal: 180, vertical: 180 },
  },
];

/**
 * The name of the file at the end of a URL.
 * @param {string} url - image url, absolute or relative
 * @returns {string} the file name, empty if the URL has none
 */
function fileNameOf(url) {
  if (typeof url !== 'string' || url.startsWith('data:')) {
    return '';
  }
  return url.split(/[?#]/)[0].split('/').pop();
}

function matchesExif(expected, exif) {
  return Object.entries(expected).every(([field, value]) =>
    value instanceof RegExp ? typeof exif?.[field] === 'string' && value.test(exif[field]) : exif?.[field] === value);
}

/**
 * Find what is known about the camera of a picture.
 * @param {Object} exif - metadata of the picture
 * @param {string} url - url of the picture
 * @param {Array<Object>} [cameras] - the cameras to look in
 * @returns {Object|undefined} the entry of the camera, if it is a known one
 */
function findCamera(exif, url, cameras = CAMERAS) {
  const fileName = fileNameOf(url);
  return cameras.find(camera =>
    (camera.exif && matchesExif(camera.exif, exif)) || (camera.fileName && camera.fileName.test(fileName)));
}

/**
 * The layout of the pictures of a camera.
 * @param {Object|undefined} camera - entry of the camera
 * @param {Object} exif - metadata of the picture
 * @returns {string|undefined} the layout, if the camera imposes one
 */
function cameraType(camera, exif) {
  return typeof camera?.type === 'function' ? camera.type(exif || {}) : camera?.type;
}

/**
 * Where the two fisheye circles of a camera are in a picture.
 * @param {Object} circles - fisheyeCircles of the entry of the camera
 * @param {number} width - width of the picture
 * @param {number} height - height of the picture
 * @param {number} [verticalOffset] - how many pixels lower the circle on the right is than the one on the left.
 *     It changes from one copy of a lens to another.
 * @returns {{left: {x: number, y: number, size: number}, right: {x: number, y: number, size: number}}}
 *     the square around each circle, in pixels: its left, its top and the length of its sides. It can go beyond the picture.
 */
function fisheyeCircleSquares(circles, width, height, verticalOffset = 0) {
  // Circles are as large on a picture that is cropped, as a frame of a video is: only the width tells the scale.
  const scale = width / circles.width;
  const size = Math.round(circles.diameter * scale);
  const leftCenter = circles.leftCenter * scale;
  const square = (centerX, centerY) => ({ x: Math.round(centerX - size / 2), y: Math.round(centerY - size / 2), size });
  return {
    left: square(leftCenter, height / 2 - verticalOffset / 2),
    right: square(width - leftCenter, height / 2 + verticalOffset / 2),
  };
}

// How much higher than a picture the circles of a camera can be. Pictures and frames of videos cut a bit of the top and bottom
// of the circles. A picture much shorter than its circles is not from the camera, whatever its metadata say:
// the squares around its circles would be many times larger than the picture.
const LARGEST_CIRCLE_TO_HEIGHT = 1.5;

/**
 * Tell if the circles of a camera can be in a picture of that size.
 * @param {Object} circles - fisheyeCircles of the entry of the camera
 * @param {number} width - width of the picture
 * @param {number} height - height of the picture
 * @returns {boolean}
 */
function fisheyeCirclesFit(circles, width, height) {
  const { size } = fisheyeCircleSquares(circles, width, height).left;
  return width > 0 && height > 0 && size <= height * LARGEST_CIRCLE_TO_HEIGHT;
}

export { CAMERAS, findCamera, cameraType, fisheyeCircleSquares, fisheyeCirclesFit };
