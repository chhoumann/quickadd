import {
	DropdownComponent,
	Modal,
	Setting,
	TextAreaComponent,
	TextComponent,
	debounce,
	type App,
} from "obsidian";
import { createDatePicker } from "src/gui/date-picker/datePicker";
import { FieldValueInputSuggest } from "src/gui/suggesters/FieldValueInputSuggest";
import { SuggesterInputSuggest } from "src/gui/suggesters/SuggesterInputSuggest";
import { formatISODate, parseNaturalLanguageDate } from "src/utils/dateParser";
import {
	formatDateAliasInline,
	getOrderedDateAliases,
} from "src/utils/dateAliases";
import { settingsStore } from "src/settingsStore";
import type { FieldRequirement } from "./RequirementCollector";
import { mapMappedSuggesterValue } from "./suggesterValueMapping";

type PreviewComputer = (
	values: Record<string, string>,
) => Promise<Record<string, string>> | Record<string, string>;

export class OnePageInputModal extends Modal {
	private readonly requirements: FieldRequirement[];
	private readonly initialValues: Map<string, string>;
	private readonly result = new Map<string, string>();
	private readonly computePreview?: PreviewComputer;
	private previewContainerEl: HTMLElement | null = null;
	private updatePreviewDebounced: () => void;

	public waitForClose: Promise<Record<string, string>>;
	private resolvePromise!: (values: Record<string, string>) => void;
	private rejectPromise!: (reason?: unknown) => void;

	constructor(
		app: App,
		requirements: FieldRequirement[],
		initial?: Map<string, unknown>,
		computePreview?: PreviewComputer,
	) {
		super(app);
		this.requirements = requirements;
		this.initialValues = new Map<string, string>();
		this.computePreview = computePreview;
		initial?.forEach((v, k) => {
			if (typeof v === "string") this.initialValues.set(k, v);
		});

		this.updatePreviewDebounced = debounce(
			this.updatePreviews.bind(this),
			150,
			true,
		);

		this.waitForClose = new Promise<Record<string, string>>(
			(resolve, reject) => {
				this.resolvePromise = resolve;
				this.rejectPromise = reject;
			},
		);

		this.display();
		this.open();
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "onePageInputModal");
		this.contentEl.empty();

		const title = this.contentEl.createEl("h2", { text: "Provide inputs" });
		title.style.textAlign = "center";

		// Optional live preview area
		if (this.computePreview) {
			this.previewContainerEl = this.contentEl.createDiv();
			this.previewContainerEl.addClass("qa-onepage-preview");
			this.previewContainerEl.style.padding = "0.5rem";
			this.previewContainerEl.style.marginBottom = "0.75rem";
			this.previewContainerEl.style.backgroundColor =
				"var(--background-modifier-form-field)";
			this.previewContainerEl.style.borderRadius = "4px";
			const label = this.previewContainerEl.createEl("div", {
				text: "Preview",
			});
			label.style.fontWeight = "600";
			label.style.marginBottom = "0.25rem";
			this.updatePreviews();
		}

		// Render fields
		this.requirements.forEach((req) => this.renderField(req));

		// Action bar
		const btnRow = this.contentEl.createDiv();
		new Setting(btnRow)
			.addButton((btn) =>
				btn
					.setButtonText("Submit")
					.setCta()
					.onClick(() => this.submit()),
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.cancel()),
			);
	}

	private renderField(req: FieldRequirement) {
		const setValue = (id: string, value: string) => {
			this.result.set(id, value);
			this.updatePreviewDebounced();
		};
		const starting = this.initialValues.get(req.id) ?? req.defaultValue ?? "";

		switch (req.type) {
			case "textarea": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const input = new TextAreaComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				input.inputEl.style.width = "100%";
				input.inputEl.style.height = "120px";
				break;
			}
			case "text": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				break;
			}
			case "dropdown": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const dropdown = new DropdownComponent(setting.controlEl);
				const options = req.options ?? [];
				const displayOptions = req.displayOptions ?? options;
				if (options.length > 0) {
					options.forEach((opt, index) => {
						const display = displayOptions[index] ?? opt;
						dropdown.addOption(opt, display);
					});
					dropdown.setValue(starting || options[0] || "");
					dropdown.onChange((v) => setValue(req.id, v));
				} else {
					dropdown.setDisabled(true);
					const note = setting.controlEl.createDiv({
						text: req.placeholder || "No options available",
					});
					note.style.marginLeft = "0.5rem";
					note.style.color = "var(--text-muted)";
				}
				break;
			}
			case "date": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const container = setting.controlEl.createDiv({
					cls: "qa-date-input",
				});
				const input = new TextComponent(container);
				const placeholder =
					"Enter a date (e.g., 'today', 'next friday', '2025-12-25')";

				let selectedIso: string | undefined;
				let displayValue = starting;
				if (starting?.startsWith("@date:")) {
					selectedIso = starting.slice(6);
					const formatted = req.dateFormat
						? formatISODate(selectedIso, req.dateFormat)
						: undefined;
					displayValue =
						formatted ??
						(selectedIso.length >= 10 ? selectedIso.slice(0, 10) : selectedIso);
				}

				input.setPlaceholder(placeholder).setValue(displayValue ?? "");

				const pickerContainer = container.createDiv({
					cls: "qa-date-picker-container",
				});
				const datePicker = createDatePicker({
					container: pickerContainer,
					initialIso: selectedIso,
					onSelect: (iso) => {
						if (iso) applyPickerSelection(iso);
						else clearPickerSelection();
					},
				});

				const preview = container.createDiv();
				preview.style.marginTop = "0.25rem";
				preview.style.fontSize = "0.9em";
				preview.style.fontFamily = "var(--font-monospace)";

				const aliasEntries = getOrderedDateAliases(
					settingsStore.getState().dateAliases,
				);
				if (aliasEntries.length > 0) {
					const aliasDetails = container.createEl("details");
					aliasDetails.style.marginTop = "0.25rem";

					const aliasSummary = aliasDetails.createEl("summary", {
						text: `Aliases (${aliasEntries.length})`,
					});
					aliasSummary.style.fontSize = "0.85em";
					aliasSummary.style.color = "var(--text-muted)";

					const aliasList = aliasDetails.createEl("div");
					aliasList.textContent = formatDateAliasInline(
						settingsStore.getState().dateAliases,
					);
					aliasList.style.marginTop = "0.25rem";
					aliasList.style.fontSize = "0.85em";
					aliasList.style.color = "var(--text-muted)";
					aliasList.style.fontFamily = "var(--font-monospace)";
				}

				const formatIsoForDisplay = (iso: string) => {
					if (req.dateFormat) {
						const formatted = formatISODate(iso, req.dateFormat);
						if (formatted) return formatted;
					}
					return iso.length >= 10 ? iso.slice(0, 10) : iso;
				};

				const renderPreview = (text: string, isError: boolean) => {
					preview.setText(text);
					preview.style.color = isError
						? "var(--text-error)"
						: "var(--text-normal)";
				};

				const syncSelection = (iso?: string) => {
					datePicker.setSelectedIso(iso);
				};

				const applyPickerSelection = (iso: string) => {
					selectedIso = iso;
					const display = formatIsoForDisplay(iso);
					input.inputEl.value = display;
					setValue(req.id, `@date:${iso}`);
					renderPreview(display, false);
					syncSelection(iso);
				};

				const clearPickerSelection = () => {
					input.inputEl.value = "";
					updatePreview("");
				};

				const updatePreview = (val: string) => {
					const inputVal = (val ?? "").trim();
					if (!inputVal && req.defaultValue) {
						const parsed = parseNaturalLanguageDate(
							req.defaultValue,
							req.dateFormat,
						);
						if (parsed.isValid && parsed.isoString) {
							selectedIso = parsed.isoString;
							setValue(req.id, `@date:${parsed.isoString}`);
							syncSelection(parsed.isoString);
							const formatted =
								parsed.formatted ??
								formatIsoForDisplay(parsed.isoString);
							renderPreview(formatted, false);
							return;
						}
						renderPreview(parsed.error || "Unable to parse date", true);
						setValue(req.id, "");
						syncSelection();
						return;
					}
					if (!inputVal) {
						selectedIso = undefined;
						setValue(req.id, "");
						syncSelection();
						renderPreview("Preview will appear here", false);
						return;
					}

					if (inputVal.startsWith("@date:")) {
						const iso = inputVal.slice(6).trim();
						if (iso) {
							applyPickerSelection(iso);
							return;
						}
					}

					const parsed = parseNaturalLanguageDate(inputVal, req.dateFormat);
					if (parsed.isValid && parsed.isoString) {
						selectedIso = parsed.isoString;
						setValue(req.id, `@date:${parsed.isoString}`);
						syncSelection(parsed.isoString);
						const formatted =
							parsed.formatted ?? formatIsoForDisplay(parsed.isoString);
						renderPreview(formatted, false);
					} else {
						selectedIso = undefined;
						setValue(req.id, "");
						syncSelection();
						renderPreview(parsed.error || "Unable to parse date", true);
					}
				};

				input.onChange((v) => updatePreview(v));

				if (selectedIso) {
					applyPickerSelection(selectedIso);
				} else {
					updatePreview(displayValue ?? "");
				}
				break;
			}
			case "field-suggest": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				// Attach inline suggester powered by vault data & filters encoded in req.id
				try {
					new FieldValueInputSuggest(this.app, input.inputEl, req.id);
				} catch {
					// Non-fatal; leave as plain input if suggester fails
				}
				break;
			}
			case "suggester": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const options = req.options ?? [];
				const displayOptions = req.displayOptions ?? options;
				const displayToValue = new Map<string, string>();
				const valueToDisplay = new Map<string, string>();
				options.forEach((value, index) => {
					const display = displayOptions[index] ?? value;
					displayToValue.set(display, value);
					if (!valueToDisplay.has(value)) {
						valueToDisplay.set(value, display);
					}
				});
				const startingDisplay = valueToDisplay.get(starting) ?? starting;
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "Type to search...")
					.setValue(startingDisplay)
					.onChange((v) => setValue(req.id, v));
				input.inputEl.addEventListener("input", (event) => {
					const fromCompletion = Boolean((event as any).fromCompletion);
					const rawInput = input.inputEl.value;
					const storedValue = mapMappedSuggesterValue(
						rawInput,
						displayToValue,
						fromCompletion,
					);
					if (storedValue !== rawInput || fromCompletion) {
						setValue(req.id, storedValue);
					}
				});
				// Attach suggester if options are provided
				if (displayOptions.length > 0) {
					try {
						const caseSensitive = req.suggesterConfig?.caseSensitive ?? false;
						const multiSelect = req.suggesterConfig?.multiSelect ?? false;
						new SuggesterInputSuggest(
							this.app,
							input.inputEl,
							displayOptions,
							caseSensitive,
							multiSelect,
						);
					} catch {
						// Non-fatal; falls back to plain text input
					}
				}
				break;
			}
			case "file-picker": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				break;
			}
			default: {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
			}
		}

		// Initialize stored value for empty inputs to ensure presence
		if (!this.result.has(req.id)) this.result.set(req.id, starting);
	}

	private decorateLabel(req: FieldRequirement): string {
		return req.label;
	}

	private submit() {
		const out: Record<string, string> = {};
		const requirementsById = new Map(
			this.requirements.map((req) => [req.id, req]),
		);
		this.result.forEach((v, k) => {
			const requirement = requirementsById.get(k);
			out[k] =
				requirement?.type === "textarea"
					? this.escapeBackslashes(v)
					: v;
		});
		this.close();
		this.resolvePromise(out);
	}

	private escapeBackslashes(input: string): string {
		return input.replace(/\\/g, "\\\\");
	}

	private cancel() {
		this.close();
		this.rejectPromise("cancelled");
	}

	private async updatePreviews() {
		if (!this.computePreview || !this.previewContainerEl) return;
		try {
			const values: Record<string, string> = {};
			this.result.forEach((v, k) => (values[k] = v));
			const preview = await this.computePreview(values);
			// Clear old preview lines (leave the label at index 0)
			const children = Array.from(this.previewContainerEl.children);
			for (let i = 1; i < children.length; i++) {
				children[i].remove();
			}
			Object.entries(preview).forEach(([k, v]) => {
				const row = this.previewContainerEl!.createDiv();
				row.style.display = "flex";
				row.style.gap = "0.5rem";
				row.createEl("div", {
					text: `${k}:`,
					cls: "qa-preview-key",
				}).style.fontWeight = "600";
				row.createEl("div", { text: String(v), cls: "qa-preview-val" });
			});
		} catch {
			// Ignore preview errors
		}
	}
}
