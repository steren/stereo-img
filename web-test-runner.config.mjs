import { fromRollup } from '@web/dev-server-rollup';
import resolve from '@rollup/plugin-node-resolve';

export default {
  files: 'tests/integration/**/*.integration.js',
  plugins: [fromRollup(resolve)()],
};
