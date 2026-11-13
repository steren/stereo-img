// Copyright 2024 Google LLC
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

import exifr from './../../vendor/exifr/full.esm.js';

function parseConcatenatedJFIF(imageData) {
  const jpeg = new Uint8Array(imageData);
  const markers = [];
  let start = 0;
  for (let i = 0; i < jpeg.length; i++) {
    if (jpeg[i] === 0xff) {
      if (jpeg[i + 1] === 0xd8) {
        start = i;
      } else if (jpeg[i + 1] === 0xd9) {
        markers.push(jpeg.slice(start, i + 2));
        start = i;
      }
    }
  }
  return markers;
}


/**
 * Find the depth map in the list of embedded images described by the
 * "Container" XMP metadata of the picture.
 * See https://developer.android.com/media/camera/camera2/Dynamic-depth-v1.0.pdf
 *
 * The first item is the primary image. The other ones are appended to the
 * file, in the same order, and the metadata gives the length of each.
 *
 * @param {Uint8Array} jpeg - content of the file
 * @param {Object} exif - metadata of the file, as parsed by exifr
 * @returns {Uint8Array|undefined} the depth map image, if the metadata describes one
 */
function findDepthMapFromMetadata(jpeg, exif) {
  const directory = exif?.Container?.Directory;
  if (!directory) {
    return;
  }
  const items = (Array.isArray(directory) ? directory : [directory]).map(entry => entry?.Item || entry);

  const depthURI = exif?.Device?.Cameras?.value?.DepthMap?.DepthURI;
  const depthIndex = items.findIndex(item => item?.Semantic === 'Depth' || (item?.DataURI && item.DataURI === depthURI));
  if (depthIndex < 1) {
    return;
  }

  // Appended images are located from the end of the file.
  const lengthFrom = index => items.slice(index).reduce((total, item) => total + (Number(item?.Length) || 0), 0);
  const start = jpeg.length - lengthFrom(depthIndex);
  const end = jpeg.length - lengthFrom(depthIndex + 1);
  if (start < 0 || end <= start) {
    return;
  }
  return jpeg.slice(start, end);
}


/**
 * Fetch the image from the provided URL and parse a portrait mode JPEG that
 * contains concatenated left and right eye images plus an embedded depth map.
 *
 * @param {string} url - image url
 * @param {Object} [options] - Parsing options: signal: AbortSignal to cancel the parsing
 * @returns {Promise<{depth: HTMLImageElement, leftEye: HTMLImageElement, rightEye: HTMLImageElement, phiLength: number, thetaStart: number, thetaLength: number}>} A promise that resolves with an object containing the parsed data.
 */
async function parseDepth(url, options) {
  const signal = options?.signal;
  signal?.throwIfAborted();
  const image = await createImageFromURL(url);
  signal?.throwIfAborted();

  const imageData = await urlToUint8Array(url, signal);

  let exif;
  try {
    exif = await exifr.parse(imageData, {
      xmp: true,
      multiSegment: true,
      mergeOutput: false,
      ihdr: true, //unclear why we need this, but if not enabled, some XMP Data are not parsed
    });
  } catch (e) {
    // no metadata, fall back to the position of the depth map in the file
  }
  signal?.throwIfAborted();

  // TODO: use the depth range of the depth map:
  // exif?.Device?.Cameras?.value?.DepthMap.Near
  // exif?.Device?.Cameras?.value?.DepthMap.Far

  // Without metadata, assume the layout of Pixel portrait pictures, where the depth map is the fifth image.
  const depthImageArray = findDepthMapFromMetadata(imageData, exif) || parseConcatenatedJFIF(imageData)[4];
  if (!depthImageArray) {
    throw new Error('No depth map found in image');
  }
  const depthUrl = URL.createObjectURL(new Blob([depthImageArray], {type: 'image/jpeg'}));
  let depth;
  try {
    depth = await createImageFromURL(depthUrl);
  } finally {
    URL.revokeObjectURL(depthUrl);
  }
  
  // TODO: use same method as for left-right stereo (share helper function)
  const phiLength = 1.02278;
  const thetaLength =  0.8838;

  const thetaStart = Math.PI / 2 - thetaLength / 2;

  // return same image in both left and right eyes. Also add depth map. 
  const leftEye = image;
  const rightEye = leftEye;

  return {depth, leftEye, rightEye, phiLength, thetaStart, thetaLength};
}

async function createImageFromURL(url) {
  const image = new Image();
  image.src = url;
  return new Promise((resolve, reject) => {
    image.onload = () => {
      resolve(image);
    };
    image.onerror = reject;
  });
}

async function urlToUint8Array(url, signal)
{
  const response = await fetch(url, { signal });
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export { parseDepth }
