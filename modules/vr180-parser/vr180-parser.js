const jpegMarker = 0xff;
const jpegMarkerImageStart = 0xd8;
const jpegMarkerExif = 0xe1;

function extractTag(tag, imgStr) {
    let regexp = new RegExp(tag + '="([\\S]*)"', 'gmi');
    let result = regexp.exec(imgStr);
    if(result) {
        return result[1];
    }
}

async function parseVR180(url) {
    // Read more about JPEG structure at https://en.wikipedia.org/wiki/JPEG#Syntax_and_structure

    const fileBuffer = await fetch(url).then(r => r.arrayBuffer());
    const fileData = new DataView(fileBuffer);
    
    // Use to transform ArrayBuffer to String
    const decoder = new TextDecoder();

    if( fileData.getUint8(0) !== jpegMarker || fileData.getUint8(1) !== jpegMarkerImageStart) {
        throw "Not a JPEG file";
    }

    // Iterate over the image raw data
    let i = 2;
    while(i < fileData.byteLength - 1) {
        // Look for JPEG Exif markers
        if(fileData.getUint8(i) === jpegMarker && fileData.getUint8(i + 1) === jpegMarkerExif) {
            i+= 2;

            // the next 2 bytes are the length of the JPEG segment
            const segmentLength = fileData.getUint16(i);
            console.log(`Marker detected at position ${i} with length ${segmentLength}`);

            let segment = new DataView(fileBuffer, i, segmentLength);
            let segStr = decoder.decode(segment)
            console.log(segStr);
        }

        i++;
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

export {parseVR180}