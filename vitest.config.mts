import { defineConfig } from "vitest/config";
import * as path from "path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig({
	plugins: [svelte(), svelteTesting()],
	resolve: {
		alias: {
			src: path.resolve("./src"),
			obsidian: path.resolve("./tests/obsidian-stub.ts"),
		},
	},
	test: {
		include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
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
