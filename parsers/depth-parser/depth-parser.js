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
 * Fetch the image from the provided URL and parse a portrait mode JPEG that
 * contains concatenated left and right eye images plus an embedded depth map.
 *
 * @param {string} url - image url
 * @param {Object} [options] - Parsing options
 * @returns {Promise<{depth: HTMLImageElement, leftEye: HTMLImageElement, rightEye: HTMLImageElement, phiLength: number, thetaStart: number, thetaLength: number}>} A promise that resolves with an object containing the parsed data.
 */
async function parseDepth(url, options) {
  const image = await createImageFromURL(url);

  const exif = await exifr.parse(url, {
    xmp: true,
    multiSegment: true,
    mergeOutput: false,
    ihdr: true, //unclear why we need this, but if not enabled, some XMP Data are not parsed
  });

  // TODO: Check exif data for depth map
  console.log(exif);  

  // exif?.Device?.Cameras
  // type == "http://ns.google.com/photos/dd/1.0/device/:Camera"
  // value.DepthMap
  // value.DepthMap.Near
  // value.DepthMap.Far


  const imageData = await urlToUint8Array(url);
  const parsedImages = parseConcatenatedJFIF(imageData);

  const depthImageArray = parsedImages[4];
  const depth = await createImageFromURL(URL.createObjectURL(new Blob([depthImageArray], {type: 'image/jpeg'})))
  
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
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = reject;
  });
}

async function urlToUint8Array(url)
{
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export { parseDepth }
