import path from "path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import autoPreprocess from "svelte-preprocess";
import builtins from "builtin-modules";

const productionBuild = process.argv[2] === "production";

export default defineConfig(() => {
	return {
		plugins: [
			svelte({
				preprocess: autoPreprocess(),
			}),
		],
		watch: !productionBuild,
		build: {
			sourcemap: productionBuild ? false : "inline",
			minify: productionBuild,
			commonjsOptions: {
				ignoreTryCatch: false,
			},
			lib: {
				entry: path.resolve(__dirname, "./src/main.ts"),
				formats: ["cjs"],
			},
			css: {},
			rollupOptions: {
				output: {
					entryFileNames: "main.js",
					assetFileNames: "styles.css",
				},
				external: [
					"obsidian",
					"electron",
					"codemirror",
					"@codemirror/autocomplete",
					"@codemirror/closebrackets",
					"@codemirror/collab",
					"@codemirror/commands",
					"@codemirror/comment",
					"@codemirror/fold",
					"@codemirror/gutter",
					"@codemirror/highlight",
					"@codemirror/history",
					"@codemirror/language",
					"@codemirror/lint",
					"@codemirror/matchbrackets",
					"@codemirror/panel",
					"@codemirror/rangeset",
					"@codemirror/rectangular-selection",
					"@codemirror/search",
					"@codemirror/state",
					"@codemirror/stream-parser",
					"@codemirror/text",
					"@codemirror/tooltip",
					"@codemirror/view",
					"@lezer/common",
					"@lezer/lr",
					"@lezer/highlight",
					...builtins,
				],
			},
			emptyOutDir: false,
			outDir: ".",
		},
	};
});
