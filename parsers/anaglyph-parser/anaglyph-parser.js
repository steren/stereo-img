// Copyright 2021 Google LLC
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
 * fetch the image from URL, read its pixels and return left and right eye images
 * @Param {string} url - image url
 * @Param {Object} (options) - Parsing options: angle: horizontal angle of view in degrees, projection: 'equirectangular' or 'fisheye'
 */
async function parseAnaglyph(url, options) {
  const response = await fetch(url);
  const blob = await response.blob();
  const image = await createImageBitmap(blob);
  //image.crossOrigin = "Anonymous";
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const width = image.width;
  const height = image.height;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0);
  

  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  // Allocate both eyes up front: growing regular arrays one channel at a time
  // is slow and uses several gigabytes of memory on large pictures.
  const leftEyePixels = new Uint8ClampedArray(data.length);
  const rightEyePixels = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const a = data[i + 3];
    leftEyePixels[i] = r;
    leftEyePixels[i + 1] = r;
    leftEyePixels[i + 2] = r;
    leftEyePixels[i + 3] = a;
    rightEyePixels[i] = g;
    rightEyePixels[i + 1] = g;
    rightEyePixels[i + 2] = g;
    rightEyePixels[i + 3] = a;
  }

  const leftEye = new ImageData(leftEyePixels, width, height);
  const rightEye = new ImageData(rightEyePixels, width, height);

  // TODO: use same method as for left-right stereo (share helper function)
  let phiLength = 1.02278;
  let thetaLength =  0.8838;

  const angle = Number(options?.angle);
  if (angle === 180) {
    phiLength = Math.PI;
    thetaLength = Math.PI;
  } else if (angle === 360) {
    phiLength = Math.PI * 2;
    thetaLength = Math.PI;
  } else if (angle > 0 && angle < 360) {
    phiLength = angle * Math.PI / 180;
    thetaLength = phiLength * height / width;
  }

  const thetaStart = Math.PI / 2 - thetaLength / 2;

  return {leftEye, rightEye, phiLength, thetaStart, thetaLength, projection: options?.projection};
}

async function createImageBitmap(blob) {
    const url = URL.createObjectURL(blob);
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

export {parseAnaglyph}