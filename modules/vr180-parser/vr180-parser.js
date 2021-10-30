// see official spec at https://developers.google.com/vr/reference/cardboard-camera-vr-photo-format

import exifr from 'exifr'

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
  })

  if (!exif.GImage?.Data) {
    const err = "No right eye data found in XMP of image";
    console.error(err);
    return {leftEye, phiLength, thetaStart, thetaLength, error: err};
  }

  var image2 = await createImageFromURL("data:image/jpg;base64," + exif.GImage.Data);

  const canvas2 = document.createElement('canvas');
  const ctx2 = canvas2.getContext('2d');
  canvas2.width = width;
  canvas2.height = height;
  ctx2.drawImage(image2, 0, 0);

  const rightEye = ctx2.getImageData(0, 0, width, height);

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

export {parseVR180}