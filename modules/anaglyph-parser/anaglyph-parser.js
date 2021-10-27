/** fetch the image from URL, read its pixels and return left and right eye images  */
async function parseAnaglyph(url) {
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
  

  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const leftEyePixels = [];
  const rightEyePixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const a = data[i + 2];
    leftEyePixels.push(r);
    leftEyePixels.push(r);
    leftEyePixels.push(r);
    leftEyePixels.push(a);
    rightEyePixels.push(g);
    rightEyePixels.push(g);
    rightEyePixels.push(g);
    rightEyePixels.push(a);
  }

  const leftEye = new ImageData(new Uint8ClampedArray(leftEyePixels), width, height);
  const rightEye = new ImageData(new Uint8ClampedArray(rightEyePixels), width, height);

  // TODO: use same method as for left-right stereo (share helper function)
  const phiLength = 1.02278;
  const thetaLength =  0.8838;

  const thetaStart = Math.PI / 2 - thetaLength / 2;

  return {leftEye, rightEye, phiLength, thetaStart, thetaLength};
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

export {parseAnaglyph}