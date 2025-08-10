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
 * @returns {Promise<object>} - The stereo data.
 */
export async function parseMono(src, { angle, projection }) {
    const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
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

    return {
        leftEye: imageData,
        rightEye: imageData,
        phiLength: phiLength,
        thetaStart: 0,
        thetaLength: 0,
        projection: projection,
    };
  }
