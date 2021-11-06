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

// see official spec at https://developers.google.com/vr/reference/cardboard-camera-vr-photo-format

import exifr from 'exifr';

async function parseVR180(url) {
  // VR180 are a half sphere
  const phiLength = Math.PI;
  const thetaStart = 0;
  const thetaLength = Math.PI;

  const image = await createImageFromURL(url);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const width = image.width;
  const height = image.height;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0);

  const leftEye = ctx.getImageData(0, 0, width, height);

  const exif = await exifr.parse(url, {
    xmp: true,
    multiSegment: true,
    mergeOutput: false,
    ihdr: true, //unclear why we need this, but if not enabled, some VR180 XMP Data are not parsed
  });

  const result = {leftEye, phiLength, thetaStart, thetaLength};

  if (!exif.GImage?.Data) {
    const err = "No right eye data found in XMP of image";
    console.error(err);
    result.error = err;
    return result;
  }

  if(exif.GPano?.PoseRollDegrees) {
    result.roll = exif.GPano.PoseRollDegrees / 180 * Math.PI;
  }
  if(exif.GPano?.PosePitchDegrees) {
    result.pitch = exif.GPano.PosePitchDegrees / 180 * Math.PI;
  }

  var image2 = await createImageFromURL("data:image/jpg;base64," + exif.GImage.Data);

  const canvas2 = document.createElement('canvas');
  const ctx2 = canvas2.getContext('2d');
  canvas2.width = width;
  canvas2.height = height;
  ctx2.drawImage(image2, 0, 0);

  result.rightEye = ctx2.getImageData(0, 0, width, height);

  return result;
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

export {parseVR180}