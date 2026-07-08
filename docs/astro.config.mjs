// @ts-check
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import remarkHeadingId from "./plugins/remark-heading-id.mjs";

/**
 * Every docs page must pin its URL with `slug:` frontmatter - without it,
 * Astro lowercases the generated slug and the page's historical MixedCase
 * URL silently changes. Fail the build instead.
 * @returns {import("astro").AstroIntegration}
 */
function enforceExplicitSlugs() {
	return {
		name: "quickadd:enforce-explicit-slugs",
		hooks: {
			"astro:config:setup": () => {
				const root = fileURLToPath(new URL("./src/content/docs/", import.meta.url));
				const missing = globSync("**/*.md", { cwd: root }).filter(
					(file) =>
						!/^slug:/m.test(
							readFileSync(root + file, "utf8").split("\n---\n", 2)[0] ?? "",
						),
				);
				if (missing.length > 0) {
					throw new Error(
						`Docs pages missing explicit "slug:" frontmatter (URLs would silently change): ${missing.join(", ")}`,
					);
				}
			},
		},
	};
}

// https://astro.build/config
export default defineConfig({
	site: "https://quickadd.obsidian.guide",
	// Cloudflare Pages is configured to publish docs/build (Docusaurus's old
	// output dir), so keep emitting there.
	outDir: "./build",
	markdown: {
		remarkPlugins: [remarkHeadingId],
	},
	image: {
		// Some screen-recording GIFs exceed sharp's default pixel safety limit
		// (frames x width x height). All images here are repo-authored.
		service: {
			entrypoint: "astro/assets/services/sharp",
			config: { limitInputPixels: false },
		},
	},
	integrations: [
		enforceExplicitSlugs(),
		starlight({
			title: "QuickAdd",
			logo: {
				src: "./public/img/quickadd-icon.png",
				alt: "QuickAdd",
			},
			favicon: "/img/favicon.ico",
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/chhoumann/quickadd",
				},
			],
			editLink: {
				baseUrl: "https://github.com/chhoumann/quickadd/edit/master/docs/",
			},
			customCss: ["./src/styles/custom.css"],
			head: [
				{
					tag: "meta",
					attrs: {
						property: "og:image",
						content: "https://quickadd.obsidian.guide/img/quickadd-logo.png",
					},
				},
				{
					tag: "meta",
					attrs: { name: "twitter:card", content: "summary_large_image" },
				},
			],
			sidebar: [
				{ label: "Getting Started", slug: "docs" },
				{ label: "Coming from Templater", slug: "docs/ComingFromTemplater" },
				{ label: "Settings", slug: "docs/Settings" },
				{
					label: "Core Concepts",
					items: [
						{ label: "Template Choices", slug: "docs/Choices/TemplateChoice" },
						{ label: "Capture Choices", slug: "docs/Choices/CaptureChoice" },
						{ label: "Macro Choices", slug: "docs/Choices/MacroChoice" },
						{ label: "Multi Choices", slug: "docs/Choices/MultiChoice" },
						{ label: "Share QuickAdd Packages", slug: "docs/Choices/Packages" },
					],
				},
				{
					label: "Features",
					collapsed: true,
					items: [
						{ label: "Format Syntax", slug: "docs/FormatSyntax" },
						{ label: "Variables and data flow", slug: "docs/VariablesDataFlow" },
						{ label: "Controlling Prompts", slug: "docs/ControllingPrompts" },
						{ label: "Apply Template to Note", slug: "docs/ApplyTemplateToNote" },
						{ label: "Global Variables", slug: "docs/GlobalVariables" },
						{ label: "Suggester System", slug: "docs/SuggesterSystem" },
						{ label: "Inline Scripts", slug: "docs/InlineScripts" },
						{ label: "AI Assistant Reference", slug: "docs/AIAssistant" },
						{
							label: "Template Property Types (Beta)",
							slug: "docs/TemplatePropertyTypes",
						},
					],
				},
				{
					label: "Examples",
					collapsed: true,
					items: [
						{ label: "Examples Overview", slug: "docs/Examples" },
						{
							label: "Capture Examples",
							items: [
								"docs/Examples/Capture_AddJournalEntry",
								"docs/Examples/Capture_ToDailyNote",
								"docs/Examples/Capture_AddTaskToKanbanBoard",
								"docs/Examples/Capture_FetchTasksFromTodoist",
								"docs/Examples/Capture_InsertBaseTemplateIntoActiveFile",
								"docs/Examples/Capture_CanvasCapture",
							],
						},
						{
							label: "Template Examples",
							items: [
								"docs/Examples/Template_AddAnInboxItem",
								"docs/Examples/Template_CreateMOCNoteWithLinkDashboard",
								"docs/Examples/Template_AutomaticBookNotesFromReadwise",
							],
						},
						{
							label: "Macro Examples",
							items: [
								"docs/Examples/Macro_BookFinder",
								"docs/Examples/Macro_MovieAndSeriesScript",
								"docs/Examples/Macro_LogBookToDailyJournal",
								"docs/Examples/Macro_ChangePropertyInDailyNotes",
								"docs/Examples/Macro_MoveNotesWithATagToAFolder",
								"docs/Examples/Macro_Zettelizer",
								"docs/Examples/Macro_AddLocationLongLatFromAddress",
								"docs/Examples/Macro_TogglManager",
								"docs/Examples/Macro_MigrateDataviewProperties",
							],
						},
					],
				},
				{
					label: "Advanced",
					collapsed: true,
					items: [
						{ label: "API Overview", slug: "docs/Advanced/APIOverview" },
						{ label: "QuickAdd API Reference", slug: "docs/QuickAddAPI" },
						{ label: "Scripting Overview", slug: "docs/Advanced/ScriptingGuide" },
						{ label: "User Scripts Reference", slug: "docs/UserScripts" },
						{
							label: "Scripts with Settings",
							slug: "docs/Advanced/scriptsWithSettings",
						},
						{ label: "One-page Inputs", slug: "docs/Advanced/onePageInputs" },
						{ label: "Obsidian URI", slug: "docs/Advanced/ObsidianUri" },
						{ label: "QuickAdd CLI", slug: "docs/Advanced/CLI" },
						{
							label: "Trigger QuickAdd from outside Obsidian",
							slug: "docs/Advanced/TriggerQuickAddFromOutsideObsidian",
						},
					],
				},
				{
					label: "Other",
					collapsed: true,
					items: [
						{ label: "FAQ", slug: "docs/FAQ" },
						{ label: "Manual Installation", slug: "docs/ManualInstallation" },
						{
							label: "Open QuickAdd from your desktop (AHK)",
							slug: "docs/Misc/AHK_OpenQuickAddFromDesktop",
						},
					],
				},
			],
		}),
	],
});
