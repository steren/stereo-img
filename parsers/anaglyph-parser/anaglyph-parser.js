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

import { pixelReader } from './../../lib/pixels.js';

const RED = 0;
const GREEN = 1;
const BLUE = 2;

/**
 * Colour schemes of anaglyph pictures: the colour channels seen by the left eye and by the right eye.
 */
const COLORS = {
  'red-cyan': { left: [RED], right: [GREEN, BLUE] },
  'red-green': { left: [RED], right: [GREEN] },
  'red-blue': { left: [RED], right: [BLUE] },
  'green-magenta': { left: [GREEN], right: [RED, BLUE] },
  'amber-blue': { left: [RED, GREEN], right: [BLUE] },
};

/**
 * Guess the colour scheme of an anaglyph picture.
 *
 * Two channels showing the same eye have their edges at the same places.
 * Channels showing different eyes do not, because of the parallax between the eyes.
 *
 * @param {Uint8ClampedArray} data - RGBA pixels of the picture
 * @param {number} width - width of the picture
 * @param {number} height - height of the picture
 * @returns {string} one of the keys of COLORS
 */
function detectColors(data, width, height) {
  // Look at a coarse grid of pixels: it is faster, and JPEG compression mixes the channels at the finest scale.
  const step = Math.max(1, Math.round(width / 256));
  // Strength of the edges of each channel: sum, sum of squares, and sum of products for each pair of channels
  const sum = [0, 0, 0];
  const squares = [0, 0, 0];
  const products = [0, 0, 0]; // red with green, red with blue, green with blue
  // Brightness of each channel
  const level = [0, 0, 0];
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x + step < width; x += step) {
      const i = (y * width + x) * 4;
      const j = i + step * 4;
      const r = Math.abs(data[j + RED] - data[i + RED]);
      const g = Math.abs(data[j + GREEN] - data[i + GREEN]);
      const b = Math.abs(data[j + BLUE] - data[i + BLUE]);
      sum[RED] += r;
      sum[GREEN] += g;
      sum[BLUE] += b;
      squares[RED] += r * r;
      squares[GREEN] += g * g;
      squares[BLUE] += b * b;
      products[0] += r * g;
      products[1] += r * b;
      products[2] += g * b;
      level[RED] += data[i + RED];
      level[GREEN] += data[i + GREEN];
      level[BLUE] += data[i + BLUE];
      count++;
    }
  }

  // A dark channel holds no picture. It is not exactly black in a JPEG, where compression leaks a little of the other channels into it.
  const brightest = Math.max(...level);
  const isEmpty = channel => level[channel] <= brightest * 0.08;
  if (!isEmpty(RED) && !isEmpty(GREEN) && isEmpty(BLUE)) {
    return 'red-green';
  }
  if (!isEmpty(RED) && isEmpty(GREEN) && !isEmpty(BLUE)) {
    return 'red-blue';
  }
  if (isEmpty(RED) || isEmpty(GREEN) || isEmpty(BLUE)) {
    return 'red-cyan';
  }

  // The two channels whose edges are at the same places show the same eye.
  const correlation = (product, a, b) => {
    const covariance = product / count - (sum[a] / count) * (sum[b] / count);
    const deviations = Math.sqrt((squares[a] / count - (sum[a] / count) ** 2) * (squares[b] / count - (sum[b] / count) ** 2));
    return deviations > 0 ? covariance / deviations : 0;
  };
  const redGreen = correlation(products[0], RED, GREEN);
  const redBlue = correlation(products[1], RED, BLUE);
  const greenBlue = correlation(products[2], GREEN, BLUE);
  if (greenBlue >= redGreen && greenBlue >= redBlue) {
    return 'red-cyan';
  }
  return redBlue >= redGreen ? 'green-magenta' : 'amber-blue';
}

/**
 * fetch the image from URL, read its pixels and return left and right eye images
 * @Param {string} url - image url
 * @Param {Object} (options) - Parsing options:
 *   colors: colour scheme of the picture, one of 'red-cyan', 'red-green', 'red-blue', 'green-magenta', 'amber-blue'. Guessed from the picture if not set.
 *   angle: horizontal angle of view in degrees,
 *   projection: 'equirectangular' or 'fisheye',
 *   signal: AbortSignal to cancel the parsing
 */
async function parseAnaglyph(url, options) {
  const signal = options?.signal;
  const response = await fetch(url, { signal });
  const blob = await response.blob();
  const image = await createImageBitmap(blob);
  signal?.throwIfAborted();
  //image.crossOrigin = "Anonymous";
  const width = image.width;
  const height = image.height;

  // A picture too large for a canvas, on a phone, is read in parts.
  const imageData = pixelReader(image)(0, 0, width, height);
  const { data } = imageData;
  const colors = COLORS[options?.colors] ? options.colors : detectColors(data, width, height);
  const { left, right } = COLORS[colors];

  // Each eye is a grey picture, made of the channels it sees.
  // Allocate both eyes up front: growing regular arrays one channel at a time
  // is slow and uses several gigabytes of memory on large pictures.
  const leftEyePixels = new Uint8ClampedArray(data.length);
  const rightEyePixels = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const l = left.length === 1 ? data[i + left[0]] : (data[i + left[0]] + data[i + left[1]]) / 2;
    const r = right.length === 1 ? data[i + right[0]] : (data[i + right[0]] + data[i + right[1]]) / 2;
    const a = data[i + 3];
    leftEyePixels[i] = l;
    leftEyePixels[i + 1] = l;
    leftEyePixels[i + 2] = l;
    leftEyePixels[i + 3] = a;
    rightEyePixels[i] = r;
    rightEyePixels[i + 1] = r;
    rightEyePixels[i + 2] = r;
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

  return {leftEye, rightEye, phiLength, thetaStart, thetaLength, projection: options?.projection, colors};
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

export {parseAnaglyph, detectColors, COLORS}