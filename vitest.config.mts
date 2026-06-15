import { defineConfig } from "vitest/config";
import * as path from "path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig({
	plugins: [svelte(), svelteTesting()],
	// Mirror the esbuild build-time defines so code that reads these constants
	// (e.g. the settings tab's dev-only group) runs under vitest without a
	// ReferenceError. Tests run as a non-dev build.
	define: {
		__IS_DEV_BUILD__: "false",
		__DEV_GIT_BRANCH__: "null",
		__DEV_GIT_COMMIT__: "null",
		__DEV_GIT_DIRTY__: "false",
	},
	resolve: {
		alias: {
			src: path.resolve("./src"),
			obsidian: path.resolve("./tests/obsidian-stub.ts"),
		},
	},
	test: {
		include: [
			"src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
			"tests/*.{test,spec}.{ts,tsx}",
			"tests/!(e2e|packages)/**/*.{test,spec}.{ts,tsx}",
		],
		globals: true,
		environment: "jsdom",
		setupFiles: ["./tests/vitest-setup.ts"],
		deps: {
			optimizer: {
				web: {
					include: ["obsidian"],
				},
			},
		},
		coverage: {
			provider: "v8",
			all: true,
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
			reporter: ["text-summary", "json-summary"],
		},
	},
});
