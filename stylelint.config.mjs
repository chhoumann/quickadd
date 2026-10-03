// The CSS checks of Obsidian's community plugin review, as errors. The review's
// own config is SCANNER_STYLELINT_CONFIG in obsidianmd/obsidian-workflows
// (src/lint.ts); these are its rules that QuickAdd's code has to keep passing.
// A kept exception needs a stylelint-disable comment that says why. The review
// ignores those comments and still lists the line.
export default {
	plugins: ["stylelint-no-unsupported-browser-features"],
	reportDescriptionlessDisables: true,
	reportNeedlessDisables: true,
	rules: {
		"declaration-no-important": [
			true,
			{
				message:
					"Avoid !important: override with a more specific selector or a CSS variable.",
			},
		],
		"selector-pseudo-class-disallowed-list": [
			["has"],
			{
				message:
					"Avoid :has(): a change anywhere in the subject's subtree can make the browser check it again. Use a class or a plain combinator.",
			},
		],
		// The review targets the Electron of the oldest Obsidian the manifest
		// allows: minAppVersion 1.13.0 maps to Electron 39.
		"plugin/no-unsupported-browser-features": [
			true,
			{
				browsers: ["electron >= 39"],
				ignore: ["css-nesting", "css-cascade-layers"],
			},
		],
	},
};
