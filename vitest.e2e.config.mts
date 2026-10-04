import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
	// Specs import plugin modules, and some of those use the `src/` path alias.
	// Those modules run in this Node process, not in Obsidian, so `obsidian`
	// resolves to the same stub the unit suite uses; the npm package has no
	// runtime entry.
	resolve: {
		alias: {
			src: path.resolve("./src"),
			obsidian: path.resolve("./tests/obsidian-stub.ts"),
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
