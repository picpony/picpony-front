import { resolve } from 'node:path';

const config = {
  plugins: {
    // Next's Lightning CSS pass owns browser targets and minification.
    "@tailwindcss/postcss": { optimize: false },
    [resolve('scripts/postcssChrome109.cjs')]: {},
  },
};

export default config;
