import type { App, TextComponent } from "obsidian";
import { Notice, Setting, ToggleComponent } from "obsidian";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_TOP,
	FILE_NAME_FORMAT_SYNTAX,
} from "../../constants";
import { FileNameDisplayFormatter } from "../../formatters/fileNameDisplayFormatter";
import { FormatDisplayFormatter } from "../../formatters/formatDisplayFormatter";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type { LinkPlacement, LinkType } from "../../types/linkPlacement";
import {
	normalizeAppendLinkOptions,
	placementSupportsEmbed,
} from "../../types/linkPlacement";
import { createValidatedInput } from "../components/validatedInput";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import { ChoiceBuilder } from "./choiceBuilder";
import { t } from "../../i18n/i18n";

export class CaptureChoiceBuilder extends ChoiceBuilder {
	choice: ICaptureChoice;

	constructor(
		app: App,
		choice: ICaptureChoice,
		private plugin: QuickAdd,
	) {
		super(app);
		this.choice = choice;

		this.display();
	}

	protected display() {
		this.containerEl.addClass("captureChoiceBuilder");
		this.contentEl.empty();

		this.addCenteredChoiceNameHeader(this.choice);

		// Location
		new Setting(this.contentEl).setName(t("builder.common.location")).setHeading();
		this.addCapturedToSetting();
		if (!this.choice?.captureToActiveFile) {
			this.addCreateIfNotExistsSetting();
			if (this.choice?.createFileIfItDoesntExist?.enabled)
				this.addCreateWithTemplateSetting();
		}

		// Position
		new Setting(this.contentEl).setName(t("builder.common.position")).setHeading();
		this.addWritePositionSetting();

		// Linking
		new Setting(this.contentEl).setName(t("builder.common.linking")).setHeading();
		this.addAppendLinkSetting();

		// Content
		new Setting(this.contentEl).setName(t("builder.common.content")).setHeading();
		this.addTaskSetting();
		this.addFormatSetting();

		// Behavior
		new Setting(this.contentEl).setName(t("builder.common.behavior")).setHeading();
		if (!this.choice.captureToActiveFile) {
			this.addOpenFileSetting("Open the captured file.");

			if (this.choice.openFile) {
				this.addFileOpeningSetting("captured");
			}
		}
		this.addSelectionAsValueSetting();
		this.addTemplaterAfterCaptureSetting();
		this.addOnePageOverrideSetting(this.choice);
	}

	private addTemplaterAfterCaptureSetting() {
		new Setting(this.contentEl)
			.setName("Run Templater on entire destination file after capture")
			.setDesc(
				"Advanced / legacy: this executes any `<% %>` anywhere in the destination file (including inside code blocks).",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.choice.templater?.afterCapture === "wholeFile");
				toggle.onChange((value) => {
					if (!this.choice.templater) {
						this.choice.templater = {};
					}
					this.choice.templater.afterCapture = value ? "wholeFile" : "none";
				});
			});
	}

	private addSelectionAsValueSetting() {
		new Setting(this.contentEl)
			.setName(t("settings.selection_capture.name"))
			.setDesc(t("settings.selection_capture.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					"": t("builder.one_page_override.follow"),
					enabled: "Use selection",
					disabled: "Ignore selection",
				});
				const override = this.choice.useSelectionAsCaptureValue;
				dropdown.setValue(
					typeof override === "boolean"
						? override
							? "enabled"
							: "disabled"
						: "",
				);
				dropdown.onChange((value) => {
					if (value === "") {
						this.choice.useSelectionAsCaptureValue = undefined;
						return;
					}
					this.choice.useSelectionAsCaptureValue = value === "enabled";
				});
			});
	}

	private addCapturedToSetting() {
		new Setting(this.contentEl)
			.setName(t("builder.capture.to"))
			.setDesc(t("builder.capture.to_desc"));

		const captureToContainer: HTMLDivElement =
			this.contentEl.createDiv("captureToContainer");

		const captureToActiveFileContainer: HTMLDivElement =
			captureToContainer.createDiv("captureToActiveFileContainer");
		const captureToActiveFileText: HTMLSpanElement =
			captureToActiveFileContainer.createEl("span");
		captureToActiveFileText.textContent = t("builder.capture.active_file");
		const captureToActiveFileToggle: ToggleComponent = new ToggleComponent(
			captureToActiveFileContainer,
		);
		captureToActiveFileToggle.setValue(this.choice?.captureToActiveFile);
		captureToActiveFileToggle.onChange((value) => {
			this.choice.captureToActiveFile = value;
			
			// Reset new line capture settings when switching away from active file
			if (!value && this.choice.newLineCapture?.enabled) {
				this.choice.newLineCapture.enabled = false;
			}

			this.reload();
		});

		if (!this.choice?.captureToActiveFile) {
			const captureToFileContainer: HTMLDivElement =
				captureToContainer.createDiv("captureToFileContainer");

			new Setting(captureToFileContainer)
				.setName("File path / format")
				.setDesc("Choose a file or use format syntax (e.g., {{DATE}})");

			const displayFormatter: FileNameDisplayFormatter =
				new FileNameDisplayFormatter(this.app, this.plugin);

			const previewRow = captureToFileContainer.createDiv({ cls: "qa-preview-row" });
			previewRow.createEl("span", { text: t("builder.common.preview"), cls: "qa-preview-label" });
			const formatDisplay = previewRow.createEl("span");
			formatDisplay.setAttr("aria-live", "polite");
			formatDisplay.textContent = t("builder.common.loading");

			const markdownFilesAndFormatSyntax = [
				...this.app.vault.getMarkdownFiles().map((f) => f.path),
				...FILE_NAME_FORMAT_SYNTAX,
			];

			createValidatedInput({
				app: this.app,
				parent: captureToFileContainer,
				initialValue: this.choice.captureTo,
				placeholder: "File name format",
				suggestions: markdownFilesAndFormatSyntax,
				maxSuggestions: 50,
				attachSuggesters: [
					(el) => new FormatSyntaxSuggester(this.app, el, this.plugin),
				],
				onChange: async (value) => {
					this.choice.captureTo = value;
					try {
						formatDisplay.textContent = await displayFormatter.format(value);
					} catch {
						formatDisplay.textContent = t("builder.common.unavailable");
					}
				},
			});

			void (async () => {
				try {
					formatDisplay.textContent = await displayFormatter.format(
						this.choice.captureTo,
					);
				} catch {
					formatDisplay.textContent = t("builder.common.unavailable");
				}
			})();
		}
	}

	private addTaskSetting() {
		const taskSetting: Setting = new Setting(this.contentEl);
		taskSetting
			.setName(t("builder.capture.task"))
			.setDesc(t("builder.capture.task_desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.choice.task);
				toggle.onChange((value) => (this.choice.task = value));
			});
	}

	private addAppendLinkSetting() {
		// Normalize to ensure we're always working with the new format internally
		const normalizedOptions = normalizeAppendLinkOptions(
			this.choice.appendLink,
		);
		const normalizedLinkType = normalizedOptions.linkType ?? "link";

		type AppendLinkMode = "required" | "optional" | "disabled";
		const currentMode: AppendLinkMode = normalizedOptions.enabled
			? normalizedOptions.requireActiveFile
				? "required"
				: "optional"
			: "disabled";

		const appendLinkSetting: Setting = new Setting(this.contentEl);
		appendLinkSetting
			.setName(t("builder.append_link.name"))
			.setDesc(t("builder.append_link.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOption("required", t("builder.append_link.options.required"));
				dropdown.addOption("optional", t("builder.append_link.options.optional"));
				dropdown.addOption("disabled", t("builder.append_link.options.disabled"));

				dropdown.setValue(currentMode);
				dropdown.onChange((value: AppendLinkMode) => {
					switch (value) {
						case "disabled":
							this.choice.appendLink = false;
							break;
						case "required":
							this.choice.appendLink = {
								enabled: true,
								placement: normalizedOptions.placement,
								requireActiveFile: true,
								linkType: normalizedLinkType,
							};
							break;
						case "optional":
							this.choice.appendLink = {
								enabled: true,
								placement: normalizedOptions.placement,
								requireActiveFile: false,
								linkType: normalizedLinkType,
							};
							break;
					}
					this.reload();
				});
			});

		// Only show placement dropdown when append link is enabled
		if (currentMode !== "disabled") {
			const placementSetting: Setting = new Setting(this.contentEl);
			placementSetting
				.setName(t("builder.append_link.placement"))
				.setDesc("Where to place the link when appending")
				.addDropdown((dropdown) => {
					dropdown.addOption("replaceSelection", t("builder.append_link.options.replace"));
					dropdown.addOption("afterSelection", t("builder.append_link.options.after"));
					dropdown.addOption("endOfLine", t("builder.append_link.options.eol"));
					dropdown.addOption("newLine", t("builder.append_link.options.newline"));

					dropdown.setValue(normalizedOptions.placement);
					dropdown.onChange((value: LinkPlacement) => {
						const currentValue = this.choice.appendLink;
						const requireActiveFile =
							typeof currentValue === "boolean"
								? normalizedOptions.requireActiveFile
								: currentValue.requireActiveFile;
						const previousLinkType =
							typeof currentValue === "boolean"
								? normalizedLinkType
								: currentValue.linkType ?? normalizedLinkType;
				const nextLinkType = placementSupportsEmbed(value)
					? previousLinkType
					: "link";

						this.choice.appendLink = {
							enabled: true,
							placement: value,
							requireActiveFile,
							linkType: nextLinkType,
						};

						this.reload();
					});
				});

			if (placementSupportsEmbed(normalizedOptions.placement)) {
				const linkTypeSetting: Setting = new Setting(this.contentEl);
				linkTypeSetting
					.setName(t("builder.append_link.type"))
					.setDesc("Choose whether to insert a regular link or an embed when replacing the selection.")
					.addDropdown((dropdown) => {
						dropdown.addOption("link", t("builder.append_link.options.link"));
						dropdown.addOption("embed", t("builder.append_link.options.embed"));
						dropdown.setValue(normalizedLinkType);
						dropdown.onChange((value: LinkType) => {
							const currentValue = this.choice.appendLink;
							const requireActiveFile =
								typeof currentValue === "boolean"
									? normalizedOptions.requireActiveFile
									: currentValue.requireActiveFile;
							const placement =
								typeof currentValue === "boolean"
									? normalizedOptions.placement
									: currentValue.placement;

							this.choice.appendLink = {
								enabled: true,
								placement,
								requireActiveFile,
								linkType: value,
							};
						});
					});
			}
		}
	}

	private addWritePositionSetting() {
		const positionSetting: Setting = new Setting(this.contentEl);
		const isActiveFile = !!this.choice?.captureToActiveFile;

		if (!this.choice.activeFileWritePosition) {
			this.choice.activeFileWritePosition = "cursor";
		}

		positionSetting
			.setName(t("builder.capture.write_pos"))
			.setDesc(t("builder.capture.write_pos_desc"))
			.addDropdown((dropdown) => {
				const current =
					this.choice.insertAfter?.enabled
						? "after"
						: this.choice.prepend
							? "bottom"
							: this.choice.newLineCapture?.enabled
								? this.choice.newLineCapture.direction === "above"
									? "newLineAbove"
									: "newLineBelow"
								: isActiveFile && this.choice.activeFileWritePosition === "top"
									? "activeTop"
									: "top";

				dropdown.addOption("top", isActiveFile ? t("builder.capture.pos_options.cursor") : t("builder.capture.pos_options.top"));

				if (isActiveFile) {
					dropdown.addOption("activeTop", t("builder.capture.pos_options.active_top"));
					dropdown.addOption("newLineAbove", t("builder.capture.pos_options.newline_above"));
					dropdown.addOption("newLineBelow", t("builder.capture.pos_options.newline_below"));
				}
				
				dropdown.addOption("after", t("builder.capture.pos_options.after"));
				dropdown.addOption("bottom", t("builder.capture.pos_options.bottom"));
				dropdown.setValue(current);
				dropdown.onChange((value: string) => {
					const v = value as
						| "top"
						| "after"
						| "bottom"
						| "newLineAbove"
						| "newLineBelow"
						| "activeTop";
					
					this.choice.prepend = false;
					this.choice.insertAfter.enabled = false;
					if (!this.choice.newLineCapture) {
						this.choice.newLineCapture = { enabled: false, direction: "below" };
					}
					this.choice.newLineCapture.enabled = false;
					this.choice.activeFileWritePosition = "cursor";
					
					if (v === "top") {
						this.reload();
						return;
					}

					if (v === "activeTop") {
						if (isActiveFile) {
							this.choice.activeFileWritePosition = "top";
						}
						this.reload();
						return;
					}

					if (v === "bottom") {
						this.choice.prepend = true;
						this.reload();
						return;
					}
					
					if (v === "newLineAbove") {
						this.choice.newLineCapture.enabled = true;
						this.choice.newLineCapture.direction = "above";
						this.reload();
						return;
					}
					
					if (v === "newLineBelow") {
						this.choice.newLineCapture.enabled = true;
						this.choice.newLineCapture.direction = "below";
						this.reload();
						return;
					}

					// after line
					this.choice.insertAfter.enabled = true;
					this.reload();
				});
			});

		if (this.choice.insertAfter.enabled) {
			this.addInsertAfterFields();
		}
	}

	private addInsertAfterFields() {
		new Setting(this.contentEl)
			.setName(t("builder.capture.insert_after"))
			.setDesc(t("builder.capture.insert_after_desc"));

		const displayFormatter: FormatDisplayFormatter = new FormatDisplayFormatter(
			this.app,
			this.plugin,
		);

		const previewRow = this.contentEl.createDiv({ cls: "qa-preview-row" });
		previewRow.createEl("span", { text: t("builder.common.preview"), cls: "qa-preview-label" });
		const previewValue = previewRow.createEl("span");
		previewValue.setAttribute("aria-live", "polite");
		previewValue.innerText = t("builder.common.loading");

		createValidatedInput({
			app: this.app,
			parent: this.contentEl,
			initialValue: this.choice.insertAfter.after,
			placeholder: "Insert after",
			required: true,
			requiredMessage: "Insert after text is required",
			attachSuggesters: [
				(el) => new FormatSyntaxSuggester(this.app, el, this.plugin),
			],
			onChange: async (value) => {
				this.choice.insertAfter.after = value;
				try {
					previewValue.innerText = await displayFormatter.format(value);
				} catch {
					previewValue.innerText = t("builder.common.unavailable");
				}
			},
		});

		void (async () => {
			try {
				previewValue.innerText = await displayFormatter.format(
					this.choice.insertAfter.after,
				);
			} catch {
				previewValue.innerText = t("builder.common.unavailable");
			}
		})();

		if (this.choice.insertAfter.inline === undefined) {
			this.choice.insertAfter.inline = false;
		}

		if (this.choice.insertAfter.replaceExisting === undefined) {
			this.choice.insertAfter.replaceExisting = false;
		}

		new Setting(this.contentEl)
			.setName(t("builder.capture.inline"))
			.setDesc(t("builder.capture.inline_desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(!!this.choice.insertAfter?.inline)
					.onChange((value) => {
						this.choice.insertAfter.inline = value;
						this.reload();
					}),
			);

		if (this.choice.insertAfter.inline) {
			new Setting(this.contentEl)
				.setName("Replace existing value")
				.setDesc("Replace everything after the matched text up to end-of-line.")
				.addToggle((toggle) =>
					toggle
						.setValue(!!this.choice.insertAfter?.replaceExisting)
						.onChange(
							(value) => (this.choice.insertAfter.replaceExisting = value),
						),
				);
		}

		const inlineEnabled = !!this.choice.insertAfter?.inline;

		if (!inlineEnabled) {
			const insertAtEndSetting: Setting = new Setting(this.contentEl);
			insertAtEndSetting
				.setName(t("builder.capture.insert_end_section"))
				.setDesc(
					"Place the text at the end of the matched section instead of the top.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.choice.insertAfter?.insertAtEnd)
						.onChange((value) => {
							this.choice.insertAfter.insertAtEnd = value;
							this.reload();
						}),
				);

			if (!this.choice.insertAfter?.blankLineAfterMatchMode) {
				this.choice.insertAfter.blankLineAfterMatchMode = "auto";
			}

			const blankLineModeDesc =
				"Controls whether Insert After skips existing blank lines after the matched line.";
			const insertAtEndEnabled = !!this.choice.insertAfter?.insertAtEnd;
			const blankLineModeSetting: Setting = new Setting(this.contentEl);
			blankLineModeSetting
				.setName("Blank lines after match")
				.setDesc(
					insertAtEndEnabled
						? "Not used when inserting at end of section."
						: blankLineModeDesc,
				)
					.addDropdown((dropdown) => {
						dropdown
							.addOption("auto", "Auto (headings only)")
							.addOption("skip", "Always skip")
							.addOption("none", "Never skip")
							.setValue(
								this.choice.insertAfter?.blankLineAfterMatchMode ?? "auto",
							)
							.onChange((value) => {
								this.choice.insertAfter.blankLineAfterMatchMode = value as
									| "auto"
									| "skip"
									| "none";
						});
					dropdown.setDisabled(insertAtEndEnabled);
				});
			blankLineModeSetting.setDisabled(insertAtEndEnabled);

			new Setting(this.contentEl)
				.setName(t("builder.capture.consider_subsections"))
				.setDesc(
					"Also include the section’s subsections (requires target to be a heading starting with #).",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.choice.insertAfter?.considerSubsections)
						.onChange((value) => {
							if (!value) {
								this.choice.insertAfter.considerSubsections = false;
								return;
							}

							const targetIsHeading =
								this.choice.insertAfter.after.startsWith("#");
							if (targetIsHeading) {
								this.choice.insertAfter.considerSubsections = value;
							} else {
								this.choice.insertAfter.considerSubsections = false;
								// reset the toggle to match state and inform user
								toggle.setValue(false);
								new Notice(
									"Consider subsections requires the target to be a heading (starts with #)",
								);
							}
						}),
				);
		}

		const createLineIfNotFound: Setting = new Setting(this.contentEl);
		createLineIfNotFound
			.setName("Create line if not found")
			.setDesc("Creates the 'insert after' line if it is not found.")
			.addToggle((toggle) => {
				if (!this.choice.insertAfter?.createIfNotFound)
					this.choice.insertAfter.createIfNotFound = false; // Set to default

				toggle
					.setValue(this.choice.insertAfter?.createIfNotFound)
					.onChange(
						(value) => (this.choice.insertAfter.createIfNotFound = value),
					).toggleEl.style.marginRight = "1em";
			})
			.addDropdown((dropdown) => {
				if (!this.choice.insertAfter?.createIfNotFoundLocation)
					this.choice.insertAfter.createIfNotFoundLocation =
						CREATE_IF_NOT_FOUND_TOP; // Set to default

				dropdown
					.addOption(CREATE_IF_NOT_FOUND_TOP, "Top")
					.addOption(CREATE_IF_NOT_FOUND_BOTTOM, "Bottom")
					.addOption(CREATE_IF_NOT_FOUND_CURSOR, "Cursor")
					.setValue(this.choice.insertAfter?.createIfNotFoundLocation)
					.onChange(
						(value) =>
							(this.choice.insertAfter.createIfNotFoundLocation = value),
					);
			});
	}

	private addFormatSetting() {
		const enableSetting = new Setting(this.contentEl);
		enableSetting
			.setName(t("builder.capture.format"))
			.setDesc(t("builder.capture.format_desc"))
			.addToggle((toggleComponent) => {
				toggleComponent
					.setValue(this.choice.format.enabled)
					.onChange((value) => {
						this.choice.format.enabled = value;
						formatHandle.setDisabled(!value);
						formatHandle.setRequired(value);
					});
			});

		const displayFormatter: FormatDisplayFormatter = new FormatDisplayFormatter(
			this.app,
			this.plugin,
		);

		const previewRow = this.contentEl.createDiv({ cls: "qa-preview-row" });
		previewRow.createEl("span", { text: t("builder.common.preview"), cls: "qa-preview-label" });
		const formatDisplay = previewRow.createEl("span");
		formatDisplay.setAttr("aria-live", "polite");
		formatDisplay.innerText = t("builder.common.loading");

		const formatHandle = createValidatedInput({
			app: this.app,
			parent: this.contentEl,
			inputKind: "textarea",
			initialValue: this.choice.format.format,
			placeholder: "Format",
			required: this.choice.format.enabled,
			requiredMessage: "Capture format is required when enabled",
			attachSuggesters: [
				(el) => new FormatSyntaxSuggester(this.app, el, this.plugin),
			],
			onChange: async (value) => {
				this.choice.format.format = value;
				try {
					formatDisplay.innerText = await displayFormatter.format(value);
				} catch {
					formatDisplay.innerText = t("builder.common.unavailable");
				}
			},
		});

		formatHandle.setDisabled(!this.choice.format.enabled);

		void (async () => {
			try {
				formatDisplay.innerText = await displayFormatter.format(
					this.choice.format.format,
				);
			} catch {
				formatDisplay.innerText = t("builder.common.unavailable");
			}
		})();
	}

	private addCreateIfNotExistsSetting() {
		if (!this.choice.createFileIfItDoesntExist)
			this.choice.createFileIfItDoesntExist = {
				enabled: false,
				createWithTemplate: false,
				template: "",
			};

		const createFileIfItDoesntExist: Setting = new Setting(this.contentEl);
		createFileIfItDoesntExist
			.setName(t("builder.capture.create_if_missing"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.choice?.createFileIfItDoesntExist?.enabled)
					.setTooltip("Create file if it doesn't exist")
					.onChange((value) => {
						this.choice.createFileIfItDoesntExist.enabled = value;
						this.reload();
					}),
			);
	}

	private addCreateWithTemplateSetting() {
		let templateSelector: TextComponent;
		const createWithTemplateSetting = new Setting(this.contentEl);
		createWithTemplateSetting
			.setName(t("builder.capture.create_with_template"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.choice.createFileIfItDoesntExist?.createWithTemplate)
					.onChange((value) => {
						this.choice.createFileIfItDoesntExist.createWithTemplate = value;
						templateSelector.setDisabled(!value);
					}),
			);

		const templateFilePaths: string[] = this.plugin
			.getTemplateFiles()
			.map((f) => f.path);

		const templateSelectorHandle = createValidatedInput({
			app: this.app,
			parent: this.contentEl,
			initialValue: this.choice?.createFileIfItDoesntExist?.template ?? "",
			placeholder: "Template path",
			suggestions: templateFilePaths,
			maxSuggestions: 50,
			validator: (raw) => {
				const v = raw.trim();
				if (!v) return true;
				return templateFilePaths.includes(v) || "Template not found";
			},
			onChange: (value) => {
				this.choice.createFileIfItDoesntExist.template = value;
			},
		});

		templateSelectorHandle.setDisabled(
			!this.choice?.createFileIfItDoesntExist?.createWithTemplate,
		);

		templateSelector = templateSelectorHandle.component as TextComponent;
	}
}
