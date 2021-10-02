// TODO: only load the module that corresponds to "type"
import { parseVR180 } from './modules/vr180-parser/vr180-parser.js';
import { parseStereo } from './modules/stereo-parser/stereo-parser.js';

class StereoImg extends HTMLImageElement {

    /**
     * type attribute: "left-right" (default), "top-bottom", "vr180"
     */
    get type() {
      return this.getAttribute('type');
    }
    set type(val) {
      // Reflect the value of the open property as an HTML attribute.
      if (val) {
        this.setAttribute('type', val);
      } else {
        this.removeAttribute('type');
      }
    }

    renderOnCanvas() {
      this.canvas = document.createElement('canvas');
      this.canvas.height = this.stereoData.leftEye.height;
      this.canvas.width = this.stereoData.leftEye.width;
      const ctx = this.canvas.getContext('2d');
      this.parentNode.insertBefore(this.canvas, this.nextSibling);
      
      let currentEye = 0;
      const leftEye = this.stereoData.leftEye;
      const rightEye = this.stereoData.rightEye;
      setInterval(() => {
        if(currentEye === 0) {
          ctx.putImageData(leftEye, 0, 0);
        } else {
          ctx.putImageData(rightEye, 0, 0);
        }
        currentEye = (currentEye + 1) % 2;
      }, 100);

    }
  
    async parse() {
      if(this.type === 'vr180') {
        this.stereoData = await parseVR180(this.src);
      } else if(this.type === 'left-right') {
        this.stereoData = await parseStereo(this.src);
      }
      console.log(this.stereoData);
      this.renderOnCanvas();
    }

    constructor() {
      super();

      this.addEventListener('click', e => {
        console.log('I was clicked')
      });

      let vrButton = document.createElement('button');
      vrButton.innerText = 'VR';
      this.parentNode.insertBefore(vrButton, this.nextSibling);

      this.parse();
    }

  }

window.customElements.define('stereo-img', StereoImg, {extends: 'img'});

