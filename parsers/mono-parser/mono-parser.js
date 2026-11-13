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

/**
 * Parses a monoscopic image and returns stereo data with the same image for both eyes.
 * @param {string} src - The URL of the image to parse.
 * @param {object} options - The options for parsing.
 * @param {number} options.angle - The field of view angle.
 * @param {string} options.projection - The projection type.
 * @param {AbortSignal} [options.signal] - Signal to cancel the parsing.
 * @returns {Promise<object>} - The stereo data.
 */
export async function parseMono(src, { angle, projection, signal }) {
    signal?.throwIfAborted();
    const image = await new Promise((resolve, reject) => {
        const img = new Image();
        const onAbort = () => {
            // Stop downloading the image.
            img.onload = null;
            img.onerror = null;
            img.src = '';
            reject(signal.reason);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            signal?.removeEventListener('abort', onAbort);
            resolve(img);
        };
        img.onerror = (err) => {
            signal?.removeEventListener('abort', onAbort);
            reject(err);
        };
        img.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    
    // default to a plane geometry if no angle is specified
    const phiLength = angle ? parseFloat(angle) * Math.PI / 180 : Math.PI / 3;
    // Vertically, the picture is centred and keeps its proportions: 180 and 360 degrees are a half and a full sphere.
    const degrees = parseFloat(angle);
    const thetaLength = degrees === 180 || degrees === 360 ? Math.PI : Math.min(Math.PI, phiLength * image.height / image.width);

    return {
        leftEye: imageData,
        rightEye: imageData,
        phiLength: phiLength,
        thetaStart: Math.PI / 2 - thetaLength / 2,
        thetaLength: thetaLength,
        projection: projection,
    };
  }
