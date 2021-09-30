import { parse } from './modules/vr180-parser/vr180-parser.js';

let tmpl = document.createElement('template');
tmpl.innerHTML = `
  <img src="demo.vr.jpg"></img>
`;

class StereoImg extends HTMLElement {

    get src() {
      return this.getAttribute('src');
    }
    set src(val) {
      // Reflect the value of the open property as an HTML attribute.
      if (val) {
        this.setAttribute('src', val);
      } else {
        this.removeAttribute('open');
      }
    }
  
    constructor() {
      super();

      this.addEventListener('click', e => {
        console.log('I was clicked')
      });

      let shadowRoot = this.attachShadow({mode: 'open'});
      shadowRoot.appendChild(tmpl.content.cloneNode(true));
    }
  }

window.customElements.define('stereo-img', StereoImg);

// window.onload = init;

// async function init() {
//     let parsedResults = await parse('demo.vr.jpg');
//     console.log(parsedResults);
// }
