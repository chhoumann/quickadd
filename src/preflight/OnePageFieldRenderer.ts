import { DropdownComponent, Setting, TextAreaComponent, TextComponent, type App } from "obsidian";
import { FIELD_VARIABLE_PREFIX } from "src/constants";
import { attachCalendarToggle, createDatePicker } from "src/gui/date-picker/datePicker";
import { FieldValueInputSuggest } from "src/gui/suggesters/FieldValueInputSuggest";
import { FieldLinkInputSuggest, type FieldLinkPick } from "src/gui/suggesters/FieldLinkInputSuggest";
import { FilePickerInputSuggest, type FilePickerOption } from "src/gui/suggesters/FilePickerInputSuggest";
import {
	customSuggesterOption,
	labelsMatch,
	SuggesterInputSuggest,
	type SuggesterOption,
} from "src/gui/suggesters/SuggesterInputSuggest";
import { normalizeDisplayItem } from "src/gui/suggesters/utils";
import { formatISODate, parseNaturalLanguageDate } from "src/utils/dateParser";
import { formatDateAliasInline, getOrderedDateAliases } from "src/utils/dateAliases";
import { settingsStore } from "src/settingsStore";
import { normalizeNumericValue, normalizeSliderValue } from "src/utils/valueSyntax";
import { decodeFileValue, fileBasenameFromPath } from "src/utils/fileSyntax";
import { normalizeGeneratedFilePath } from "src/utils/generatedFilePath";
import type { FieldRequirement } from "./RequirementCollector";
import { resolveDropdownInitialValue } from "./suggesterValueMapping";

type CompletionInputEvent = Event & { fromCompletion?: boolean };

export interface FieldControl {
	requirement: FieldRequirement;
	elements: HTMLElement[];
	value: string;
	multiSelections?: string[];
	fileSelections?: string[];
	/** A link FIELD's picked links, in pick order. */
	fieldLinkSelections?: string[];
	dateParseError: boolean;
	suggesters: Array<{ close(): void; destroy(): void }>;
	dispose: Array<() => void>;
	commitDraft?: () => void;
	validate?: () => string | null;
}

interface FieldRendererHost {
	controlFor(requirement: FieldRequirement): FieldControl;
	initialValue(id: string): string | undefined;
	publish(control: FieldControl): void;
	updatePreview(): void;
	decorateLabel(requirement: FieldRequirement): string | DocumentFragment;
	attachFreeText(requirement: FieldRequirement, input: HTMLInputElement | HTMLTextAreaElement): void;
}

function labelId(req: FieldRequirement): string {
	// Encoded: an id with a space would read as two references in aria-labelledby.
	return `qa-onepage-label-${encodeURIComponent(req.id)}`;
}

export class OnePageFieldRenderer {
	constructor(
		private readonly app: App,
		private readonly contentEl: HTMLElement,
		private readonly host: FieldRendererHost,
	) {}

	// The Setting of the field being rendered, so its controls can be named
	// after the label once created.
	private fieldSetting?: Setting;

	private setting(req: FieldRequirement, describe = true): Setting {
		const setting = new Setting(this.contentEl).setName(this.host.decorateLabel(req));
		setting.nameEl.id = labelId(req);
		if (describe && req.description) setting.setDesc(req.description);
		this.fieldSetting = setting;
		return setting;
	}

	// Name the field's controls after its label, unless they carry their own name.
	private labelControls(req: FieldRequirement): void {
		this.fieldSetting?.controlEl
			.querySelectorAll("input:not([aria-label]), textarea:not([aria-label]), select:not([aria-label])")
			.forEach((el) => el.setAttribute("aria-labelledby", labelId(req)));
		this.fieldSetting = undefined;
	}

	render(req: FieldRequirement) {
		const control = this.host.controlFor(req);
		const setValue = (_id: string, value: string) => {
			control.value = value;
			this.host.publish(control);
			this.host.updatePreview();
		};
		const providedStarting = this.host.initialValue(req.id) ?? req.defaultValue;
		const starting = providedStarting ?? "";
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
				this.host.attachFreeText(req, input.inputEl);
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
				const field = container.createDiv({ cls: "qa-date-field" });
				const input = new TextComponent(field);
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
				control.dispose.push(attachCalendarToggle(field, pickerContainer));

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
				const fieldSpecifier = this.fieldSpecifierOf(req);
				if (req.fieldLink) {
					this.renderFieldLinkField(req, req.fieldLink, fieldSpecifier, starting, setValue);
					break;
				}
				const setting = this.setting(req);
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				try {
					control.suggesters.push(new FieldValueInputSuggest(this.app, input.inputEl, fieldSpecifier));
				} catch {
					// Non-fatal; leave as plain input if suggester fails
				}
				break;
			}
			case "suggester": {
				if (req.suggesterConfig?.multiSelect) this.renderMultiSuggesterField(req, control, setValue);
				else this.renderSuggesterField(req, providedStarting, control, setValue);
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
				this.host.attachFreeText(req, input.inputEl);
			}
		}

		this.labelControls(req);
		// Initialize stored value for empty inputs to ensure presence
		this.host.publish(control);
	}

	/**
	 * Whether a typed name or path names a note the field's notes ("scope") or
	 * the vault ("vault") already has, read the way the capture reads it
	 * (CaptureTargetEngine: captureTargetExists, captureTargetAlreadyExists).
	 */
	private noteNameExists(within: "scope" | "vault", paths: string[]): (value: string) => boolean {
		const notePaths = within === "vault" ? this.app.vault.getMarkdownFiles().map((file) => file.path) : paths;
		const names = new Set(notePaths.map((path) => fileBasenameFromPath(path).toLowerCase()));
		return (value) => {
			let path: string;
			try {
				path = normalizeGeneratedFilePath(value, "Capture target file path");
			} catch {
				return false;
			}
			const base = path.replace(/\.(md|canvas)$/i, "");
			if (names.has(base.slice(base.lastIndexOf("/") + 1).toLowerCase())) return true;
			return within === "vault" &&
				[path, `${base}.md`, `${base}.canvas`].some((candidate) => !!this.app.vault.getAbstractFileByPath(candidate));
		};
	}

	private renderSuggesterField(
		req: FieldRequirement,
		starting: string | undefined,
		control: FieldControl,
		setValue: (id: string, value: string) => void,
	): void {
		const setting = this.setting(req);
		const options = suggesterOptions(req);
		const allowCustomInput = req.suggesterConfig?.allowCustomInput ?? true;
		const caseSensitive = req.suggesterConfig?.caseSensitive ?? false;
		const input = new TextComponent(setting.controlEl);
		input.setPlaceholder(req.placeholder ?? "Type to search...");

		const startingOption = starting !== undefined ? options.find((option) => option.value === starting) : undefined;
		const initialText = starting ?? "";
		input.setValue(startingOption?.label ?? initialText);

		if (allowCustomInput) {
			setValue(req.id, startingOption?.value ?? initialText);
			input.inputEl.addEventListener("input", (event) => {
				if ((event as CompletionInputEvent).fromCompletion) return;
				setValue(req.id, input.inputEl.value);
			});
			if (options.length === 0) return;
			control.suggesters.push(new SuggesterInputSuggest(this.app, input.inputEl, {
				getOptions: () => options,
				onSelect: (option) => setValue(req.id, option.value),
				caseSensitive,
				renderOption: req.renderOption,
			}));
			return;
		}

		let pickedOption: SuggesterOption | undefined = startingOption;
		let unmatched = false;
		const matchTypedOption = (text: string) => {
			pickedOption = text ? options.find((option) => labelsMatch(option.label, text, caseSensitive)) : undefined;
			unmatched = text !== "" && !pickedOption;
			setValue(req.id, pickedOption?.value ?? "");
		};
		if (startingOption) setValue(req.id, startingOption.value);
		else matchTypedOption(initialText);

		input.inputEl.addEventListener("input", (event) => {
			if ((event as CompletionInputEvent).fromCompletion) return;
			matchTypedOption(input.inputEl.value);
		});
		control.validate = () =>
			unmatched || (!req.optional && !pickedOption)
				? `QuickAdd: Choose an option for "${req.label}".`
				: null;
		if (options.length === 0) return;
		control.suggesters.push(new SuggesterInputSuggest(this.app, input.inputEl, {
			getOptions: () => options,
			onSelect: (option) => {
				pickedOption = option;
				unmatched = false;
				setValue(req.id, option.value);
			},
			caseSensitive,
			renderOption: req.renderOption,
		}));
	}

	private renderMultiSuggesterField(
		req: FieldRequirement,
		control: FieldControl,
		setValue: (id: string, value: string) => void,
	): void {
		const setting = this.setting(req);
		setting.settingEl.addClass("qa-onepage-multi-suggester-setting");
		const options = suggesterOptions(req);
		const allowCustomInput = req.suggesterConfig?.allowCustomInput ?? true;
		const caseSensitive = req.suggesterConfig?.caseSensitive ?? false;
		const separator = req.suggesterConfig?.separator ?? ", ";
		const selected: SuggesterOption[] = [];
		const isSelected = (option: SuggesterOption) =>
			option.isCustom
				? selected.some((pick) => labelsMatch(pick.label, option.label, caseSensitive))
				: selected.some((pick) => pick.key === option.key);
		const add = (option: SuggesterOption) => {
			if (!isSelected(option)) selected.push(option);
		};

		const seed = this.host.initialValue(req.id) ?? req.defaultValues ?? req.defaultValue;
		for (const initialPick of resolveSeededMultiPicks(seed, options, {
			allowCustomInput,
			caseSensitive,
			separator,
		})) {
			add(initialPick);
		}

		const container = setting.controlEl.createDiv({ cls: "qa-onepage-multi-suggester" });
		const selectionEl = container.createDiv({ cls: "qa-onepage-multi-suggester__selection" });
		selectionEl.setAttribute("aria-live", "polite");
		const input = new TextComponent(container);
		input.inputEl.addClass("qa-onepage-multi-suggester__input");
		input.setPlaceholder(
			req.placeholder ?? (allowCustomInput ? "Search or type to add..." : "Search and select..."),
		);

		let suggester: SuggesterInputSuggest | undefined;
		const sync = () => {
			const values = selected.map((option) => option.value);
			control.multiSelections = values;
			setValue(req.id, values.join(separator));

			selectionEl.empty();
			selectionEl.toggleClass("qa-hidden", selected.length === 0);
			for (const option of selected) {
				const chip = selectionEl.createDiv({ cls: "qa-onepage-multi-suggester__chip" });
				chip.createSpan({ cls: "qa-onepage-multi-suggester__chip-label", text: option.label });
				const remove = chip.createEl("button", { cls: "qa-onepage-multi-suggester__remove", text: "×" });
				remove.type = "button";
				remove.setAttribute("aria-label", `Remove ${option.label}`);
				remove.addEventListener("click", () => {
					selected.splice(selected.indexOf(option), 1);
					sync();
					input.inputEl.focus();
					suggester?.refresh();
				});
			}
		};

		suggester = new SuggesterInputSuggest(this.app, input.inputEl, {
			getOptions: () => options,
			onSelect: (option) => {
				add(option);
				sync();
			},
			caseSensitive,
			multiSelect: true,
			allowCustomInput,
			isSelected,
			renderOption: req.renderOption,
		});
		control.suggesters.push(suggester);

		input.inputEl.addEventListener("keydown", (event) => {
			if (event.isComposing) return;
			if (event.key === "Backspace" && input.inputEl.value === "" && selected.length > 0) {
				event.preventDefault();
				selected.pop();
				sync();
				suggester?.refresh();
			}
		});

		control.commitDraft = () => {
			const text = input.inputEl.value.trim();
			if (!text) return;
			const option =
				options.find((candidate) => !isSelected(candidate) && labelsMatch(candidate.label, text, caseSensitive)) ??
				options.find((candidate) => labelsMatch(candidate.label, text, caseSensitive));
			if (option) add(option);
			else if (!allowCustomInput) return;
			else if (!selected.some((pick) => labelsMatch(pick.label, text, caseSensitive))) {
				add(customSuggesterOption(text));
			}
			input.inputEl.value = "";
			sync();
		};

		sync();
	}

	private fieldSpecifierOf(req: FieldRequirement): string {
		if (req.fieldSpecifier) return req.fieldSpecifier;
		return req.id.startsWith(FIELD_VARIABLE_PREFIX)
			? req.id.slice(FIELD_VARIABLE_PREFIX.length)
			: req.id;
	}

	private renderFieldLinkField(
		req: FieldRequirement,
		fieldLink: NonNullable<FieldRequirement["fieldLink"]>,
		fieldSpecifier: string,
		starting: string,
		setValue: (id: string, value: string) => void,
	): void {
		const control = this.host.controlFor(req);
		const { multiSelect } = fieldLink;
		const setting = this.setting(req);
		setting.settingEl.addClass("qa-onepage-file-picker-setting");
		const container = setting.controlEl.createDiv({
			cls: "qa-onepage-file-picker qa-onepage-field-link-picker",
		});
		const selectionEl = container.createDiv({ cls: "qa-onepage-file-picker__selection" });
		selectionEl.setAttribute("aria-live", "polite");
		const input = new TextComponent(container);
		input.inputEl.addClass("qa-onepage-file-picker__input");
		input.setPlaceholder(req.placeholder ?? (multiSelect ? "Search and add notes..." : "Search notes..."));
		input.inputEl.setAttribute(
			"aria-label",
			multiSelect ? `Add notes for ${req.label}` : `Choose note for ${req.label}`,
		);

		const picks: FieldLinkPick[] = [];
		const sync = () => {
			control.fieldLinkSelections = picks.map((pick) => pick.value);
			setValue(req.id, control.fieldLinkSelections.join(", "));
			selectionEl.empty();
			selectionEl.toggleClass("qa-hidden", picks.length === 0);
			for (const pick of picks) {
				const chip = selectionEl.createDiv({ cls: "qa-onepage-file-picker__chip" });
				chip.toggleClass("is-unresolved", pick.unresolved);
				chip.setAttribute("title", pick.title ?? pick.value);
				chip.createSpan({ cls: "qa-onepage-file-picker__chip-label", text: pick.display });
				const remove = chip.createEl("button", { cls: "qa-onepage-file-picker__remove", text: "×" });
				remove.type = "button";
				remove.setAttribute("aria-label", `Remove ${pick.display}`);
				remove.addEventListener("click", () => {
					picks.splice(picks.indexOf(pick), 1);
					sync();
					input.inputEl.focus();
				});
			}
		};
		const add = (pick: FieldLinkPick) => {
			if (!pick.value || picks.some((picked) => picked.value === pick.value)) return;
			if (!multiSelect) picks.length = 0;
			picks.push(pick);
			sync();
		};

		const suggester = new FieldLinkInputSuggest(
			this.app,
			input.inputEl,
			fieldSpecifier,
			() => picks.map((pick) => pick.value),
			add,
			multiSelect,
		);
		control.suggesters.push(suggester);
		for (const value of multiSelect ? (fieldLink.defaultValues ?? []) : [starting]) {
			const pick = suggester.resolveTypedSync(value);
			if (pick) add(pick);
		}
		control.commitDraft = () => {
			const pick = suggester.resolveTypedSync(input.inputEl.value);
			if (!pick) return;
			add(pick);
			input.inputEl.value = "";
		};

		input.inputEl.addEventListener("keydown", (event) => {
			if (event.key !== "Backspace" || input.inputEl.value !== "" || picks.length === 0) return;
			event.preventDefault();
			picks.pop();
			sync();
		});

		sync();
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
				aliases: req.optionAliases?.[index],
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
				path: req.newNoteName ? "New note" : "Custom value",
				isCustom: true,
			};
			customOptions.set(value, option);
			return option;
		};

		// Only a provided value starts picked. The first file is not picked for
		// the user: an untouched Submit would capture into a note they never
		// chose, so a required picker blocks Submit until it has a pick.
		if (starting && optionByValue.has(starting)) {
			selected.add(starting);
		} else if (starting && allowCustomInput) {
			const decoded = decodeFileValue(starting);
			const customValue =
				decoded.kind === "custom" ? decoded.text : starting;
			addCustomOption(customValue);
			selected.add(customValue);
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
				req.newNoteName
					? this.noteNameExists(req.newNoteName, options.map((option) => option.path))
					: undefined,
			);
			this.host.controlFor(req).suggesters.push(suggester);
		} catch {
			// A failed suggester should not break the rest of the one-page form.
			input.setDisabled(true);
		}

		sync();
	}

}

function suggesterOptions(req: FieldRequirement): SuggesterOption[] {
	const labels = req.displayOptions ?? [];
	return (req.options ?? []).map((value, index) => ({
		key: `opt:${index}`,
		value,
		label: normalizeDisplayItem(labels[index] ?? value),
	}));
}

function resolveSeededMultiPicks(
	seed: string | readonly string[] | undefined,
	options: readonly SuggesterOption[],
	config: { allowCustomInput: boolean; caseSensitive: boolean; separator: string },
): SuggesterOption[] {
	if (seed === undefined) return [];
	const findOption = (text: string) =>
		options.find((option) => option.value === text) ??
		options.find((option) => labelsMatch(option.label, text, config.caseSensitive));

	if (typeof seed !== "string") {
		const picks: SuggesterOption[] = [];
		for (const value of seed) {
			const option = findOption(value);
			if (option) picks.push(option);
			else if (config.allowCustomInput && value.trim()) picks.push(customSuggesterOption(value.trim()));
		}
		return picks;
	}

	const rawExact = options.find((option) => option.value === seed);
	if (rawExact) return [rawExact];

	const trimmed = seed.trim();
	if (!trimmed) return [];
	const whole = findOption(trimmed);
	if (whole) return [whole];

	if (config.separator) {
		const candidates = joinCandidates(options);
		const matched = matchJoinedOptions(trimmed, candidates, config);
		if (matched) return matched;
		if (!config.allowCustomInput) {
			return extractKnownJoinedOptions(trimmed, candidates, config);
		}
	}

	return config.allowCustomInput ? [customSuggesterOption(trimmed)] : [];
}

type JoinCandidate = { text: string; option: SuggesterOption };

function joinCandidates(options: readonly SuggesterOption[]): JoinCandidate[] {
	return options
		.flatMap((option) =>
			option.value === option.label
				? [{ text: option.label, option }]
				: [{ text: option.value, option }, { text: option.label, option }],
		)
		.filter(({ text }) => text.length > 0)
		.sort((a, b) => b.text.length - a.text.length);
}

function advancePastSeparator(text: string, end: number, separator: string): number {
	if (end === text.length) return end;
	if (separator === ", ") {
		if (text[end] !== ",") return -1;
		let next = end + 1;
		while (next < text.length && /\s/.test(text[next])) next++;
		return next;
	}
	if (!text.startsWith(separator, end)) return -1;
	let next = end + separator.length;
	while (next < text.length && /\s/.test(text[next])) next++;
	return next;
}

function skipUnmatchedSegment(text: string, pos: number, separator: string): number {
	const delimiter = separator === ", " ? "," : separator;
	const index = text.indexOf(delimiter, pos);
	if (index < 0) return text.length;
	let next = index + delimiter.length;
	while (next < text.length && /\s/.test(text[next])) next++;
	return next;
}

function matchJoinedOptions(
	text: string,
	candidates: readonly JoinCandidate[],
	config: { caseSensitive: boolean; separator: string },
): SuggesterOption[] | null {
	const failed = new Set<number>();
	const solve = (pos: number): SuggesterOption[] | null => {
		if (pos === text.length) return [];
		if (failed.has(pos)) return null;
		for (const candidate of candidates) {
			const end = pos + candidate.text.length;
			if (end > text.length) continue;
			if (!labelsMatch(text.slice(pos, end), candidate.text, config.caseSensitive)) continue;
			const next = advancePastSeparator(text, end, config.separator);
			if (next < 0) continue;
			const tail = solve(next);
			if (tail) return [candidate.option, ...tail];
		}
		failed.add(pos);
		return null;
	};
	const matched = solve(0);
	return matched && matched.length > 0 ? matched : null;
}

function extractKnownJoinedOptions(
	text: string,
	candidates: readonly JoinCandidate[],
	config: { caseSensitive: boolean; separator: string },
): SuggesterOption[] {
	const memo = new Map<number, { score: number; picks: SuggesterOption[] }>();
	const best = (pos: number): { score: number; picks: SuggesterOption[] } => {
		if (pos === text.length) return { score: 0, picks: [] };
		const cached = memo.get(pos);
		if (cached) return cached;

		let winner = best(skipUnmatchedSegment(text, pos, config.separator));
		for (const candidate of candidates) {
			const end = pos + candidate.text.length;
			if (end > text.length) continue;
			if (!labelsMatch(text.slice(pos, end), candidate.text, config.caseSensitive)) continue;
			const next = advancePastSeparator(text, end, config.separator);
			if (next < 0) continue;
			const tail = best(next);
			const score = candidate.text.length + tail.score;
			if (score > winner.score) {
				winner = { score, picks: [candidate.option, ...tail.picks] };
			}
		}
		memo.set(pos, winner);
		return winner;
	};
	return best(0).picks;
}
