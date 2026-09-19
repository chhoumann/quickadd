import { DropdownComponent, Setting, TextAreaComponent, TextComponent, type App } from "obsidian";
import { FIELD_VARIABLE_PREFIX } from "src/constants";
import { createDatePicker } from "src/gui/date-picker/datePicker";
import { FieldValueInputSuggest } from "src/gui/suggesters/FieldValueInputSuggest";
import { FilePickerInputSuggest, type FilePickerOption } from "src/gui/suggesters/FilePickerInputSuggest";
import { SuggesterInputSuggest } from "src/gui/suggesters/SuggesterInputSuggest";
import { formatISODate, parseNaturalLanguageDate } from "src/utils/dateParser";
import { formatDateAliasInline, getOrderedDateAliases } from "src/utils/dateAliases";
import { settingsStore } from "src/settingsStore";
import { normalizeNumericValue, normalizeSliderValue } from "src/utils/valueSyntax";
import { decodeFileValue } from "src/utils/fileSyntax";
import type { FieldRequirement } from "./RequirementCollector";
import { mapMappedSuggesterValue, resolveDropdownInitialValue } from "./suggesterValueMapping";

type CompletionInputEvent = Event & { fromCompletion?: boolean };

export interface FieldControl {
	requirement: FieldRequirement;
	elements: HTMLElement[];
	value: string;
	multiSelections?: string[];
	fileSelections?: string[];
	dateParseError: boolean;
	suggesters: Array<{ close(): void; destroy(): void }>;
	dispose: Array<() => void>;
}

interface FieldRendererHost {
	controlFor(requirement: FieldRequirement): FieldControl;
	initialValue(id: string): string | undefined;
	publish(control: FieldControl): void;
	updatePreview(): void;
	decorateLabel(requirement: FieldRequirement): string | DocumentFragment;
	attachFreeText(requirement: FieldRequirement, input: HTMLInputElement | HTMLTextAreaElement, setting: Setting): void;
}

export class OnePageFieldRenderer {
	constructor(
		private readonly app: App,
		private readonly contentEl: HTMLElement,
		private readonly host: FieldRendererHost,
	) {}

	private setting(req: FieldRequirement, describe = true): Setting {
		const setting = new Setting(this.contentEl).setName(this.host.decorateLabel(req));
		if (describe && req.description) setting.setDesc(req.description);
		return setting;
	}

	render(req: FieldRequirement) {
		const control = this.host.controlFor(req);
		const setValue = (_id: string, value: string) => {
			control.value = value;
			this.host.publish(control);
			this.host.updatePreview();
		};
		const starting = this.host.initialValue(req.id) ?? req.defaultValue ?? "";
		control.value = starting;

		switch (req.type) {
			case "textarea":
			case "text": {
				const setting = this.setting(req);
				const input = req.type === "textarea"
					? new TextAreaComponent(setting.controlEl)
					: new TextComponent(setting.controlEl);
				input.setPlaceholder(req.placeholder ?? "").setValue(starting)
					.onChange((value) => setValue(req.id, value));
				if (req.type === "textarea") input.inputEl.addClass("qa-onepage-textarea");
				this.host.attachFreeText(req, input.inputEl, setting);
				break;
			}
			case "number": {
				// |type:number — a numeric input so the one-page form rejects
				// non-numeric text like the runtime NumberInputPrompt does.
				const setting = this.setting(req);
				const input = new TextComponent(setting.controlEl);
				input.inputEl.type = "number";
				input.inputEl.inputMode = "decimal";
				if (req.numericConfig?.min !== undefined) {
					input.inputEl.min = String(req.numericConfig.min);
				}
				if (req.numericConfig?.max !== undefined) {
					input.inputEl.max = String(req.numericConfig.max);
				}
				input.inputEl.step =
					req.numericConfig?.step !== undefined
						? String(req.numericConfig.step)
						: "any";
				const normalizedStarting = req.numericConfig
					? normalizeNumericValue(starting, req.numericConfig)
					: starting;
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(normalizedStarting)
					.onChange((v) =>
						setValue(
							req.id,
							req.numericConfig ? normalizeNumericValue(v, req.numericConfig) : v,
						),
					);
				setValue(req.id, normalizedStarting);
				break;
			}
			case "slider": {
				const setting = this.setting(req);
				setting.controlEl.parentElement?.addClass(
					"qa-onepage-slider-setting",
				);
				const sliderConfig = req.sliderConfig ?? { min: 0, max: 100, step: 1 };
				const isOptionalBlank = req.optional && starting === "";
				const initial = normalizeSliderValue(starting, sliderConfig);
				const container = setting.controlEl.createDiv({
					cls: "qa-onepage-slider",
				});
				const range = container.createEl("input");
				range.type = "range";
				range.min = String(sliderConfig.min);
				range.max = String(sliderConfig.max);
				range.step = String(sliderConfig.step);
				range.value = initial;
				const input = new TextComponent(container);
				input.inputEl.type = "number";
				input.inputEl.inputMode = "decimal";
				input.inputEl.min = String(sliderConfig.min);
				input.inputEl.max = String(sliderConfig.max);
				input.inputEl.step = String(sliderConfig.step);
				input.setValue(isOptionalBlank ? "" : initial);
				setValue(req.id, isOptionalBlank ? "" : initial);

				range.addEventListener("input", () => {
					input.inputEl.value = range.value;
					setValue(req.id, range.value);
				});
				input.onChange((value) => {
					if (value === "" && req.optional) {
						setValue(req.id, "");
						return;
					}
					const normalized = normalizeNumericValue(value, sliderConfig);
					if (normalized === "") return;
					range.value = normalized;
					input.inputEl.value = normalized;
					setValue(req.id, normalized);
				});
				break;
			}
			case "dropdown": {
				const setting = this.setting(req);
				const dropdown = new DropdownComponent(setting.controlEl);
				const options = req.options ?? [];
				const displayOptions = req.displayOptions ?? options;
				if (options.length > 0) {
					// Optional dropdowns offer an explicit skip entry, but the
					// first real option stays preselected: adding |optional must
					// not silently change what an untouched submit yields.
					if (req.optional) {
						dropdown.addOption("", "Skip (leave empty)");
					}
					options.forEach((opt, index) => {
						const display = displayOptions[index] ?? opt;
						dropdown.addOption(opt, display);
					});
					const selectedValue = resolveDropdownInitialValue(starting, options);
					dropdown.setValue(selectedValue);
					setValue(req.id, selectedValue);
					dropdown.onChange((v) => setValue(req.id, v));
				} else {
					dropdown.setDisabled(true);
					const note = setting.controlEl.createDiv({
						text: req.placeholder || "No options available",
					});
					note.addClass("qa-onepage-dropdown-note");
				}
				break;
			}
			case "date": {
				const setting = this.setting(req);
				// The input, calendar, and parsed preview do not fit beside the
				// label the way a lone text box does, so this row stacks.
				setting.settingEl.addClass("qa-onepage-date-setting");
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

				const preview = container.createDiv();
				preview.addClass("qa-date-preview-text");

				const pickerContainer = container.createDiv({
					cls: "qa-date-picker-container",
				});
				const datePicker = createDatePicker({
					container: pickerContainer,
					initialIso: selectedIso,
					withTime: req.withTime === true,
					onSelect: (iso) => {
						if (iso) applyPickerSelection(iso);
						else clearPickerSelection();
					},
				});

				control.dispose.push(() => datePicker.destroy());

				const aliasEntries = getOrderedDateAliases(
					settingsStore.getState().dateAliases,
				);
				if (aliasEntries.length > 0) {
					const aliasDetails = container.createEl("details");
					aliasDetails.addClass("qa-date-alias-details");

					const aliasSummary = aliasDetails.createEl("summary", {
						text: `Aliases (${aliasEntries.length})`,
					});
					aliasSummary.addClass("qa-date-alias-summary");

					const aliasList = aliasDetails.createDiv();
					aliasList.textContent = formatDateAliasInline(
						settingsStore.getState().dateAliases,
					);
					aliasList.addClass("qa-date-alias-list");
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
					preview.toggleClass("is-error", isError);
				};

				const syncSelection = (iso?: string) => {
					datePicker.setSelectedIso(iso);
				};

				const applyPickerSelection = (iso: string) => {
					control.dateParseError = false;
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

				const parseAndPublish = (value: string) => {
					const parsed = parseNaturalLanguageDate(value, req.dateFormat);
					const iso = parsed.isValid ? parsed.isoString : undefined;
					control.dateParseError = !iso;
					setValue(req.id, iso ? `@date:${iso}` : "");
					syncSelection(iso);
					renderPreview(
						iso ? (parsed.formatted ?? formatIsoForDisplay(iso)) : (parsed.error || "Unable to parse date"),
						!iso,
					);
				};

				const updatePreview = (val: string) => {
					const inputVal = (val ?? "").trim();
					// Clearing an optional date must not resurrect its default.
					if (!inputVal && req.defaultValue && !req.optional) {
						parseAndPublish(req.defaultValue);
						return;
					}
					if (!inputVal) {
						control.dateParseError = false;
						setValue(req.id, "");
						syncSelection();
						renderPreview(req.optional ? "Will be left empty" : "Preview will appear here", false);
						return;
					}
					if (inputVal.startsWith("@date:")) {
						const iso = inputVal.slice(6).trim();
						if (iso) {
							applyPickerSelection(iso);
							return;
						}
					}
					parseAndPublish(inputVal);
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
				const setting = this.setting(req);
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				// Attach inline suggester powered by vault data & filters encoded in
				// req.id. Collected FIELD requirements are keyed "FIELD:<specifier>";
				// strip the prefix so the suggester parses the bare field specifier.
				const fieldSpecifier = req.id.startsWith(FIELD_VARIABLE_PREFIX)
					? req.id.slice(FIELD_VARIABLE_PREFIX.length)
					: req.id;
				try {
					control.suggesters.push(new FieldValueInputSuggest(this.app, input.inputEl, fieldSpecifier));
				} catch {
					// Non-fatal; leave as plain input if suggester fails
				}
				break;
			}
			case "suggester": {
				const setting = this.setting(req);
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
					const fromCompletion = Boolean(
						(event as CompletionInputEvent).fromCompletion,
					);
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
						control.suggesters.push(new SuggesterInputSuggest(
							this.app,
							input.inputEl,
							displayOptions,
							caseSensitive,
							multiSelect,
							multiSelect
								? (item) => {
										const arr = control.multiSelections ?? [];
										arr.push(item);
										control.multiSelections = arr;
										this.host.publish(control);
									}
								: undefined,
						));
					} catch {
						// Non-fatal; falls back to plain text input
					}
				}
				break;
			}
			case "file-picker": {
				this.renderFilePickerField(req, starting, setValue);
				break;
			}
			default: {
				const setting = this.setting(req, false);
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				this.host.attachFreeText(req, input.inputEl, setting);
			}
		}

		// Initialize stored value for empty inputs to ensure presence
		this.host.publish(control);
	}

	private renderFilePickerField(
		req: FieldRequirement,
		starting: string,
		setValue: (id: string, value: string) => void,
	): void {
		const setting = this.setting(req);
		setting.settingEl.addClass("qa-onepage-file-picker-setting");

		const values = req.options ?? [];
		const displayValues = req.displayOptions ?? values;
		const options: FilePickerOption[] = values.map((value, index) => {
			const decoded = decodeFileValue(value);
			return {
				value,
				label: displayValues[index] ?? value,
				path: decoded.kind === "file" ? decoded.path : value,
			};
		});
		const optionByValue = new Map(options.map((option) => [option.value, option]));
		const multiSelect = req.suggesterConfig?.multiSelect ?? false;
		const allowCustomInput =
			req.suggesterConfig?.allowCustomInput ?? false;
		const selected = new Set<string>();
		const customOptions = new Map<string, FilePickerOption>();

		const addCustomOption = (value: string): FilePickerOption => {
			const existing = customOptions.get(value);
			if (existing) return existing;
			const option = {
				value,
				label: value,
				path: "Custom value",
				isCustom: true,
			};
			customOptions.set(value, option);
			return option;
		};

		if (starting && optionByValue.has(starting)) {
			selected.add(starting);
		} else if (starting && allowCustomInput) {
			const decoded = decodeFileValue(starting);
			const customValue =
				decoded.kind === "custom" ? decoded.text : starting;
			addCustomOption(customValue);
			selected.add(customValue);
		} else if (!multiSelect && options.length > 0) {
			// Preserve the former dropdown's untouched-submit behavior. The first
			// file stays selected by default, but is now visible and removable.
			selected.add(options[0].value);
		}

		const container = setting.controlEl.createDiv({
			cls: "qa-onepage-file-picker",
		});
		const selectionEl = container.createDiv({
			cls: "qa-onepage-file-picker__selection",
		});
		selectionEl.setAttribute("aria-live", "polite");
		const input = new TextComponent(container);
		input.inputEl.addClass("qa-onepage-file-picker__input");
		input.setPlaceholder(
			req.placeholder ??
				(multiSelect ? "Search and add files..." : "Search files..."),
		);
		input.inputEl.setAttribute(
			"aria-label",
			multiSelect ? `Add files for ${req.label}` : `Choose file for ${req.label}`,
		);

		const orderedSelections = (): FilePickerOption[] => {
			const ordered = options.filter((option) => selected.has(option.value));
			for (const option of customOptions.values()) {
				if (selected.has(option.value)) ordered.push(option);
			}
			return ordered;
		};

		const sync = () => {
			const picked = orderedSelections();
			const pickedValues = picked.map((option) => option.value);
			this.host.controlFor(req).fileSelections = pickedValues;
			setValue(
				req.id,
				multiSelect ? pickedValues.join(", ") : (pickedValues[0] ?? ""),
			);

			selectionEl.empty();
			selectionEl.toggleClass("qa-hidden", picked.length === 0);
			for (const option of picked) {
				const chip = selectionEl.createDiv({
					cls: "qa-onepage-file-picker__chip",
				});
				chip.setAttribute("title", option.path);
				chip.createSpan({
					cls: "qa-onepage-file-picker__chip-label",
					text: option.label,
				});
				const remove = chip.createEl("button", {
					cls: "qa-onepage-file-picker__remove",
					text: "×",
				});
				remove.type = "button";
				remove.setAttribute("aria-label", `Remove ${option.label}`);
				remove.addEventListener("click", () => {
					selected.delete(option.value);
					sync();
					input.inputEl.focus();
				});
			}
		};

		const selectOption = (option: FilePickerOption) => {
			const selectedOption = option.isCustom
				? addCustomOption(option.value)
				: option;
			if (!multiSelect) selected.clear();
			selected.add(selectedOption.value);
			sync();
		};

		input.inputEl.addEventListener("keydown", (event) => {
			if (
				event.key === "Backspace" &&
				input.inputEl.value === "" &&
				selected.size > 0
			) {
				const last = orderedSelections().at(-1);
				if (!last) return;
				event.preventDefault();
				selected.delete(last.value);
				sync();
			}
		});

		try {
			const suggester = new FilePickerInputSuggest(
				this.app,
				input.inputEl,
				() => [...options, ...customOptions.values()],
				(value) => selected.has(value),
				selectOption,
				multiSelect,
				allowCustomInput,
			);
			this.host.controlFor(req).suggesters.push(suggester);
		} catch {
			// A failed suggester should not break the rest of the one-page form.
			input.setDisabled(true);
		}

		sync();
	}

}
