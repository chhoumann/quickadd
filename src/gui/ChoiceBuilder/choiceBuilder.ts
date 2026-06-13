import { type App, Modal, Setting, setIcon } from "obsidian";
import type { MountHandle } from "../svelte/mountComponent";
import { snapshot } from "../svelte/persist.svelte";
import type IChoice from "../../types/choices/IChoice";
import type { FileViewMode2, OpenLocation } from "../../types/fileOpening";
import {
	normalizeFileOpening,
	type FileOpeningSettings,
} from "../../utils/fileOpeningDefaults";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";
import { promptRenameChoice } from "../choiceRename";

type OnePageOverride = NonNullable<IChoice["onePageInput"]>;
type ChoiceWithOpenFile = IChoice & {
	openFile?: boolean;
	fileOpening?: FileOpeningSettings;
};

function isOnePageOverride(value: string): value is OnePageOverride {
	return value === "always" || value === "never";
}

export abstract class ChoiceBuilder extends Modal {
	private resolvePromise: (input: IChoice) => void;
	public waitForClose: Promise<IChoice>;
	abstract choice: IChoice;
	protected svelteElements: MountHandle[] = [];

	protected constructor(app: App) {
		super(app);

		this.waitForClose = new Promise<IChoice>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.containerEl.addClass("quickAddModal");
		this.open();
	}

	protected abstract display(): unknown;

	protected reload() {
		// Unmount the previous Svelte components before re-rendering, otherwise their
		// effects/subscriptions leak for the modal's lifetime (contentEl.empty() only
		// removes DOM nodes, not the mounted components).
		this.destroySvelteElements();
		this.contentEl.empty();
		this.display();
	}

	private destroySvelteElements() {
		this.svelteElements.forEach((handle) => handle.destroy());
		this.svelteElements = [];
	}

	protected addOnePageOverrideSetting(choice: IChoice): void {
		new Setting(this.contentEl)
			.setName("One-page input override")
			.setDesc(
				"Override the global setting for this choice. 'Always' forces the one-page modal even if disabled globally; 'Never' disables it even if enabled globally.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					"": "Follow global setting",
					always: "Always",
					never: "Never",
				});
				dropdown.setValue((choice.onePageInput ?? "") as string);
				dropdown.onChange((val: string) => {
					choice.onePageInput = isOnePageOverride(val) ? val : undefined;
				});
			});
	}

	protected addFileSearchInputToSetting(
		setting: Setting,
		value: string,
		onChangeCallback: (value: string) => void,
	): void {
		setting.addSearch((searchComponent) => {
			searchComponent.setValue(value);
			searchComponent.setPlaceholder("File path");

			const markdownFiles: string[] = this.app.vault
				.getMarkdownFiles()
				.map((f) => f.path);
			new GenericTextSuggester(
				this.app,
				searchComponent.inputEl,
				markdownFiles,
			);

			searchComponent.onChange(onChangeCallback);
		});

		return;
	}

	protected addCenteredChoiceNameHeader(choice: IChoice): void {
		const headerEl: HTMLHeadingElement = this.contentEl.createEl("h2", {
			cls: "choiceNameHeader",
		});
		// Rename affordance is a real <button> (keyboard operable: Enter/Space) inside
		// the heading, so the <h2> keeps its heading role for screen readers (#1250).
		const button = headerEl.createEl("button", {
			cls: "choiceNameHeaderButton qa-rename-title-button",
			attr: { type: "button", "aria-label": `Rename ${choice.name}` },
		});
		const textEl = button.createSpan({
			text: choice.name,
			cls: "choiceNameHeaderText",
		});
		const iconEl = button.createSpan({
			cls: "choiceNameHeaderIcon",
			attr: { "aria-hidden": "true" },
		});
		setIcon(iconEl, "pencil");

		button.addEventListener("click", () => {
			void (async () => {
				const newName = await promptRenameChoice(this.app, choice.name);
				if (!newName) return;
				choice.name = newName;
				textEl.setText(newName);
				button.setAttribute("aria-label", `Rename ${newName}`);
			})();
		});
	}

	/**
	 * Adds a toggle that controls whether the resulting file should be opened.
	 * @param description Description explaining what file will be opened (e.g. "Open the file that is captured to.")
	 */
	protected addOpenFileSetting(description: string): void {
		const choice = this.choice as ChoiceWithOpenFile;
		if (choice.openFile === undefined) return; // Guard: nothing to configure

		new Setting(this.contentEl)
			.setName("Open")
			.setDesc(description)
			.addToggle((toggle) => {
				toggle.setValue(choice.openFile === true);
				toggle.onChange((value) => {
					choice.openFile = value;
					this.reload();
				});
			});
	}

	/**
	 * Renders the UI for configuring where and how to open a file after it is created/updated.
	 * This is shared between multiple ChoiceBuilder implementations.
	 *
	 * @param contextLabel Text to use in descriptions (e.g. "captured" | "created")
	 */
	protected addFileOpeningSetting(contextLabel: string): void {
		const choice = this.choice as ChoiceWithOpenFile;
		choice.fileOpening = normalizeFileOpening(choice.fileOpening);

		const fileOpening = choice.fileOpening;

		// Location selector
		new Setting(this.contentEl)
			.setName("File Opening Location")
			.setDesc(`Where to open the ${contextLabel} file`)
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					reuse: "Reuse current tab",
					tab: "New tab",
					split: "Split pane",
					window: "New window",
					"left-sidebar": "Left sidebar",
					"right-sidebar": "Right sidebar",
				});
				dropdown.setValue(fileOpening.location);
				dropdown.onChange((value) => {
					fileOpening.location = value as OpenLocation;
					this.reload();
				});
			});

		// Split direction – only if location === "split"
		if (fileOpening.location === "split") {
			new Setting(this.contentEl)
				.setName("Split Direction")
				.setDesc("How to arrange the new pane relative to the current one")
				.addDropdown((dropdown) => {
					dropdown.addOptions({
						vertical: "Split right",
						horizontal: "Split down",
					});
					dropdown.setValue(fileOpening.direction);
					dropdown.onChange((value) => {
						fileOpening.direction = value as FileOpeningSettings["direction"];
					});
				});
		}

		// View mode selector
		new Setting(this.contentEl)
			.setName("View Mode")
			.setDesc("How to display the opened file")
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					source: "Source",
					preview: "Preview",
					live: "Live Preview",
					default: "Default",
				});
				dropdown.setValue(
					typeof fileOpening.mode === "string"
						? (fileOpening.mode as string)
						: "default",
				);
				dropdown.onChange((value) => {
					fileOpening.mode = value as FileViewMode2;
				});
			});

		// Focus toggle – only show for non-reuse locations
		if (fileOpening.location !== "reuse") {
			new Setting(this.contentEl)
				.setName("Focus new pane")
				.setDesc("Focus the opened tab immediately after opening")
				.addToggle((toggle) =>
					toggle.setValue(fileOpening.focus).onChange((value) => {
						fileOpening.focus = value;
					}),
				);
		}
	}

	/**
	 * The choice value to resolve at close. Converted (Svelte) builders override
	 * this to return the form's $state-backed proxy (`this.formProps.choice`) — a
	 * $state proxy does NOT write through to the original `this.choice`, so the
	 * original would be unedited (silent data loss, see persist.svelte.ts / #1130).
	 * Still-imperative builders mutate `this.choice` in place and keep the default.
	 */
	protected getResultChoice(): IChoice {
		return this.choice;
	}

	onClose() {
		super.onClose();
		this.destroySvelteElements();
		// snapshot() deep-clones to a plain object (proxy or not), so callers that
		// spread the result never receive a live $state proxy.
		this.resolvePromise(snapshot(this.getResultChoice()));
	}
}
