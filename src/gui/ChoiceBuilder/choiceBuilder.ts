import { type App, Modal, Setting } from "obsidian";
import type { SvelteComponent } from "svelte";
import { log } from "../../logger/logManager";
import type IChoice from "../../types/choices/IChoice";
import type { FileViewMode2, OpenLocation } from "../../types/fileOpening";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";
import { t } from "../../i18n/i18n";

export abstract class ChoiceBuilder extends Modal {
	private resolvePromise: (input: IChoice) => void;
	private rejectPromise: (reason?: unknown) => void;
	private input: IChoice;
	public waitForClose: Promise<IChoice>;
	abstract choice: IChoice;
	private didSubmit = false;
	protected svelteElements: SvelteComponent[] = [];

	protected constructor(app: App) {
		super(app);

		this.waitForClose = new Promise<IChoice>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		this.containerEl.addClass("quickAddModal");
		this.open();
	}

	protected abstract display(): unknown;

	protected reload() {
		this.contentEl.empty();
		this.display();
	}

	protected addOnePageOverrideSetting(choice: IChoice): void {
		new Setting(this.contentEl)
			.setName(t("builder.one_page_override.name"))
			.setDesc(t("builder.one_page_override.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					"": t("builder.one_page_override.follow"),
					always: t("builder.one_page_override.always"),
					never: t("builder.one_page_override.never"),
				});
				dropdown.setValue((choice.onePageInput ?? "") as string);
				dropdown.onChange((val: string) => {
					choice.onePageInput = val === "" ? undefined : (val as any);
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
			searchComponent.setPlaceholder(t("builder.file_path_placeholder"));

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
		headerEl.setText(choice.name);

		headerEl.addEventListener("click", async (ev) => {
			try {
				const newName: string = await GenericInputPrompt.Prompt(
					this.app,
					choice.name,
					t("builder.choice_name"),
					choice.name,
				);
				if (newName !== choice.name) {
					choice.name = newName;
					headerEl.setText(newName);
				}
			} catch {
				log.logMessage(`No new name given for ${choice.name}`);
			}
		});
	}

	/**
	 * Adds a toggle that controls whether the resulting file should be opened.
	 * @param description Description explaining what file will be opened (e.g. "Open the file that is captured to.")
	 */
	protected addOpenFileSetting(description: string): void {
		// We intentionally cast to `any` because not all IChoice implementations have openFile.
		const choice: any = this.choice as any;
		if (choice.openFile === undefined) return; // Guard: nothing to configure

		new Setting(this.contentEl)
			.setName(t("builder.open"))
			.setDesc(description)
			.addToggle((toggle) => {
				toggle.setValue(choice.openFile);
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
		const choice: any = this.choice as any;
		if (choice.fileOpening === undefined) {
			// Provide sane defaults if none exist yet
			choice.fileOpening = {
				location: "tab" as OpenLocation,
				direction: "vertical",
				mode: "default" as FileViewMode2,
				focus: true,
			};
		}

		const fileOpening = choice.fileOpening as {
			location: OpenLocation;
			direction: "vertical" | "horizontal";
			mode: FileViewMode2;
			focus: boolean;
		};

		// Location selector
		new Setting(this.contentEl)
			.setName(t("builder.location"))
			.setDesc(t("builder.descriptions.location"))
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					reuse: t("builder.options.reuse"),
					tab: t("builder.options.tab"),
					split: t("builder.options.split"),
					window: t("builder.options.window"),
					"left-sidebar": t("builder.options.left"),
					"right-sidebar": t("builder.options.right"),
				});
				dropdown.setValue(fileOpening.location);
				dropdown.onChange((value: any) => {
					fileOpening.location = value as OpenLocation;
					this.reload();
				});
			});

		// Split direction – only if location === "split"
		if (fileOpening.location === "split") {
			new Setting(this.contentEl)
				.setName(t("builder.split_direction"))
				.setDesc(t("builder.descriptions.split"))
				.addDropdown((dropdown) => {
					dropdown.addOptions({
						vertical: t("builder.options.vertical"),
						horizontal: t("builder.options.horizontal"),
					});
					dropdown.setValue(fileOpening.direction);
					dropdown.onChange((value: any) => {
						fileOpening.direction = value;
					});
				});
		}

		// View mode selector
		new Setting(this.contentEl)
			.setName(t("builder.viewMode"))
			.setDesc(t("builder.descriptions.view_mode"))
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					source: t("builder.options.source"),
					preview: t("builder.options.preview"),
					live: t("builder.options.live"),
					default: t("builder.options.default"),
				});
				dropdown.setValue(
					typeof fileOpening.mode === "string"
						? (fileOpening.mode as string)
						: "default",
				);
				dropdown.onChange((value: any) => {
					fileOpening.mode = value as FileViewMode2;
				});
			});

		// Focus toggle – only show for non-reuse locations
		if (fileOpening.location !== "reuse") {
			new Setting(this.contentEl)
				.setName(t("builder.focus_pane"))
				.setDesc(t("builder.descriptions.focus"))
				.addToggle((toggle) =>
					toggle.setValue(fileOpening.focus).onChange((value) => {
						fileOpening.focus = value;
					}),
				);
		}
	}

	onClose() {
		super.onClose();
		this.resolvePromise(this.choice);
		this.svelteElements.forEach((el) => {
			if (el && el.$destroy) el.$destroy();
		});

		if (!this.didSubmit) this.rejectPromise("No answer given.");
		else this.resolvePromise(this.input);
	}
}
