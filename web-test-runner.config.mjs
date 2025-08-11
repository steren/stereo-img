import { fromRollup } from '@web/dev-server-rollup';
import resolve from '@rollup/plugin-node-resolve';

export default {
  files: 'test/integration/**/*.test.js',
  plugins: [fromRollup(resolve)()],
};
