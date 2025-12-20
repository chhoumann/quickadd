import type { App, Debouncer } from "obsidian";
import { TextComponent, debounce } from "obsidian";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { createDatePicker, type DatePickerController } from "../date-picker/datePicker";
import { formatISODate, parseNaturalLanguageDate } from "../../utils/dateParser";
import { settingsStore } from "../../settingsStore";
import {
	formatDateAliasInline,
	getOrderedDateAliases,
} from "../../utils/dateAliases";

export default class VDateInputPrompt extends GenericInputPrompt {
	private previewEl: HTMLElement;
	private dateFormat: string;
	private updatePreviewDebounced: Debouncer<[], void>;
	private currentInput: string;
	private isOpen = true;
	private defaultValue: string | undefined;
	private datePicker?: DatePickerController;
	private selectedIso?: string;
	private lastPickerDisplayValue?: string;
	private static readonly PREVIEW_PLACEHOLDER = "Preview will appear here";

	public static Prompt(
		app: App,
		header: string,
		placeholder?: string,
		defaultValue?: string,
		dateFormat?: string
	): Promise<string> {
		const newPromptModal = new VDateInputPrompt(
			app,
			header,
			placeholder,
			defaultValue,
			dateFormat
		);
		return newPromptModal.waitForClose;
	}

	protected constructor(
		app: App,
		header: string,
		placeholder?: string,
		defaultValue?: string,
		dateFormat?: string
	) {
		// Pass the defaultValue to the parent so the input box is pre-filled
		super(app, header, placeholder, defaultValue ?? "");

		this.containerEl.addClass("qaDatePrompt");
		this.dateFormat = dateFormat || "YYYY-MM-DD";
		this.defaultValue = defaultValue;
		this.currentInput = defaultValue ?? "";

		// Create debounced preview update function (250ms delay, reset on each call)
		this.updatePreviewDebounced = debounce(
			this.updatePreview.bind(this),
			250,
			true // Reset timer on each call (standard debounce behavior)
		);

		this.updatePreview();
	}

	protected createInputField(
		container: HTMLElement,
		placeholder?: string,
		value?: string
	) {
		container.addClass("qa-date-input");

		// Create TextComponent directly to avoid duplicate onChange listeners
		const textComponent = new TextComponent(container);
		
		textComponent.inputEl.style.width = "100%";
		textComponent
			.setPlaceholder(placeholder ?? "")
			.setValue(value ?? "")
			.onChange((newValue) => {
				this.lastPickerDisplayValue = undefined;
				this.onInputChanged(newValue);
				this.currentInput = newValue;
				this.updatePreviewDebounced();
			})
			.inputEl.addEventListener("keydown", this.submitEnterCallback);
		
		// Initialize currentInput with the initial value (which should be defaultValue)
		this.currentInput = value ?? "";

		this.createDatePicker(container);

		// Create preview element
		this.createPreviewElement(container);

		return textComponent;
	}

	private createDatePicker(container: HTMLElement) {
		const pickerContainer = container.createDiv({
			cls: "qa-date-picker-container",
		});

		this.datePicker = createDatePicker({
			container: pickerContainer,
			initialIso: this.selectedIso,
			onSelect: (iso) => {
				if (iso) this.applyPickerSelection(iso);
				else this.clearPickerSelection();
			},
		});
	}

	private createPreviewElement(container: HTMLElement) {
		const previewContainer = container.createDiv("vdate-preview-container");
		previewContainer.style.marginTop = "0.5rem";
		previewContainer.style.padding = "0.5rem";
		previewContainer.style.backgroundColor = "var(--background-modifier-form-field)";
		previewContainer.style.borderRadius = "4px";
		previewContainer.style.fontSize = "0.9em";
		
		const previewLabel = previewContainer.createEl("div", {
			text: "Preview:",
			cls: "vdate-preview-label"
		});
		previewLabel.style.fontWeight = "600";
		previewLabel.style.marginBottom = "0.25rem";
		previewLabel.style.color = "var(--text-muted)";
		
		this.previewEl = previewContainer.createEl("div", {
			cls: "vdate-preview-text"
		});
		this.previewEl.style.fontFamily = "var(--font-monospace)";
		this.previewEl.textContent = VDateInputPrompt.PREVIEW_PLACEHOLDER;
		this.previewEl.style.color = "var(--text-normal)";

		const aliasEntries = getOrderedDateAliases(
			settingsStore.getState().dateAliases,
		);
		if (aliasEntries.length > 0) {
			const aliasDetails = previewContainer.createEl("details", {
				cls: "vdate-alias-details",
			});
			aliasDetails.style.marginTop = "0.25rem";

			const aliasSummary = aliasDetails.createEl("summary", {
				text: `Aliases (${aliasEntries.length})`,
			});
			aliasSummary.style.fontSize = "0.85em";
			aliasSummary.style.color = "var(--text-muted)";

			const aliasList = aliasDetails.createEl("div", {
				cls: "vdate-alias-list",
			});
			aliasList.textContent = formatDateAliasInline(
				settingsStore.getState().dateAliases,
			);
			aliasList.style.marginTop = "0.25rem";
			aliasList.style.fontSize = "0.85em";
			aliasList.style.color = "var(--text-muted)";
			aliasList.style.fontFamily = "var(--font-monospace)";
		}
	}

	private updatePreview() {
		// Don't update if modal is closed
		if (!this.isOpen) return;

		const input = this.currentInput.trim();

		// If no input and we have a default, show preview for default
		if (!input && this.defaultValue) {
			this.renderPreviewFromInput(this.defaultValue);
			return;
		}

		if (!input) {
			this.selectedIso = undefined;
			this.lastPickerDisplayValue = undefined;
			this.syncPickerSelection();
			this.setPreviewText(VDateInputPrompt.PREVIEW_PLACEHOLDER, false);
			return;
		}

		if (input.startsWith("@date:")) {
			const iso = input.slice(6).trim();
			if (iso) {
				this.selectedIso = iso;
				this.lastPickerDisplayValue = undefined;
				this.syncPickerSelection(iso);
				this.renderPreviewFromIso(iso);
				return;
			}
		}

		if (
			this.selectedIso &&
			this.lastPickerDisplayValue &&
			input === this.lastPickerDisplayValue
		) {
			this.syncPickerSelection(this.selectedIso, false);
			this.renderPreviewFromIso(this.selectedIso);
			return;
		}

		// If input matches default value or regular input, render the preview
		this.renderPreviewFromInput(input);
	}

	private formatIsoForInput(iso: string): string {
		const formatted = formatISODate(iso, this.dateFormat);
		if (formatted) return formatted;
		return iso.length >= 10 ? iso.slice(0, 10) : iso;
	}

	private syncPickerSelection(iso?: string, updateView = true) {
		this.datePicker?.setSelectedIso(iso, { updateView });
	}

	private applyPickerSelection(iso: string) {
		const displayValue = this.formatIsoForInput(iso);
		this.selectedIso = iso;
		this.lastPickerDisplayValue = displayValue;
		if (this.inputComponent?.inputEl) {
			this.inputComponent.inputEl.value = displayValue;
		}
		this.onInputChanged(displayValue);
		this.currentInput = displayValue;
		this.syncPickerSelection(iso);
		this.renderPreviewFromIso(iso);
	}

	private clearPickerSelection() {
		if (this.inputComponent?.inputEl) {
			this.inputComponent.inputEl.value = "";
		}
		this.onInputChanged("");
		this.currentInput = "";
		this.selectedIso = undefined;
		this.lastPickerDisplayValue = undefined;
		this.syncPickerSelection();
		this.updatePreview();
	}

	private renderPreviewFromIso(iso: string) {
		this.setPreviewText(this.formatIsoForInput(iso), false);
	}

	private renderPreviewFromInput(value: string) {
		const parseResult = parseNaturalLanguageDate(value, this.dateFormat);

		if (parseResult.isValid && parseResult.isoString) {
			this.selectedIso = parseResult.isoString;
			this.lastPickerDisplayValue = undefined;
			this.syncPickerSelection(parseResult.isoString);
			const formatted =
				parseResult.formatted ?? this.formatIsoForInput(parseResult.isoString);
			this.setPreviewText(formatted, false);
		} else {
			this.selectedIso = undefined;
			this.lastPickerDisplayValue = undefined;
			this.syncPickerSelection();
			const errorMessage = parseResult.error || "Unable to parse date";
			this.setPreviewText(errorMessage, true);
		}
	}

	private setPreviewText(text: string, isError: boolean) {
		this.previewEl.textContent = text;

		if (isError) {
			this.previewEl.style.color = "var(--text-error)";
		} else {
			this.previewEl.style.color = "var(--text-normal)";
		}
	}

	onOpen() {
		super.onOpen();
	}

	protected transformInputOnSubmit(input: string): string {
		const trimmed = input.trim();
		if (trimmed.startsWith("@date:")) return trimmed;
		if (
			this.selectedIso &&
			this.lastPickerDisplayValue &&
			trimmed === this.lastPickerDisplayValue
		) {
			return `@date:${this.selectedIso}`;
		}
		if (!trimmed && this.defaultValue) {
			const parsed = parseNaturalLanguageDate(
				this.defaultValue,
				this.dateFormat,
			);
			if (parsed.isValid && parsed.isoString) {
				return `@date:${parsed.isoString}`;
			}
		}
		if (trimmed) {
			const parsed = parseNaturalLanguageDate(trimmed, this.dateFormat);
			if (parsed.isValid && parsed.isoString) {
				return `@date:${parsed.isoString}`;
			}
		}
		return input;
	}

	onClose() {
		// Prevent any pending debounced updates
		this.isOpen = false;

		// Cancel any pending debounced calls
		this.updatePreviewDebounced.cancel();

		// If input is empty and we have a default, use the default
		if (!this.input.trim() && this.defaultValue) {
			this.input = this.defaultValue;
		}

		super.onClose();
	}
}
