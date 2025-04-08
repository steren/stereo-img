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

import exifr from './../../vendor/exifr/full.esm.js';

/**
 * fetch the image from URL
 * return left and right eye images from either left / right, right / left, top / bottom, bottom / top. 
 * @Param {string} url - image url
 * @Param {Object} (options) - Parsing options: type: 'left-right' (default), 'right-left' or 'top-bottom', angle: '180' or '360'
 * */
async function parseStereo(url, options) {
  return parseStereoPair(url, null, options);
}

/**
 * fetch the image from separate url (primary) and secondaryURL
 * if secondaryURL is null, assume url contains a stereo images with both included
 * return left and right eye images from either left / right, right / left, top / bottom, bottom / top, url / secondaryURL.
 * @Param {string} url - image url left, or combined left and right
 * @Param {string} secondaryURL - image url right, or null
 * @Param {Object} (options) - Parsing options: type: 'left-right' (default), 'right-left' or 'top-bottom', angle: '180' or '360'
 * */
async function parseStereoPair(url, secondaryURL, options) {
  const image = await createImageFromURL(url);
  //image.crossOrigin = "Anonymous";
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const width = image.width;
  const height = image.height;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0);

  var secondaryImage = null;
  var secondaryCanvas = null;
  var secondaryCtx = null;
  var secondaryWidth = 0;
  var secondaryHeight = 0;
  if (secondaryURL) {
    secondaryImage = await createImageFromURL(secondaryURL);
    //secondaryImage.crossOrigin = "Anonymous";
    secondaryCanvas = document.createElement('canvas');
    secondaryCtx = secondaryCanvas.getContext('2d', {willReadFrequently: true});
    secondaryWidth = secondaryImage.width;
    secondaryHeight = secondaryImage.height;
    secondaryCanvas.width = secondaryWidth;
    secondaryCanvas.height = secondaryHeight;
    secondaryCtx.drawImage(secondaryImage, 0, 0);
  }

  function pixelIsBlack(pixel) {
    const blackThreshold = 10;
    return pixel[0] < blackThreshold && pixel[1] < blackThreshold && pixel[2] < blackThreshold;
  }

  // check if fisheye projection
  let projection;
  if(options?.projection === 'fisheye') {
    projection = 'fisheye';
  } else if(options?.projection === 'equirectangular') { 
    ;
  } else {
    // Read pixels in each corner and middle to see if they are black. If black, assume fisheye image
    const topLeft = ctx.getImageData(0, 0, 1, 1).data;
    const topRight = ctx.getImageData(width - 1, 0, 1, 1).data;
    const bottomLeft = ctx.getImageData(0, height - 1, 1, 1).data;
    const bottomRight = ctx.getImageData(width - 1, height - 1, 1, 1).data;
    const middle = ctx.getImageData(width / 2, height / 2, 1, 1).data;
    if(pixelIsBlack(topLeft) && pixelIsBlack(topRight) && pixelIsBlack(bottomLeft) && pixelIsBlack(bottomRight) && pixelIsBlack(middle)) {
        projection = 'fisheye';
        console.log("Detected fisheye image");
      }
  }

  const exif = await exifr.parse(image, {
    xmp: true,
    multiSegment: true
  })


  // Images
  let type = options.type || 'left-right';

  // Heuristics for Canon RF5.2mm F2.8 L DUAL FISHEYE
  // Unprocessed pictures are right-left. Pictures processed with EOS VR Utility software are left-right.
  if(exif?.Make === 'Canon' && exif?.LensModel === 'RF5.2mm F2.8 L DUAL FISHEYE') {
    if(exif?.Software?.includes('EOS VR Utility')) {
      type = 'left-right';
    } else {
      type = 'right-left';
    }
  }

  let leftEye;
  let rightEye;

  let top = 0;
  let leftLeft = 0;
  let leftRight = width / 2;
  let bottom = height;
  let rightRight = width;
  let rightLeft = width / 2;

  // TODO: This assumes left-right or right-left. Make compatible with top-bottom and bottom-top.
  // fisheye image might have black around image data, measure the actual top, left, bottom, right position of the fisheye circle
  if(projection === 'fisheye') {

    // top
    for(let y = 0; y < height / 2; y++) {
      const pixel = ctx.getImageData(width / 4, y, 1, 1).data;
      if(!pixelIsBlack(pixel)) {
        top = y;
        break;
      }
    }

    // bottom
    for(let y = height - 1; y > height / 2; y--) {
      const pixel = ctx.getImageData(width / 4, y, 1, 1).data;
      if(!pixelIsBlack(pixel)) {
        bottom = y;
        break;
      }
    }

    // left of the left fisheye
    for(let x = 0; x < width / 4; x++) {
      const pixel = ctx.getImageData(x, height / 2, 1, 1).data;
      if(!pixelIsBlack(pixel)) {
        leftLeft = x;
        break;
      }
    }

    // right of the left fisheye
    for(let x = width / 2 - 1; x > width / 4; x--) {
      const pixel = ctx.getImageData(x, height / 2, 1, 1).data;
      if(!pixelIsBlack(pixel)) {
        leftRight = x;
        break;
      }
    }

    // right of the right fisheye
    for(let x = width  - 1; x > 3 * width / 4; x--) {
      const pixel = ctx.getImageData(x, height / 2, 1, 1).data;
      if(!pixelIsBlack(pixel)) {
        rightRight = x;
        break;
      }
    }

    // left of the right fisheye
    for(let x = width / 2 - 1; x > width / 4; x++) {
      const pixel = ctx.getImageData(x, height / 2, 1, 1).data;
      if(!pixelIsBlack(pixel)) {
        rightLeft = x;
        break;
      }
    }


    console.log({top, bottom, leftLeft, leftRight, rightLeft, rightRight});
  }
  

  switch(type) {
    case 'left-right':
      leftEye =  ctx.getImageData(leftLeft, top, leftRight - leftLeft, bottom - top);
      rightEye = ctx.getImageData(rightLeft, top, rightRight - rightLeft, bottom - top);
      break;
    case 'right-left':
      leftEye =  ctx.getImageData(rightLeft, top, rightRight - rightLeft, bottom - top);
      rightEye = ctx.getImageData(leftLeft, top, leftRight - leftLeft, bottom - top);
      break;
    case 'top-bottom':
      leftEye = ctx.getImageData(0, 0, width, height / 2); 
      rightEye = ctx.getImageData(0, height / 2, width, height / 2);
      break;
    case 'bottom-top':
      leftEye = ctx.getImageData(0, height / 2, width, height / 2);
      rightEye = ctx.getImageData(0, 0, width, height / 2);
      break;
    case 'pair':
      // dx is the horizontal shift between left and right eye image to adjust for the difference
      // in eye distance between the camera and human vision.
      // Input deltax is in percent of a single image width. 100% would mean the images are shifted
      // by a full single image width against each other, which would be no overlapping at all, a theoretical value.
      // Result dx is in pixels of the shift for each of the 2 images
      // and half of the deltax as the total shift is the sum of both images's shifts.
      const dx = Math.round(width * (options.deltax ?? 0) / 100 / 2);
      // the field of view is reduced because during the shift,
      // non-overlapping parts between left and right image must be cropped away
      options.angle = options.angle * (100-Math.abs(dx))/100;
      // for positive dx, shift the left image left and right image right,
      // i.e. crop a slice from the left image's left side and right image's right side
      // for negative dx, shift the left image right and right image left,
      // i.e. crop a slice from the left image's right side and right image's left side
      leftEye =  ctx.getImageData(Math.max(0, dx), 0, width-Math.abs(dx), height);
      rightEye = secondaryCtx.getImageData(Math.max(0, -dx), 0, secondaryWidth-Math.abs(dx), secondaryHeight);
      break;
  }
  
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


  // Angles
  let phiLength;
  let thetaLength;

  if(options?.angle === "180" || options?.angle === 180) {
    phiLength = Math.PI;
    thetaLength = Math.PI;

  } else if(options?.angle === "360" || options?.angle === 360) {
    phiLength = Math.PI * 2;
    thetaLength = Math.PI;

  } else if(projection === 'fisheye') {
    // If fisheye, assume 180.
    phiLength = Math.PI;
    thetaLength = Math.PI;

  } else if(exif?.FocalLengthIn35mmFormat) {
    const angle = angleOfViewFocalLengthIn35mmFormat(exif.FocalLengthIn35mmFormat);
    phiLength = angle.horizontalAngle;
    thetaLength = angle.verticalAngle;

  } else if(exif?.Make === 'GoPro' || url.startsWith('gopro') || url.startsWith('GOPR') ) {
    // GoPro (https://gopro.com/help/articles/question_answer/hero7-field-of-view-fov-information?sf96748270=1)
    phiLength = 2.1397737; // 122.6º
    thetaLength = 1.647591;  // 94.4º

  } else if(exif?.Make === 'Canon' && exif?.LensModel === 'RF5.2mm F2.8 L DUAL FISHEYE') {
    // TODO: This lense has a 190º angle of view, but the viewer doesn't support any other angle than 180 for fisheye.
    phiLength = Math.PI;
    thetaLength = Math.PI;

  } else if(exif?.Model === 'insta360 evo') {
    phiLength = Math.PI;
    thetaLength = Math.PI;

  } else if(options?.angle > 0 && options?.angle <= 360) {
    const angle = options?.angle * Math.PI/180.0;
    phiLength = angle;
    thetaLength = angle * height/width;

  } else {
    const assumeFocalLengthIn35mmFormat = 27;
    const angle = angleOfViewFocalLengthIn35mmFormat(assumeFocalLengthIn35mmFormat);
    phiLength = angle.horizontalAngle;
    thetaLength = angle.verticalAngle;
  }

  const thetaStart = Math.PI / 2 - thetaLength / 2;


  return {leftEye, rightEye, phiLength, thetaStart, thetaLength, projection};
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

export {parseStereo, parseStereoPair}
