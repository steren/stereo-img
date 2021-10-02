import { parse } from './modules/vr180-parser/vr180-parser.js';

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
  
    constructor() {
      super();

      this.addEventListener('click', e => {
        console.log('I was clicked')
      });

      let vrButton = document.createElement('button');
      vrButton.innerText = 'VR';
      this.parentNode.insertBefore(vrButton, this.nextSibling);

    }
  }

window.customElements.define('stereo-img', StereoImg, {extends: 'img'});

// window.onload = init;

// async function init() {
//     let parsedResults = await parse('demo.vr.jpg');
//     console.log(parsedResults);
// }
