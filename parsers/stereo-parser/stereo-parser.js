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

import exifr from 'exifr'

/**
 * fetch the image from URL
 * read its left half, return in left eye image
 * read its right half, return in right eye image  
 * @Param {string} url - image url
 * @Param {Object} (options) - Parsing options: type: 'left-right' or 'top-bottom', angle: '180' or '360'
 * */
async function parseStereo(url, options) {
  const image = await createImageFromURL(url);
  image.crossOrigin = "Anonymous";
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const width = image.width;
  const height = image.height;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0);

  const exif = await exifr.parse(url, {
    xmp: true,
    multiSegment: true
  })
  
  const leftEye = options?.type === 'top-bottom' ? ctx.getImageData(0, 0, width, height / 2) : ctx.getImageData(0, 0, width / 2, height);
  const rightEye = options?.type === 'top-bottom' ? ctx.getImageData(0, height / 2, width, height / 2) : ctx.getImageData(width / 2, 0, width / 2, height);
  
  let angleOfViewFocalLengthIn35mmFormat = function(focalLengthIn35mmFormat) {
    // https://en.wikipedia.org/wiki/Angle_of_view#Common_lens_angles_of_view
    // https://en.wikipedia.org/wiki/35_mm_equivalent_focal_length
    // angle of view on the diagonal (35mm is 24 mm (vertically) × 36 mm (horizontal), giving a diagonal of about 43.3 mm)
    const diagonalAngle = 2 * Math.atan(43.3 / (2 * focalLengthIn35mmFormat));
    // Pi / 4 for a square.
    const halfAngle = Math.atan(height / (width / 2));
    const horizontalAngle = diagonalAngle * Math.cos(halfAngle);
    const verticalAngle = diagonalAngle * Math.sin(halfAngle);

    return {diagonalAngle, horizontalAngle, verticalAngle};
  }

  let phiLength;
  let thetaLength;

  if(options?.angle === "180" || options?.angle === 180) {
    phiLength = Math.PI;
    thetaLength = Math.PI;
  } else if(options?.angle === "360" || options?.angle === 360) {
    phiLength = Math.PI * 2;
    thetaLength = Math.PI;
  } else if(exif?.FocalLengthIn35mmFormat) {
    const angle = angleOfViewFocalLengthIn35mmFormat(exif.FocalLengthIn35mmFormat);
    phiLength = angle.horizontalAngle;
    thetaLength = angle.verticalAngle;
  } else if(exif?.Make === 'GoPro' || url.includes('gopro') || url.includes('GOPR') ) {
    // GoPro (https://gopro.com/help/articles/question_answer/hero7-field-of-view-fov-information?sf96748270=1)
    phiLength = 2.1397737;
    thetaLength = 1.647591;
  } else {
    const assumeFocalLengthIn35mmFormat = 27;
    const angle = angleOfViewFocalLengthIn35mmFormat(assumeFocalLengthIn35mmFormat);
    phiLength = angle.horizontalAngle;
    thetaLength = angle.verticalAngle;
  }

  const thetaStart = Math.PI / 2 - thetaLength / 2;

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

export {parseStereo}