// TODO: only load the module that corresponds to "type"
import { parseVR180 } from './modules/vr180-parser/vr180-parser.js';
import { parseStereo } from './modules/stereo-parser/stereo-parser.js';

class StereoImg extends HTMLElement {

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

    get src() {
      return this.getAttribute('src');
    }
    set src(val) {
      // Reflect the value of the open property as an HTML attribute.
      if (val) {
        this.setAttribute('src', val);
      } else {
        this.removeAttribute('src');
      }
    }

    renderOnCanvas() {
      this.canvas = document.createElement('canvas');
      this.canvas.height = this.stereoData.leftEye.height;
      this.canvas.width = this.stereoData.leftEye.width;
      const ctx = this.canvas.getContext('2d');      
      this.shadowRoot.appendChild(this.canvas);
      
      let currentEye = 0;
      const leftEye = this.stereoData.leftEye;
      const rightEye = this.stereoData.rightEye;
      setInterval(() => {
        if(!this.pause) {
          if(currentEye === 0) {
            ctx.putImageData(leftEye, 0, 0);
          } else {
            ctx.putImageData(rightEye, 0, 0);
          }
          currentEye = (currentEye + 1) % 2;
        }
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

      this.addEventListener('click', () => {
        this.pause = !this.pause;
      });

      let vrButton = document.createElement('button');
      vrButton.innerText = 'VR';
      this.attachShadow({mode: 'open'});
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            contain: content;
          }
          canvas {
            width: 100%;
          }
        </style>
      `;
      this.shadowRoot.appendChild(vrButton);

      this.parse();
    }

  }

window.customElements.define('stereo-img', StereoImg);

