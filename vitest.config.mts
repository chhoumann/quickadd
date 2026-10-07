import { defineConfig } from "vitest/config";
import * as path from "path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import type { Plugin } from "vite";

// Node tests compile Svelte for the server, where $state is a plain object, not
// a proxy. Fail loudly instead of letting a test check server semantics.
const svelteNeedsJsdom: Plugin = {
	name: "svelte-needs-jsdom",
	enforce: "pre",
	transform(_code, id) {
		if (this.environment.name !== "client" && /\.svelte(\.[jt]s)?$/.test(id.split("?")[0])) {
			this.error(`${id} is Svelte code; add \`// @vitest-environment jsdom\` to the test file that loads it.`);
		}
	},
};

export default defineConfig({
	plugins: [svelteNeedsJsdom, svelte(), svelteTesting()],
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
		// Undo vi.stubGlobal before every test, so a stubbed navigator or
		// window property never leaks into the next test.
		unstubGlobals: true,
		// Files that need a DOM or Svelte code opt in with `// @vitest-environment jsdom`.
		// jsdom setup per file is the suite's largest cost, so it is not the default.
		setupFiles: ["./tests/vitest-setup.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
			reporter: ["text-summary", "json-summary"],
		},
	},
});
