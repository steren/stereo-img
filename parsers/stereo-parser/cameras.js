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
 *     width and height of that picture, diameter of a circle and horizontal position of the centre of the left one.
 *     Circles are vertically centred and placed symmetrically.
 */
const CAMERAS = [
  {
    name: 'Canon RF5.2mm F2.8 L Dual Fisheye',
    exif: { Make: 'Canon', LensModel: 'RF5.2mm F2.8 L DUAL FISHEYE' },
    // Unprocessed pictures are right-left. Pictures processed with EOS VR Utility software are left-right.
    type: exif => exif.Software?.includes('EOS VR Utility') ? 'left-right' : 'right-left',
    // TODO: This lens has a 190º angle of view, but the viewer doesn't support any other angle than 180 for fisheye.
    angle: { horizontal: 180, vertical: 180 },
    // Measured on examples/canon-eos-r5-dual-fisheye.jpg
    fisheyeCircles: { width: 8192, height: 5464, diameter: 3750, leftCenter: 1980 },
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
 * @returns {{top: number, bottom: number, leftLeft: number, leftRight: number, rightLeft: number, rightRight: number}} the edges of both circles, in pixels
 */
function fisheyeCircleEdges(circles, width, height) {
  const radius = circles.diameter / 2;
  const horizontal = position => Math.round(position * width / circles.width);
  const vertical = position => Math.round(position * height / circles.height);
  return {
    top: vertical(circles.height / 2 - radius),
    bottom: vertical(circles.height / 2 + radius),
    leftLeft: horizontal(circles.leftCenter - radius),
    leftRight: horizontal(circles.leftCenter + radius),
    rightLeft: horizontal(circles.width - circles.leftCenter - radius),
    rightRight: horizontal(circles.width - circles.leftCenter + radius),
  };
}

export { CAMERAS, findCamera, cameraType, fisheyeCircleEdges };
