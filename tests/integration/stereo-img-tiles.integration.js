import { expect } from '@esm-bundle/chai';
import '../../stereo-img.js';

async function waitFor(condition, description, timeout = 30000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/**
 * A side by side picture, the same for both eyes.
 * @param {Function} draw - draws one eye, given the context of a canvas of the size of the eye
 * @returns {Promise<string>} its URL
 */
async function makePicture(draw, eyeWidth, eyeHeight) {
  const eye = document.createElement('canvas');
  eye.width = eyeWidth;
  eye.height = eyeHeight;
  draw(eye.getContext('2d'), eyeWidth, eyeHeight);

  const canvas = document.createElement('canvas');
  canvas.width = eyeWidth * 2;
  canvas.height = eyeHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(eye, 0, 0);
  ctx.drawImage(eye, eyeWidth, 0);
  // without loss, to keep the details
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(blob);
}

/** Squares of one pixel, black and white: the finest detail a picture can have. */
function checkerboard(ctx, width, height) {
  const pixels = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = (x + y) % 2 === 0 ? 255 : 0;
      pixels.data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  ctx.putImageData(pixels, 0, 0);
}

/** Every pixel of a different colour: neighbours have nothing in common. */
function noise(ctx, width, height) {
  const pixels = ctx.createImageData(width, height);
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed >> 16 & 0xff;
  };
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data.set([random(), random(), random(), 255], i);
  }
  ctx.putImageData(pixels, 0, 0);
}

/** Large shapes of many colours, like a photo. */
function shapes(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, 'rgb(250, 120, 40)');
  gradient.addColorStop(0.5, 'rgb(40, 200, 120)');
  gradient.addColorStop(1, 'rgb(60, 80, 240)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `hsl(${i * 47 % 360}, 80%, ${30 + i * 13 % 50}%)`;
    ctx.beginPath();
    ctx.arc((i * 211 % 1000) / 1000 * width, (i * 367 % 1000) / 1000 * height, width / 30 + (i * 29 % 50) / 600 * width, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/** Colours that change slowly, without any edge: where two tiles meet, a difference between them would show. */
function soft(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, 'rgb(250, 120, 40)');
  gradient.addColorStop(0.5, 'rgb(40, 200, 120)');
  gradient.addColorStop(1, 'rgb(60, 80, 240)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 24; i++) {
    const x = (i * 211 % 1000) / 1000 * width;
    const y = (i * 367 % 1000) / 1000 * height;
    const radius = width / 6 + (i * 29 % 50) / 300 * width;
    const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
    blob.addColorStop(0, `hsla(${i * 47 % 360}, 80%, ${30 + i * 13 % 50}%, 0.8)`);
    blob.addColorStop(1, `hsla(${i * 47 % 360}, 80%, ${30 + i * 13 % 50}%, 0)`);
    ctx.fillStyle = blob;
    ctx.fillRect(0, 0, width, height);
  }
}

describe('stereo-img cuts pictures that are too large for one texture into tiles', function () {
  this.timeout(120000);

  let element;
  const WIDTH = 400;
  const HEIGHT = 300;

  afterEach(() => {
    element?.remove();
    element?.renderer?.setAnimationLoop(null);
    element = null;
  });

  /**
   * Display a picture.
   * @param {Object} attributes - attributes of the element
   * @param {number} [maxTextureSize] - pretend that the GPU has this limit
   */
  async function display(attributes, maxTextureSize) {
    element?.remove();
    element?.renderer?.setAnimationLoop(null);
    element = document.createElement('stereo-img');
    element.style.width = `${WIDTH}px`;
    element.style.height = `${HEIGHT}px`;
    if (maxTextureSize) {
      element._maxTextureSize = () => maxTextureSize;
    }
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);
    await waitFor(() => element.stereoData && !element.loadingIndicator.visible, 'the picture');
    element.renderer.setPixelRatio(1);
    element.renderer.setSize(WIDTH, HEIGHT);
    // the tests place the camera themselves
    element.renderer.setAnimationLoop(null);
  }

  const meshes = (eye = 1) => element.stereoImageGroup.children.filter(object => object.isMesh && object.layers.isEnabled(eye));
  const tiles = (eye = 1) => meshes(eye).map(mesh => mesh.userData.tile);

  /**
   * Draw what an eye sees and give the pixels.
   * @param {Object} view - where the camera is, where it looks at, and how wide
   */
  function render({ position = [0, 0, 0], target = [0, 0, -1], fov = 60, eye = 1 } = {}) {
    const camera = element.camera;
    camera.position.set(...position);
    camera.lookAt(position[0] + target[0], position[1] + target[1], position[2] + target[2]);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    camera.layers.set(eye);
    element.renderer.render(element.scene, camera);
    camera.layers.set(1);

    const gl = element.renderer.getContext();
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  /** How different two drawings are: on average, and at worst, on a scale of 255. */
  function difference(a, b) {
    let sum = 0;
    let worst = 0;
    for (let i = 0; i < a.length; i++) {
      const delta = Math.abs(a[i] - b[i]);
      sum += delta;
      worst = Math.max(worst, delta);
    }
    return { mean: sum / a.length, worst };
  }

  /** The share of the pixels of two drawings that differ by more than an amount, on a scale of 255. */
  function shareOfDifferentPixels(a, b, amount = 24) {
    let different = 0;
    for (let i = 0; i < a.length; i += 4) {
      const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      different += delta > amount ? 1 : 0;
    }
    return different / (a.length / 4);
  }

  /**
   * Draw the same views of a picture in one texture, then in tiles, and compare.
   * @returns {Promise<Array<{mean: number, worst: number}>>} the difference for each view
   */
  async function compareWithOneTexture(attributes, maxTextureSize, views) {
    await display(attributes);
    expect(meshes().length, 'meshes without tiles').to.equal(1);
    const whole = views.map(view => render(view));

    await display(attributes, maxTextureSize);
    expect(meshes().length, 'tiles').to.be.greaterThan(1);
    return views.map((view, i) => {
      const cut = render(view);
      return { ...difference(whole[i], cut), different: shareOfDifferentPixels(whole[i], cut) };
    });
  }

  /** Where a pixel of the picture of an eye is in the scene, for a flat picture. */
  function onPlane(x, y, eyeWidth, eyeHeight) {
    const planeHeight = 20 * eyeHeight / eyeWidth;
    return [(x / eyeWidth - 0.5) * 20, (0.5 - y / eyeHeight) * planeHeight, 0];
  }

  it('draws a picture on several meshes, each with a texture that fits', async () => {
    await display({ src: await makePicture(shapes, 1024, 512), type: 'left-right' }, 256);

    for (const eye of [1, 2]) {
      const parts = tiles(eye);
      expect(parts.length, `tiles of eye ${eye}`).to.be.greaterThan(8);
      let covered = true;
      for (const tile of parts) {
        expect(tile.width).to.be.at.most(256);
        expect(tile.height).to.be.at.most(256);
        expect(tile.x >= 0 && tile.y >= 0 && tile.x + tile.width <= 1024 && tile.y + tile.height <= 512, 'inside the picture').to.equal(true);
      }
      // every pixel of the picture is in a tile
      for (let y = 0; y < 512; y += 16) {
        for (let x = 0; x < 1024; x += 16) {
          covered = covered && parts.some(tile => x >= tile.x && x < tile.x + tile.width && y >= tile.y && y < tile.y + tile.height);
        }
      }
      expect(covered, `the picture of eye ${eye} is covered`).to.equal(true);
    }
  });

  it('keeps one mesh and one texture for a picture that fits', async () => {
    await display({ src: await makePicture(shapes, 256, 128), type: 'left-right' }, 256);

    expect(meshes(1).length).to.equal(1);
    expect(meshes(2).length).to.equal(1);
    expect(tiles()[0]).to.equal(undefined);
    expect(meshes()[0].material.map.image.width).to.equal(256);
  });

  it('keeps every detail of the picture', async () => {
    const eyeWidth = 1024;
    const eyeHeight = 512;
    await display({ src: await makePicture(checkerboard, eyeWidth, eyeHeight), type: 'left-right' }, 256);

    // Look very closely at a place where four tiles meet: 25 pixels of the picture over the 400 of the element.
    const corner = tiles().find(tile => tile.x > 0 && tile.y > 0);
    const position = onPlane(corner.x + 32, corner.y + 32, eyeWidth, eyeHeight);
    const pixels = render({ position, fov: 2.1 });

    // The squares are seen: dark in their middle, light in their middle, blended in between.
    // Reduced to the size of a texture, the picture would be an even grey.
    let sum = 0;
    let squares = 0;
    let dark = 0;
    let light = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      sum += pixels[i];
      squares += pixels[i] * pixels[i];
      dark += pixels[i] < 96 ? 1 : 0;
      light += pixels[i] >= 224 ? 1 : 0;
    }
    const total = pixels.length / 4;
    const contrast = Math.sqrt(squares / total - (sum / total) ** 2);
    expect(contrast, 'contrast').to.be.greaterThan(20);
    expect(dark / total, 'share of dark pixels').to.be.greaterThan(0.01);
    expect(light / total, 'share of light pixels').to.be.greaterThan(0.03);
  });

  it('draws the same as one texture, seen from close: no seam between tiles', async () => {
    const eyeWidth = 1024;
    const eyeHeight = 512;
    const attributes = { src: await makePicture(noise, eyeWidth, eyeHeight), type: 'left-right' };
    // the places where the tiles meet do not depend on the picture
    await display(attributes, 256);
    const corners = tiles().filter(tile => tile.x > 0 && tile.y > 0).slice(0, 4);
    const views = corners.map(corner => ({ position: onPlane(corner.x + 32, corner.y + 32, eyeWidth, eyeHeight), fov: 8.4 }));
    views.push({ position: onPlane(corners[0].x + 32, corners[0].y + 32, eyeWidth, eyeHeight), fov: 8.4, eye: 2 });

    const differences = await compareWithOneTexture(attributes, 256, views);

    // With every pixel of a different colour, a tile that is one pixel off would change everything.
    for (const { mean, different } of differences) {
      expect(mean, 'average difference').to.be.below(1);
      expect(different, 'share of pixels that differ').to.be.below(0.002);
    }
  });

  it('draws the same as one texture, seen from afar', async () => {
    const attributes = { src: await makePicture(soft, 1024, 512), type: 'left-right' };

    const differences = await compareWithOneTexture(attributes, 256, [
      { fov: 60 },
      { fov: 100 },
      { position: [3, -1, 0], fov: 30 },
    ]);

    for (const { mean, worst } of differences) {
      expect(mean, 'average difference').to.be.below(1);
      expect(worst, 'worst difference').to.be.at.most(10);
    }
  });

  it('draws a photo the same as one texture', async () => {
    const differences = await compareWithOneTexture({ src: '/examples/calf-left-right.jpg' }, 512, [
      { fov: 60 },
      { position: [2, 1, 0], fov: 20 },
      { fov: 60, eye: 2 },
    ]);

    for (const { mean, worst } of differences) {
      expect(mean, 'average difference').to.be.below(1);
      expect(worst, 'worst difference').to.be.at.most(10);
    }
  });

  it('cuts a picture that surrounds the viewer', async () => {
    const attributes = { src: await makePicture(soft, 1024, 1024), type: 'left-right', angle: '180' };

    const differences = await compareWithOneTexture(attributes, 256, [
      { target: [0, 0, -1], fov: 70 },
      { target: [1, 0.5, -1], fov: 70 },
      { target: [-1, -1, -0.5], fov: 40 },
      { target: [0, 1, -0.1], fov: 70 },
    ]);

    expect(tiles().every(tile => tile.width <= 256 && tile.height <= 256)).to.equal(true);
    for (const { mean, worst } of differences) {
      expect(mean, 'average difference').to.be.below(1);
      expect(worst, 'worst difference').to.be.at.most(10);
    }
  });

  it('cuts a fisheye picture, and leaves out what is around the disc', async () => {
    const disc = (ctx, width, height) => {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, height);
      ctx.beginPath();
      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, 2 * Math.PI);
      ctx.clip();
      soft(ctx, width, height);
    };
    const attributes = { src: await makePicture(disc, 1024, 1024), type: 'left-right', angle: '180', projection: 'fisheye' };

    // views inside the disc: its edge is the only sharp line of the picture
    const differences = await compareWithOneTexture(attributes, 256, [
      { target: [0, 0, -1], fov: 70 },
      { target: [0.5, 0.3, -1], fov: 50 },
      { target: [-0.5, -0.5, -1], fov: 40 },
    ]);

    for (const { mean, worst } of differences) {
      expect(mean, 'average difference').to.be.below(1);
      expect(worst, 'worst difference').to.be.at.most(10);
    }
    // no tile for the corners of the picture, where nothing is shown
    const parts = tiles();
    const hasCorner = parts.some(tile => tile.x === 0 && tile.y === 0);
    expect(hasCorner, 'a tile for the top left corner').to.equal(false);
  });

  it('keeps the relief of a picture with a depth map', async () => {
    const differences = await compareWithOneTexture({ src: '/examples/Pixel7Pro.PORTRAIT.jpg' }, 1024, [
      { fov: 60 },
      // from the side, where the relief shows
      { position: [4, 3, 0], target: [-0.3, -0.2, -1], fov: 60 },
      { position: [-4, -3, 0], target: [0.3, 0.2, -1], fov: 60, eye: 2 },
    ]);

    expect(element.stereoData.depth, 'depth map').to.exist;
    for (const { mean, worst } of differences) {
      expect(mean, 'average difference').to.be.below(1);
      expect(worst, 'worst difference').to.be.at.most(60);
    }
  });

  it('does not keep a second copy of the pixels of the picture', async () => {
    await display({ src: await makePicture(shapes, 1024, 512), type: 'left-right' }, 256);

    for (const mesh of [...meshes(1), ...meshes(2)]) {
      // a boolean: reporting a failure must not print the pixels
      expect(mesh.material.map.image === null, 'the pixels of a tile are let go').to.equal(true);
    }
    // and still draws it
    const pixels = render({ fov: 60 });
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      colored += pixels[i] + pixels[i + 1] + pixels[i + 2] > 120 ? 1 : 0;
    }
    expect(colored / (pixels.length / 4), 'share of the element that shows the picture').to.be.greaterThan(0.9);
  });

  it('fills the element, slides and takes the colours of its edges like any other picture', async () => {
    await display({ src: await makePicture(shapes, 1024, 512), type: 'left-right' });
    const colors = element.surroundingsColors;
    const fov = element.camera.fov;

    await display({ src: await makePicture(shapes, 1024, 512), type: 'left-right' }, 256);

    expect(element.controls.mode).to.equal('pan');
    expect(element.camera.fov).to.be.closeTo(fov, 0.01);
    expect(element.surroundingsColors).to.deep.equal(colors);
    // the view stops at the edges of the picture
    expect(element.controls.isAllowed(0, 0, element.camera.fov)).to.equal(true);
    expect(element.controls.isAllowed(5, 0, element.camera.fov)).to.equal(false);
  });

  it('moves every tile with the disparity adjustment', async () => {
    await display({ src: await makePicture(shapes, 1024, 512), type: 'left-right', 'disparity-adjustment': '-4' }, 256);

    // the left picture moves to the right by 2% of its width of 20, the right picture to the left
    for (const mesh of meshes(1)) {
      expect(mesh.position.x).to.be.closeTo(0.4, 1e-9);
    }
    for (const mesh of meshes(2)) {
      expect(mesh.position.x).to.be.closeTo(-0.4, 1e-9);
    }
  });

  it('frees the tiles when the picture changes', async () => {
    const small = await makePicture(shapes, 128, 64);
    await display({ src: small, type: 'left-right' }, 256);
    render();
    const { textures, geometries } = element.renderer.info.memory;

    const before = element.stereoData;
    element.setAttribute('src', await makePicture(shapes, 1024, 512));
    await waitFor(() => element.stereoData !== before && !element.loadingIndicator.visible, 'the large picture');
    element.renderer.setAnimationLoop(null);
    render();
    expect(element.renderer.info.memory.textures).to.be.greaterThan(textures + 16);

    const large = element.stereoData;
    element.setAttribute('src', small);
    await waitFor(() => element.stereoData !== large && !element.loadingIndicator.visible, 'the small picture');
    element.renderer.setAnimationLoop(null);
    render();

    expect(meshes().length).to.equal(1);
    expect(element.renderer.info.memory.textures).to.equal(textures);
    expect(element.renderer.info.memory.geometries).to.equal(geometries);
  });

  it('draws the tiles again after the browser took the GPU away and gave it back', async () => {
    await display({ src: await makePicture(shapes, 1024, 512), type: 'left-right' }, 256);
    const before = render({ fov: 60 });
    const group = element.stereoImageGroup;
    const count = meshes(1).length + meshes(2).length;
    const canvas = element.renderer.domElement;

    // three.js tells about the loss on the console
    const original = console.log;
    console.log = () => {};
    try {
      let lost = false;
      let restored = false;
      canvas.addEventListener('webglcontextlost', () => { lost = true; }, { once: true });
      canvas.addEventListener('webglcontextrestored', () => { restored = true; }, { once: true });
      element.renderer.forceContextLoss();
      await waitFor(() => lost, 'the loss of the GPU');
      // the browser only gives the GPU back once it is done telling about the loss
      await new Promise(resolve => setTimeout(resolve, 50));
      element.renderer.forceContextRestore();
      await waitFor(() => restored, 'the GPU to come back');
      await waitFor(() => element.stereoImageGroup !== group && meshes(1).length + meshes(2).length === count, 'the tiles');
      await element._displaying;
    } finally {
      console.log = original;
    }
    element.renderer.setPixelRatio(1);
    element.renderer.setSize(WIDTH, HEIGHT);
    element.renderer.setAnimationLoop(null);

    const { mean } = difference(before, render({ fov: 60 }));
    expect(mean, 'average difference with the drawing before').to.be.below(0.5);
  });

  it('reduces a picture that cannot be cut, as before', async () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      // on a sphere, the triangles of the picture are larger than textures of 8 pixels
      await display({ src: await makePicture(shapes, 1024, 1024), type: 'left-right', angle: '180' }, 8);
    } finally {
      console.warn = original;
    }

    expect(meshes(1).length).to.equal(1);
    expect(meshes()[0].material.map.image.width).to.equal(8);
    expect(warnings.some(warning => warning.includes('exceeds max texture size'))).to.equal(true);
  });
});
