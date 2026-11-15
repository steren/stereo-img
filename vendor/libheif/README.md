`libheif-bundle.mjs` is `libheif-wasm/libheif-bundle.mjs` of [libheif-js](https://github.com/catdad-experiments/libheif-js) 1.19.8 (npm package `libheif-js@1.19.8`), an Emscripten build of [libheif](https://github.com/strukturag/libheif) with its WebAssembly binary inlined.

libheif is licensed under the GNU Lesser General Public License v3 (see `LICENSE`). Its source code is available at https://github.com/strukturag/libheif. This file is unmodified and only loaded by `stereo-img` to decode HEIC pictures: it can be replaced by another build of libheif-js.
