function extractTag(tag, imgStr) {
    let regexp = new RegExp(tag + '="([\\S]*)"', 'gmi');
    let result = regexp.exec(imgStr);
    if(result) {
        return result[1];
    }
}

async function parse(url) {
    // https://developers.google.com/vr/reference/cardboard-camera-vr-photo-format

    let blob = await fetch(url).then(r => r.blob());

    // fetch(url).then(res => {
    //     return res.arrayBuffer();
    // }).then(buf => {
    //     return new DataView(buf);
    // }).then(data => {


    // https://developer.mozilla.org/en-US/docs/Web/API/Blob/text
    let fileAsText = await blob.text(); 

    // finds it
    //let imgEye2 = extractTag('xmlns:GImage', fileAsText)
    
    // does not find it, likely because text is truncated
    let imgEye2 = extractTag('GImage:Data', fileAsText)

    // use instead https://developer.mozilla.org/en-US/docs/Web/API/Blob/stream ? 

    console.log(imgEye2)
    let leftEye = '';
    let rightEye = '';
    return {leftEye, rightEye};
}

export {parse}