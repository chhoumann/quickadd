import { defineConfig } from "vitest/config";
// import { svelte } from "@sveltejs/vite-plugin-svelte";
// import sveltePreprocess from "svelte-preprocess";
import * as path from "path";

export default defineConfig({
	plugins: [
		// svelte({
		// 	hot: !process.env.VITEST,
		// 	preprocess: sveltePreprocess(),
		// }),
	],
	resolve: {
		alias: {
			src: path.resolve("./src"),
			obsidian: path.resolve("./tests/obsidian-stub.ts"),
			"@src": path.resolve("./src"),
			"@engine": path.resolve("./src/engine"),
			"@template": path.resolve("./src/template-engine"),
		},
	},
	test: {
		include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		globals: true,
		environment: "jsdom",
		deps: {
			inline: ["obsidian"],
		},
	},
});
