import base from './vite.config.ts';

// Same setup as the test suite, but only the benchmark files (mergeConfig would concatenate `include`).
export default { ...base, test: { ...base.test, include: ['tests/bench/**/*.bench.test.ts'] } };
