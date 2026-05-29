import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
	plugins: [],
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
		deps: {
			optimizer: {
				web: {
					include: ["obsidian"],
				},
			},
		},
	},
});
