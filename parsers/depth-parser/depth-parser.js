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
 * fetch the image from URL
 * return left and right eye images from either left / right, right / left, top / bottom, bottom / top. 
 * @Param {string} url - image url
 * @Param {Object} (options) - Parsing options
 * */
async function parseDepth(url, options) {
  const image = await createImageFromURL(url);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const width = image.width;
  const height = image.height;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0);

  const colorImage = ctx.getImageData(0, 0, width, height);

  const exif = await exifr.parse(url, {
    xmp: true,
    multiSegment: true,
    mergeOutput: false,
    ihdr: true, //unclear why we need this, but if not enabled, some XMP Data are not parsed
  });

  console.log(exif);  

  // exif?.Device?.Cameras
  // type == "http://ns.google.com/photos/dd/1.0/device/:Camera"
  // value.DepthMap
  // value.DepthMap.Near
  // value.DepthMap.Far


  const imageData = await urlToUint8Array(url);
  const parsedImages = parseConcatenatedJFIF(imageData);

  const depthImageArray = parsedImages[4];

  const depthCanvas = document.createElement('canvas');
  // TODO: this isn't the right width and height. Use the image's
  depthCanvas.width = width;
  depthCanvas.height = height;
  const depthCtx = depthCanvas.getContext('2d');
  depthCtx.drawImage(await createImageFromURL(URL.createObjectURL(new Blob([depthImageArray], {type: 'image/jpeg'}))), 0, 0);
  const depthImage = depthCtx.getImageData(0, 0, width, height);  

  //const depthImage = new ImageData(new Uint8ClampedArray(depthImageArray), width, height);
  console.log(depthImage);
  
  // TODO: use same method as for left-right stereo (share helper function)
  const phiLength = 1.02278;
  const thetaLength =  0.8838;

  const thetaStart = Math.PI / 2 - thetaLength / 2;

  // TODO: this is temporary
  const leftEye = depthImage;
  const rightEye = leftEye;

  return {leftEye, rightEye, phiLength, thetaStart, thetaLength};
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

export {parseDepth}