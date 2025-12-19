import { describe, it, test } from 'vitest';

const runPerfTests =
	process.env.RUN_PERF_TESTS === '1' ||
	process.env.RUN_PERF_TESTS === 'true';

const describePerf = runPerfTests ? describe : describe.skip;
const itPerf = runPerfTests ? it : it.skip;
const testPerf = runPerfTests ? test : test.skip;

export { runPerfTests, describePerf, itPerf, testPerf };
