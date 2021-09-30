import { parse } from './modules/vr180-parser/vr180-parser.js';

let tmpl = document.createElement('template');
tmpl.innerHTML = `
  <button>VR</button>
`;

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

      //// <img> doesn't allow for attaching shadowDOM, so it's unclear how we will add a VR button
      // let shadowRoot = this.attachShadow({mode: 'open'});
      // shadowRoot.appendChild(tmpl.content.cloneNode(true));
    }
  }

window.customElements.define('stereo-img', StereoImg, {extends: 'img'});

// window.onload = init;

// async function init() {
//     let parsedResults = await parse('demo.vr.jpg');
//     console.log(parsedResults);
// }
