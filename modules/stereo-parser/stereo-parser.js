/**
 * fetch the image from URL
 * read its left half, return in left eye image
 * read its right half, return in right eye image  
 * */
async function parseStereo(url) {
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
  const leftEye = ctx.getImageData(0, 0, width / 2, height);
  const rightEye = ctx.getImageData(width / 2, 0, width / 2, height);
  return {
    leftEye: leftEye,
    rightEye: rightEye
  };
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

export {parseStereo}