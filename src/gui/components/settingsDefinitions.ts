import type { Setting, SettingDefinitionGroup } from "obsidian";
import type { QuickAddSettings } from "../../settings";
import { createDocsLink, DOCS_URLS, openDocsUrl } from "../../docs";

export type SettingsKey = Extract<keyof QuickAddSettings, string>;
export const PACKAGES_DESC =
	"Bundle or import QuickAdd automations as reusable packages.";

type SettingsRenderers = Record<
	| "choices"
	| "packages"
	| "dateAliases"
	| "templateFolders"
	| "globalVariables"
	| "developmentInfo",
	(setting: Setting) => void | (() => void)
>;

export function createSettingDefinitions(
	render: SettingsRenderers,
	isDevBuild: boolean,
): SettingDefinitionGroup<SettingsKey>[] {
	const groups: SettingDefinitionGroup<SettingsKey>[] = [
		{
			type: "group",
			heading: "Choices & packages",
			// QuickAdd's power surface is syntax you have to learn ({{VALUE}},
			// {{DATE}}, capture targets, ...) and until now the manual was reachable
			// from exactly one place in the whole plugin (issue #1541). A help icon
			// on the first heading is Obsidian's own idiom for this, and it costs the
			// page no vertical space, so the choices list stays the focus.
			extraButtons: [
				(button) =>
					button
						.setIcon("help-circle")
						.setTooltip("QuickAdd documentation")
						.onClick(() =>
							openDocsUrl(DOCS_URLS.gettingStarted, button.extraSettingsEl),
						),
			],
			items: [
				{
					name: "Choices",
					render: render.choices,
				},
				{
					name: "Packages",
					desc: PACKAGES_DESC,
					render: render.packages,
				},
			],
		},
		{
			type: "group",
			heading: "Choice picker",
			items: [
				{
					name: "Search nested choices",
					// "Multi" is the internal type id; every other user-facing string
					// says folder (see src/utils/choiceNoun.ts), and this was the one
					// place in the whole settings surface that leaked it.
					desc: "When searching in the choice picker, also match choices nested inside folders and show their path. Note that nested matches can outrank same-level ones. Disable to search only the open level.",
					control: { type: "toggle", key: "searchNestedChoices" },
				},
				{
					name: "“New note from template” in the launcher",
					desc: "Add a row to Run QuickAdd that lists templates from your configured template folder, so you can create a note from a template without a dedicated Template choice. Only appears when a template folder is configured; the command palette entry works regardless.",
					control: {
						type: "dropdown",
						key: "templateFolderLauncherRow",
						defaultValue: "bottom",
						options: {
							bottom: "Show at the bottom (keeps your top choice first)",
							top: "Show at the top",
							off: "Hide",
						},
					},
				},
			],
		},
		{
			type: "group",
			heading: "Input",
			items: [
				{
					name: "Use multi-line input prompt",
					desc: "Use multi-line input prompt instead of single-line input prompt. Submit multi-line prompts with Ctrl/Cmd+Enter; Enter inserts a newline.",
					control: { type: "toggle", key: "inputPrompt" },
				},
				{
					name: "Persist input prompt drafts",
					desc: "Keep drafts when closing input prompts so they can be restored on reopen. Drafts are stored only for this session.",
					control: { type: "toggle", key: "persistInputPromptDrafts" },
				},
				{
					name: "Use editor selection as default Capture value",
					desc: "When enabled, Capture uses the current editor selection as {{VALUE}} and may skip the prompt. When disabled, Capture always prompts for {{VALUE}}.",
					control: { type: "toggle", key: "useSelectionAsCaptureValue" },
				},
				{
					name: "Name pasted images after the note title",
					desc: "When on, clipboard images saved by QuickAdd (pasting into a prompt, or {{CLIPBOARD}} with an image and no text) are named after the destination note. When the destination is not yet known, QuickAdd keeps the timestamp name. Duplicate names are handled by Obsidian's attachment folder setting.",
					control: { type: "toggle", key: "namePastedImagesAfterNoteTitle" },
				},
				{
					name: "One-page input for choices",
					// The trailing sentence used to read "See One-page Inputs in the
					// docs." as plain, unlinked prose (issue #1541).
					desc: descWithDocsLink(
						"Collect a choice's inputs in one form before it runs, instead of one prompt at a time. Works with Template and Capture choices, and with Macros whose scripts declare inputs. Template and Capture choices can override this individually. ",
						DOCS_URLS.onePageInputs,
						"Learn more about one-page inputs",
					),
					control: { type: "toggle", key: "onePageInputEnabled" },
				},
				{
					name: "Date aliases",
					desc:
						"Shortcodes for natural language date parsing. " +
						"One per line: alias = phrase. Example: tm = tomorrow.",
					render: render.dateAliases,
				},
			],
		},
		{
			type: "group",
			heading: "Templates & properties",
			items: [
				{
					name: "Template folder paths",
					desc: "Folders where templates are stored. Used to suggest template files when configuring QuickAdd. Add as many as you like; leave empty to suggest every template file in the vault.",
					render: render.templateFolders,
				},
				{
					name: "Convert string front matter variables to typed properties (Beta)",
					desc:
						"List/object values from scripts are always written as proper Obsidian properties (a list becomes a List). " +
						"This toggle additionally converts string values into typed properties: a comma or bullet-list string becomes a List, " +
						"\"42\" becomes a Number, \"true\" becomes a Checkbox, etc. Disabled by default; the string conversion is a beta heuristic that may have edge cases.",
					control: { type: "toggle", key: "enableTemplatePropertyTypes" },
				},
			],
		},
		{
			type: "group",
			heading: "Notifications",
			items: [
				{
					name: "Announce updates",
					desc: "Display release notes when a new version is installed. This includes new features, demo videos, and bug fixes.",
					control: {
						type: "dropdown",
						key: "announceUpdates",
						defaultValue: "major",
						options: {
							all: "Show updates on each new release",
							major:
								"Show updates only on major releases (new features, breaking changes)",
							none: "Don't show",
						},
					},
				},
				{
					name: "Show capture notifications",
					desc: "Display a notification when content is captured successfully to confirm the operation completed.",
					control: { type: "toggle", key: "showCaptureNotification" },
				},
				{
					name: "Show input cancellation notifications",
					desc: "Display a notification when an input prompt is cancelled without submitting. Disable this to avoid extra notices when dismissing prompts.",
					control: {
						type: "toggle",
						key: "showInputCancellationNotification",
					},
				},
			],
		},
		{
			type: "group",
			heading: "Global variables",
			items: [
				{
					name: "Global variables",
					render: render.globalVariables,
				},
			],
		},
		{
			type: "group",
			heading: "AI & online",
			items: [
				{
					name: "Disable AI & online features",
					desc: "This prevents the plugin from making requests to external providers like OpenAI. You can still use user scripts to execute arbitrary code, including contacting external providers. However, this setting disables plugin features like the AI Assistant from doing so. You need to disable this setting to use the AI Assistant.",
					control: { type: "toggle", key: "disableOnlineFeatures" },
				},
				{
					name: "Allow URI x-callback-url",
					desc: "When on, an obsidian://quickadd URI may open a callback URL (x-success / x-error / x-cancel) after a Template or Capture choice finishes — sending the outcome and the affected note's vault path and URL to that callback. While on, a URI that carries x-* callback params is restricted to Template and Capture choices (other choice types are warned and skipped). Off by default because the callback URL is set by whoever creates the obsidian:// link. Only shortcuts: and obsidian: callback URLs are permitted.",
					control: { type: "toggle", key: "enableUriCallbacks" },
				},
			],
		},
		{
			type: "group",
			heading: "Appearance",
			items: [
				{
					name: "Show icon in sidebar",
					desc: "Add QuickAdd icon to the sidebar ribbon. Requires a reload.",
					control: { type: "toggle", key: "enableRibbonIcon" },
				},
			],
		},
	];
	if (isDevBuild) {
		groups.push({
			type: "group",
			heading: "Developer",
			items: [
				{
					name: "Development information",
					desc: "Git information for developers.",
					render: render.developmentInfo,
				},
			],
		});
	}
	return groups;
}

/** Create a fresh fragment for each native setting render. */
export function descWithDocsLink(
	text: string,
	url: string,
	linkText = "Learn more",
): DocumentFragment {
	const fragment = createFragment();
	fragment.append(document.createTextNode(text));
	createDocsLink(fragment, url, linkText);
	return fragment;
}
