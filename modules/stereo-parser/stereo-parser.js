import exifr from 'exifr'

/**
 * fetch the image from URL
 * read its left half, return in left eye image
 * read its right half, return in right eye image  
 * */
async function parseStereo(url) {
  const image = await createImageFromURL(url);
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const width = image.width;
  const height = image.height;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0);

  const exif = await exifr.parse(url, {
    xmp: true,
    multiSegment: true
  })
  
  const leftEye = ctx.getImageData(0, 0, width / 2, height);
  const rightEye = ctx.getImageData(width / 2, 0, width / 2, height);
  
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

  let phiLength;
  let thetaLength;


  if(exif?.FocalLengthIn35mmFormat) {
    const angle = angleOfViewFocalLengthIn35mmFormat(exif.FocalLengthIn35mmFormat);
    phiLength = angle.horizontalAngle;
    thetaLength = angle.verticalAngle;
  } else if(exif?.Make === 'GoPro' || url.includes('gopro') || url.includes('GOPR') ) {
    // GoPro (https://gopro.com/help/articles/question_answer/hero7-field-of-view-fov-information?sf96748270=1)
    phiLength = 2.1397737;
    thetaLength = 1.647591;
  } else {
    const assumeFocalLengthIn35mmFormat = 27;
    const angle = angleOfViewFocalLengthIn35mmFormat(assumeFocalLengthIn35mmFormat);
    phiLength = angle.horizontalAngle;
    thetaLength = angle.verticalAngle;
  }

  const thetaStart = Math.PI / 2 - thetaLength / 2;

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

export {parseStereo}