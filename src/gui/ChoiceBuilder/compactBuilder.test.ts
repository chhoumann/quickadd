import { fireEvent, render } from "@testing-library/svelte";
import { App, Notice, TFile, type Vault } from "obsidian";
import { flushSync } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingNames } from "../../../tests/helpers/settings/fields";
import type QuickAdd from "../../main";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import { openFile } from "../../utils/fileOpening";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import CaptureChoiceForm from "./CaptureChoiceForm.svelte";
import { createChoiceFormProps } from "./choiceFormProps.svelte";
import { NEW_TEMPLATE_CONTENT } from "./newTemplate";
import TemplateChoiceForm from "./TemplateChoiceForm.svelte";

vi.mock("../GenericInputPrompt/GenericInputPrompt", () => ({ default: { Prompt: vi.fn() } }));
vi.mock("../../utils/fileOpening", () => ({ openFile: vi.fn(async () => ({})) }));

/** An app whose vault holds `files` (with `contents`), and records what is created. */
function appWith(files: string[] = [], contents: Record<string, string> = {}): App {
	const app = new App();
	const paths = new Map(files.map((path) => [path, Object.assign(new TFile(), { path })]));
	const folders = new Set<string>();
	app.vault = {
		...app.vault,
		getAbstractFileByPath: (path: string) => paths.get(path) ?? null,
		getFiles: () => [...paths.values()],
		cachedRead: async (file: TFile) => contents[file.path] ?? "",
		create: vi.fn(async (path: string) => {
			const file = Object.assign(new TFile(), { path });
			paths.set(path, file);
			return file;
		}),
		createFolder: vi.fn(async (path: string) => void folders.add(path)),
		adapter: { exists: async (path: string) => folders.has(path) },
	} as unknown as Vault;
	return app;
}

function pluginWith(app: App, templateFolderPaths: string[] = []): QuickAdd {
	return {
		settings: { choices: [], templateFolderPaths },
		getTemplateFiles: () =>
			(app.vault.getFiles() as TFile[]).filter((file) =>
				templateFolderPaths.length === 0 || templateFolderPaths.some((folder) => file.path.startsWith(`${folder}/`)),
			),
	} as unknown as QuickAdd;
}

function mount<C extends TemplateChoice | CaptureChoice>(choice: C, app = appWith(), plugin = pluginWith(app)) {
	const props = createChoiceFormProps({ choice, app, plugin });
	const form = choice.type === "Template" ? TemplateChoiceForm : CaptureChoiceForm;
	const result = render(form as typeof TemplateChoiceForm, { props: { choice: props.choice as TemplateChoice, app, plugin } });
	return { ...result, props, app };
}

/** The names of the builder's rows and sections, without each input's own row. */
const rowNames = (container: HTMLElement) =>
	[...container.querySelectorAll(".setting-item-name")].filter((el) => !el.closest(".qaInputRow")).map((el) => el.textContent?.trim());
const notices = (Notice as unknown as { instances: { message: string }[] }).instances;
const summary = (container: HTMLElement) => container.querySelector(".qaChoiceSummary")?.textContent?.trim();
const moreSettings = (container: HTMLElement) =>
	container.querySelector<HTMLButtonElement>('.qaMoreSettings button[aria-label="More settings"]');
const newTemplateButton = (container: HTMLElement) =>
	[...container.querySelectorAll("button")].find((button) => button.textContent === "New template…");

// Each test its own choice: More settings stays open for a choice for the session.
let n = 0;
const templateChoice = () => Object.assign(new TemplateChoice("Note"), { id: `t${++n}` });
const captureChoice = () => Object.assign(new CaptureChoice("Log"), { id: `c${++n}`, captureTo: "Inbox.md" });

beforeEach(() => {
	vi.mocked(GenericInputPrompt.Prompt).mockReset();
	vi.mocked(openFile).mockClear();
	notices.length = 0;
});

describe("the summary lede", () => {
	it("says what the choice does and follows the form", async () => {
		const { container } = mount(templateChoice());
		expect(summary(container)).toBe("Creates {title}");
		expect(container.querySelector(".qaChoiceSummary svg")).toHaveAttribute("data-icon", "file-text");

		const fileName = container.querySelector<HTMLInputElement>('input[placeholder="{{VALUE}}"]')!;
		await fireEvent.input(fileName, { target: { value: "{{DATE}} standup" } });
		flushSync();
		expect(summary(container)).toBe("Creates {date} standup");
	});

	it("follows a Capture's format", async () => {
		const { container } = mount(captureChoice());
		expect(summary(container)).toBe("Adds a line at the top of Inbox");

		await fireEvent.click(container.querySelector<HTMLElement>('[aria-label="Task"]')!);
		flushSync();
		expect(summary(container)).toBe("Adds a task at the top of Inbox");
	});
});

describe("the compact builder", () => {
	it("shows a new Template's essentials, with More settings closed", async () => {
		const { container } = mount(templateChoice());
		await vi.waitFor(() => expect(settingNames(container)).toContain("Inputs"));
		expect(rowNames(container)).toEqual(["Template", "Folder", "Note name", "Inputs", "Steps", "More settings"]);
		expect(moreSettings(container)).toHaveAttribute("aria-expanded", "false");

		await fireEvent.click(moreSettings(container)!);
		expect(settingNames(container)).toContain("New note location");
		expect(settingNames(container)).toContain("Open");
	});

	it("opens More settings when one of them is set", () => {
		const choice = Object.assign(templateChoice(), { appendLink: true });
		const { container } = mount(choice);
		expect(moreSettings(container)).toHaveAttribute("aria-expanded", "true");
		expect(settingNames(container)).toContain("Link to created note");
	});

	it("keeps More settings open for the choice once opened", async () => {
		const choice = templateChoice();
		const first = mount(choice);
		await fireEvent.click(moreSettings(first.container)!);
		first.unmount();

		expect(moreSettings(mount(choice).container)).toHaveAttribute("aria-expanded", "true");
	});

	it("shows a new Capture's essentials", async () => {
		const { container } = mount(captureChoice());
		await vi.waitFor(() => expect(settingNames(container)).toContain("Inputs"));
		expect(rowNames(container)).toEqual(["Capture to active note", "Where", "Position", "What", "Inputs", "Steps", "More settings"]);
		expect(moreSettings(container)).toHaveAttribute("aria-expanded", "false");
	});

	it("edits one folder in Folder, and leaves the other locations to More settings", async () => {
		const { container, props } = mount(templateChoice());
		const folder = container.querySelector<HTMLInputElement>('input[placeholder="Default location for new notes"]')!;
		await fireEvent.input(folder, { target: { value: "Meetings" } });
		expect(props.choice.folder).toMatchObject({ enabled: true, folders: ["Meetings"] });
		await fireEvent.input(folder, { target: { value: "" } });
		expect(props.choice.folder).toMatchObject({ enabled: false, folders: [] });

		props.choice.folder = { ...props.choice.folder, enabled: true, chooseWhenCreatingNote: true };
		flushSync();
		expect(settingNames(container)).not.toContain("Folder");
	});
});

describe("the Templater badge", () => {
	const files = { "Templates/Dinner.md": '# <% tp.system.prompt("Guest") %>\n', "Templates/Plain.md": "# {{VALUE:Title}}\n" };
	const badge = (container: HTMLElement) => container.querySelector(".qaTemplaterBadge");

	it("says Templater runs after the note is created, and the lede says it runs Templater", async () => {
		const app = appWith(Object.keys(files), files);
		app.plugins.plugins["templater-obsidian"] = {} as App["plugins"]["plugins"][string];
		const { container, props } = mount(Object.assign(templateChoice(), { templatePath: "Templates/Dinner.md" }), app);

		await vi.waitFor(() => expect(badge(container)?.textContent?.trim()).toBe("Templater runs after the note is created"));
		expect(badge(container)?.querySelector("svg")).toHaveAttribute("data-icon", "braces");
		expect(summary(container)).toBe("Creates {title} from Dinner, runs Templater");

		props.choice.templatePath = "Templates/Plain.md";
		await vi.waitFor(() => expect(badge(container)).toBeNull());
		expect(summary(container)).toBe("Creates {title} from Plain");
	});

	it("says the template uses Templater, which is not installed, and links to it", async () => {
		const app = appWith(Object.keys(files), files);
		const { container } = mount(Object.assign(templateChoice(), { templatePath: "Templates/Dinner.md" }), app);

		await vi.waitFor(() =>
			expect(badge(container)?.textContent?.replace(/\s+/g, " ").trim()).toBe("This template uses Templater, which is not installed"),
		);
		expect(badge(container)?.querySelector("a")).toHaveAttribute("href", "obsidian://show-plugin?id=templater-obsidian");
		// Templater will not run, so the lede does not say it does.
		expect(summary(container)).toBe("Creates {title} from Dinner");
	});
});

describe("New template…", () => {
	it("creates the template in the first template folder, uses it and opens it behind settings", async () => {
		const app = appWith();
		const { container, props } = mount(templateChoice(), app, pluginWith(app, ["Meta/Templates"]));
		vi.mocked(GenericInputPrompt.Prompt).mockResolvedValue("Meeting");

		await fireEvent.click(newTemplateButton(container)!);
		await vi.waitFor(() => expect(props.choice.templatePath).toBe("Meta/Templates/Meeting.md"));
		expect(app.vault.create).toHaveBeenCalledWith("Meta/Templates/Meeting.md", NEW_TEMPLATE_CONTENT);
		expect(NEW_TEMPLATE_CONTENT).toBe("# {{VALUE:Title}}\n\n");
		expect(app.vault.createFolder).toHaveBeenCalledWith("Meta");
		expect(openFile).toHaveBeenCalledWith(app, expect.objectContaining({ path: "Meta/Templates/Meeting.md" }), { location: "tab", focus: false });
		flushSync();
		expect(summary(container)).toBe("Creates {title} from Meeting");
		// A template is set and there are some now.
		expect(newTemplateButton(container)).toBeUndefined();
	});

	it("puts it in Templates when no template folder is set", async () => {
		const { container, props, app } = mount(templateChoice());
		vi.mocked(GenericInputPrompt.Prompt).mockResolvedValue("Meeting");

		await fireEvent.click(newTemplateButton(container)!);
		await vi.waitFor(() => expect(props.choice.templatePath).toBe("Templates/Meeting.md"));
		expect(app.vault.create).toHaveBeenCalledWith("Templates/Meeting.md", NEW_TEMPLATE_CONTENT);
	});

	it("does not replace a file that exists", async () => {
		const app = appWith(["Templates/Meeting.md"]);
		const { container, props } = mount(templateChoice(), app, pluginWith(app, ["Templates"]));
		vi.mocked(GenericInputPrompt.Prompt).mockResolvedValue("Meeting");

		await fireEvent.click(newTemplateButton(container)!);
		await vi.waitFor(() => expect(notices.map((notice) => notice.message)).toEqual(["QuickAdd: Templates/Meeting.md already exists."]));
		expect(app.vault.create).not.toHaveBeenCalled();
		expect(openFile).not.toHaveBeenCalled();
		expect(props.choice.templatePath).toBe("");
	});

	it("makes nothing of an empty name", async () => {
		const { container, props, app } = mount(templateChoice());
		vi.mocked(GenericInputPrompt.Prompt).mockResolvedValue("   ");

		await fireEvent.click(newTemplateButton(container)!);
		await vi.waitFor(() => expect(GenericInputPrompt.Prompt).toHaveBeenCalled());
		await Promise.resolve();
		expect(app.vault.create).not.toHaveBeenCalled();
		expect(props.choice.templatePath).toBe("");
	});
});
