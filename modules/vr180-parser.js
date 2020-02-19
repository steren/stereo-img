function extractTag(tag, imgStr) {
    let regexp = new RegExp(tag + '="([\\S]*)"', 'gmi');
    let result = regexp.exec(imgStr);
    if(result) {
        return result[1];
    }
}

async function parse(url) {
    // https://developers.google.com/vr/reference/cardboard-camera-vr-photo-format

    const fileData = new DataView( await fetch(url).then(r => r.arrayBuffer()) );
    for(let offset = 0; offset < fileData.byteLength - 1; offset++) {
        if(fileData.getUint8(offset) === 0xff && fileData.getUint8(offset + 1) === 0xe1) {
            console.log(`Marker detected at offset ${offset}`);
        }
    }

    // finds it
    //let imgEye2 = extractTag('xmlns:GImage', fileAsText)
    
    // does not find it, likely because text is truncated
    //let imgEye2 = extractTag('GImage:Data', fileAsText)

    //console.log(imgEye2)
    
    // const objectURL = URL.createObjectURL(blob);
    let leftEye = '';
    let rightEye = '';
    return {leftEye, rightEye};
}

export {parse}