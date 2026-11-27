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
import { readMpoDisparity } from '../mpo-parser/mpo-parser.js';

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
 * Find the depth map stored in the "GDepth" XMP metadata of a picture.
 * This is the format of the "Lens Blur" mode of older versions of Google Camera.
 * See https://developers.google.com/depthmap-metadata/reference
 *
 * @param {Object} exif - metadata of the file, as parsed by exifr
 * @returns {{depth: string, image: string|undefined}|undefined} URLs of the depth map and of the
 *   picture it applies to, when the metadata holds one. Undefined if there is no such depth map.
 */
function findGDepth(exif) {
  const data = exif?.GDepth?.Data;
  if (typeof data !== 'string' || !data) {
    return;
  }
  const dataUrl = (mime, base64) => `data:${mime};base64,${base64}`;
  return {
    depth: dataUrl(exif.GDepth.Mime || 'image/png', data),
    // The file itself shows the picture once blurred. The metadata holds the original, sharp everywhere.
    image: typeof exif.GImage?.Data === 'string' && exif.GImage.Data ? dataUrl(exif.GImage.Mime || 'image/jpeg', exif.GImage.Data) : undefined,
  };
}


/**
 * Fetch the image from the provided URL and parse a JPEG that contains an embedded depth map,
 * such as the portrait mode pictures of Google Camera.
 *
 * @param {string} url - image url
 * @param {Object} [options] - Parsing options: signal: AbortSignal to cancel the parsing, exif: metadata of the image, when already read (with the options used below)
 * @returns {Promise<{depth: HTMLImageElement, leftEye: HTMLImageElement, rightEye: HTMLImageElement, phiLength: number, thetaStart: number, thetaLength: number}>} A promise that resolves with an object containing the parsed data.
 */
async function parseDepth(url, options) {
  const signal = options?.signal;
  signal?.throwIfAborted();
  const image = await createImageFromURL(url, signal);
  signal?.throwIfAborted();

  const imageData = options?.bytes || await urlToUint8Array(url, signal);

  let exif = options?.exif;
  if (!exif) {
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
  }
  signal?.throwIfAborted();

  // TODO: use the depth range of the depth map:
  // exif?.Device?.Cameras?.value?.DepthMap.Near
  // exif?.Device?.Cameras?.value?.DepthMap.Far

  let depth;
  let picture = image;
  const gdepth = findGDepth(exif);
  if (gdepth) {
    depth = await createImageFromURL(gdepth.depth, signal);
    if (gdepth.image) {
      picture = await createImageFromURL(gdepth.image, signal);
    }
  } else {
    // Check Container metadata, MPF secondary disparity map, or fall back to fifth image
    const containerDepth = findDepthMapFromMetadata(imageData, exif);
    const mpf = containerDepth ? undefined : readMpoDisparity(imageData);
    const depthImageArray = containerDepth ||
                            mpf?.disparity ||
                            parseConcatenatedJFIF(imageData)[4];
    if (!depthImageArray) {
      throw new Error('No depth map found in image');
    }
    const depthUrl = URL.createObjectURL(new Blob([depthImageArray], {type: 'image/jpeg'}));
    try {
      depth = await createImageFromURL(depthUrl, signal);
    } finally {
      URL.revokeObjectURL(depthUrl);
    }
    if (!containerDepth && mpf?.disparity && mpf.depthType !== 'depth') {
      depth = invertDisparityImage(depth);
    }
  }
  signal?.throwIfAborted();
  
  // TODO: use same method as for left-right stereo (share helper function)
  const phiLength = 1.02278;
  const thetaLength =  0.8838;

  const thetaStart = Math.PI / 2 - thetaLength / 2;

  // return same image in both left and right eyes. Also add depth map. 
  const leftEye = picture;
  const rightEye = leftEye;

  return {depth, leftEye, rightEye, phiLength, thetaStart, thetaLength};
}

/**
 * Invert RGB grayscale values of an MPF disparity image (255 = near, 0 = far)
 * to metric depth polarity (0 = near, 255 = far) expected by stereo-img.js.
 * Returns the input unchanged when running without a 2D canvas DOM (e.g. Node unit tests).
 * @param {HTMLImageElement} image
 * @returns {HTMLCanvasElement|HTMLImageElement}
 */
function invertDisparityImage(image) {
  if (typeof document === 'undefined' || !image) {
    return image;
  }
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    return image;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !ctx.drawImage || !ctx.getImageData || !ctx.putImageData) {
    return image;
  }
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData?.data;
  if (!data) {
    return image;
  }
  const limit = data.length - (data.length % 4);
  for (let i = 0; i < limit; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function createImageFromURL(url, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const image = new Image();
    const onAbort = () => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      reject(signal.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    image.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(image);
    };
    image.onerror = (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    };
    image.src = url;
  });
}

async function urlToUint8Array(url, signal)
{
  const response = await fetch(url, { signal });
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export { parseDepth, invertDisparityImage }
