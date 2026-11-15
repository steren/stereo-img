import { fromRollup } from '@web/dev-server-rollup';
import { puppeteerLauncher } from '@web/test-runner-puppeteer';
import resolve from '@rollup/plugin-node-resolve';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';
import { existsSync } from 'node:fs';

// Use the Chrome installed on this machine when there is one, instead of the one Puppeteer downloads.
const SYSTEM_CHROME = '/usr/bin/google-chrome-stable';
const executablePath = existsSync(SYSTEM_CHROME) ? SYSTEM_CHROME : undefined;

/**
 * A second server, on another port, to test pictures coming from another origin.
 * It serves the pictures of the examples folder, and nothing else, under two paths:
 * - /cors/examples/... allows other origins to read the file
 * - /no-cors/examples/... does not
 * It only listens on this machine.
 */
const OTHER_ORIGIN_PORT = 8643;
const POLICIES = new Set(['cors', 'no-cors']);
const EXAMPLES = fileURLToPath(new URL('./examples/', import.meta.url));

/** The path on disk of the example a request asks for, or undefined when it asks for anything else. */
async function exampleFile(url) {
  const [, policy, folder, ...rest] = new URL(url, 'http://localhost').pathname.split('/');
  if (!POLICIES.has(policy) || folder !== 'examples' || rest.length === 0) {
    return undefined;
  }
  const names = rest.map(decodeURIComponent);
  if (names.some(name => name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0'))) {
    return undefined;
  }
  const root = await realpath(EXAMPLES);
  // Resolve symbolic links too, so that a link in the examples folder cannot point outside of it.
  const file = await realpath(join(root, ...names));
  return file.startsWith(root + sep) ? { file, policy } : undefined;
}

let otherOrigin;
const otherOriginServer = {
  name: 'other-origin-server',
  serverStart() {
    otherOrigin = createServer(async (request, response) => {
      try {
        const found = await exampleFile(request.url);
        if (!found) {
          throw new Error('Not an example');
        }
        const file = await readFile(found.file);
        const headers = { 'content-type': 'image/jpeg' };
        if (found.policy === 'cors') {
          headers['access-control-allow-origin'] = '*';
        }
        response.writeHead(200, headers);
        response.end(file);
      } catch (error) {
        response.writeHead(404);
        response.end();
      }
    }).listen(OTHER_ORIGIN_PORT, 'localhost');
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
  browsers: [puppeteerLauncher({ launchOptions: { executablePath, args: ['--enable-unsafe-swiftshader'] } })],
  plugins: [fromRollup(resolve)(), otherOriginServer],
};
