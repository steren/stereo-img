import { fromRollup } from '@web/dev-server-rollup';
import { puppeteerLauncher } from '@web/test-runner-puppeteer';
import resolve from '@rollup/plugin-node-resolve';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

/**
 * A second server, on another port, to test pictures coming from another origin.
 * It serves the files of the repository under two paths:
 * - /cors/... allows other origins to read the file
 * - /no-cors/... does not
 */
const OTHER_ORIGIN_PORT = 8643;
let otherOrigin;
const otherOriginServer = {
  name: 'other-origin-server',
  serverStart() {
    otherOrigin = createServer(async (request, response) => {
      const [, policy, ...path] = new URL(request.url, 'http://localhost').pathname.split('/');
      try {
        const file = await readFile(new URL(path.join('/'), import.meta.url));
        const headers = { 'content-type': 'image/jpeg' };
        if (policy === 'cors') {
          headers['access-control-allow-origin'] = '*';
        }
        response.writeHead(200, headers);
        response.end(file);
      } catch (error) {
        response.writeHead(404);
        response.end();
      }
    }).listen(OTHER_ORIGIN_PORT);
  },
  serverStop() {
    otherOrigin?.close();
  },
};

export default {
  files: 'tests/integration/**/*.integration.js',
  // Run one test file at a time: a browser only draws frames for the page it
  // displays, and some tests wait for frames to be drawn.
  concurrency: 1,
  // Where there is no GPU, as on the machines that run the tests of pull requests, Chrome draws WebGL in software.
  // It used to do so by itself, which it now calls deprecated: after a hundred seconds of tests or so, that way stops
  // answering and every test file that follows times out. Asking for software WebGL avoids it.
  // The flag only allows drawing in software: a machine with a GPU still uses it.
  browsers: [puppeteerLauncher({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } })],
  plugins: [fromRollup(resolve)(), otherOriginServer],
};
