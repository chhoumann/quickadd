import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
	// Specs import plugin modules, and some of those use the `src/` path alias.
	resolve: {
		alias: {
			src: path.resolve("./src"),
		},
	},
	test: {
		include: ["tests/e2e/**/*.test.ts"],
		setupFiles: ["tests/e2e/setup.ts"],
		testTimeout: 60_000,
		hookTimeout: 30_000,
		fileParallelism: false,
		maxWorkers: 1,
	},
});
