/** fetch the image from URL, read its pixels and return left and right eye images  */
async function parseAnaglyph(url) {
    // this code has been hallucinated by Copilot and not tested
    const image = await fetchImage(url);
    const { width, height } = image;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;
    const leftEye = [];
    const rightEye = [];
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a === 0) {
            leftEye.push(0);
            rightEye.push(0);
        }
        else {
            leftEye.push(r);
            rightEye.push(g);
        }
    }
    return {
        left: leftEye,
        right: rightEye
    };  
}
  

export {parseAnaglyph}