import { defineConfig } from "vitest/config";
// import { svelte } from "@sveltejs/vite-plugin-svelte";
// import sveltePreprocess from "svelte-preprocess";
import * as path from "path";

// Pin the timezone so date assertions (notably Jalali ISO round-trips) are
// deterministic across local machines and the UTC-based CI runners.
process.env.TZ = "UTC";

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
