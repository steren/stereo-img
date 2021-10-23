// see official spec at https://developers.google.com/vr/reference/cardboard-camera-vr-photo-format

import exifr from 'https://cdn.skypack.dev/pin/exifr@v7.1.3-Bxn3dmuljZ8rRmNteMgs/mode=imports,min/optimized/exifr.js'

async function parseVR180(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  const image = await createImageBitmap(blob);

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
    multiSegment: true
  })

  var image2 = await createImageBitmapfromBase64(exif.Data);

  const canvas2 = document.createElement('canvas');
  const ctx2 = canvas2.getContext('2d');
  canvas2.width = width;
  canvas2.height = height;
  ctx2.drawImage(image2, 0, 0);

  const rightEye = ctx2.getImageData(0, 0, width, height);

  return {leftEye, rightEye};
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

async function createImageBitmapfromBase64(base64) {
  const image = new Image();
  image.src = "data:image/jpg;base64," + base64;
  return new Promise((resolve, reject) => {
    image.onload = () => {
      resolve(image);
    };
    image.onerror = reject;
  });
}

export {parseVR180}