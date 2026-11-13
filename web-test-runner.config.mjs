import { fromRollup } from '@web/dev-server-rollup';
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
  plugins: [fromRollup(resolve)(), otherOriginServer],
};
