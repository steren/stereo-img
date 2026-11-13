import { fromRollup } from '@web/dev-server-rollup';
import resolve from '@rollup/plugin-node-resolve';

export default {
  files: 'tests/integration/**/*.integration.js',
  // Run one test file at a time: a browser only draws frames for the page it
  // displays, and some tests wait for frames to be drawn.
  concurrency: 1,
  plugins: [fromRollup(resolve)()],
};
