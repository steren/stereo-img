import { parse } from './modules/vr180-parser.js';

window.onload = init;

async function init() {
    let parsedResults = await parse('demo.vr.jpg');
    console.log(parsedResults);
}
