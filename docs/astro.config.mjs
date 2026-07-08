// @ts-check
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLlmsTxt from "starlight-llms-txt";
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
			plugins: [
				starlightLlmsTxt({
					projectName: "QuickAdd",
					description:
						"QuickAdd is an Obsidian plugin for one-hotkey templates, captures, macros, and AI-assisted workflows.",
					details:
						"These docs cover choice types (Template, Capture, Macro, Multi), the {{TOKEN}} format syntax, the JavaScript scripting API, and worked examples.",
					optionalLinks: [
						{
							label: "GitHub repository",
							url: "https://github.com/chhoumann/quickadd",
							description: "Source code, issues, and discussions",
						},
					],
				}),
			],
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
			components: {
				PageTitle: "./src/components/PageTitle.astro",
			},
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
							// Group header already says the type, so labels drop
							// the historical "Capture:"/"Macro:" title prefixes.
							items: [
								{ label: "Add entries to your daily note", slug: "docs/Examples/Capture_ToDailyNote" },
								{ label: "Add a task to a Kanban board", slug: "docs/Examples/Capture_AddTaskToKanbanBoard" },
								{ label: "Fetch tasks from Todoist", slug: "docs/Examples/Capture_FetchTasksFromTodoist" },
								{ label: "Insert a Base into an MOC note", slug: "docs/Examples/Capture_InsertBaseTemplateIntoActiveFile" },
								{ label: "Capture to Canvas cards", slug: "docs/Examples/Capture_CanvasCapture" },
							],
						},
						{
							label: "Template Examples",
							items: [
								{ label: "Add an inbox item", slug: "docs/Examples/Template_AddAnInboxItem" },
								{ label: "Create an MOC note with a link dashboard", slug: "docs/Examples/Template_CreateMOCNoteWithLinkDashboard" },
								{ label: "Automatic book notes from Readwise", slug: "docs/Examples/Template_AutomaticBookNotesFromReadwise" },
							],
						},
						{
							label: "Macro Examples",
							items: [
								{ label: "Book finder", slug: "docs/Examples/Macro_BookFinder" },
								{ label: "Movie & series notes", slug: "docs/Examples/Macro_MovieAndSeriesScript" },
								{ label: "Log a book to your daily journal", slug: "docs/Examples/Macro_LogBookToDailyJournal" },
								{ label: "Change properties in daily notes", slug: "docs/Examples/Macro_ChangePropertyInDailyNotes" },
								{ label: "Move notes with a tag to a folder", slug: "docs/Examples/Macro_MoveNotesWithATagToAFolder" },
								{ label: "Zettelizer", slug: "docs/Examples/Macro_Zettelizer" },
								{ label: "Add location from an address", slug: "docs/Examples/Macro_AddLocationLongLatFromAddress" },
								{ label: "Toggl manager", slug: "docs/Examples/Macro_TogglManager" },
								{ label: "Migrate Dataview properties", slug: "docs/Examples/Macro_MigrateDataviewProperties" },
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
