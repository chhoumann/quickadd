import {
	DropdownComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
	TextComponent,
	debounce,
	type App,
} from "obsidian";
import { FIELD_VARIABLE_PREFIX } from "src/constants";
import { createDatePicker } from "src/gui/date-picker/datePicker";
import { FieldValueInputSuggest } from "src/gui/suggesters/FieldValueInputSuggest";
import { SuggesterInputSuggest } from "src/gui/suggesters/SuggesterInputSuggest";
import { formatISODate, parseNaturalLanguageDate } from "src/utils/dateParser";
import {
	formatDateAliasInline,
	getOrderedDateAliases,
} from "src/utils/dateAliases";
import { settingsStore } from "src/settingsStore";
type CompletionInputEvent = Event & {
	fromCompletion?: boolean;
};

import type { FieldRequirement } from "./RequirementCollector";
import type { ImagePasteHandle } from "src/gui/imagePasteHandler";
import { attachImagePasteHandler } from "src/gui/imagePasteHandler";
import {
	mapMappedSuggesterValue,
	resolveDropdownInitialValue,
} from "./suggesterValueMapping";
import {
	normalizeNumericValue,
	normalizeSliderValue,
} from "src/utils/valueSyntax";

type PreviewComputer = (
	values: Record<string, string>,
) => Promise<Record<string, string>> | Record<string, string>;

export class OnePageInputModal extends Modal {
	private readonly requirements: FieldRequirement[];
	private readonly initialValues: Map<string, string>;
	private readonly result = new Map<string, string>();
	// Unambiguous ordered selections per multi-select field, recorded per-pick from
	// the suggester (see SuggesterInputSuggest.onSelect). The ", "-joined input
	// text alone can't distinguish picking "a" then "b" from picking a single
	// option named "a, b"; consumers prefer this array when it still matches the
	// final text (pure click flow), falling back to text parsing after manual edits.
	public readonly multiSelections = new Map<string, string[]>();
	// Date fields whose current (non-blank) text failed to parse.
	private readonly dateParseErrors = new Set<string>();
	private readonly computePreview?: PreviewComputer;
	private previewContainerEl: HTMLElement | null = null;
	private updatePreviewDebounced: () => void;
	private settled = false;
	private readonly imagePasteHandles: ImagePasteHandle[] = [];

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
		title.addClass("qa-onepage-title");

		// Optional live preview area
		if (this.computePreview) {
			this.previewContainerEl = this.contentEl.createDiv();
			this.previewContainerEl.addClass("qa-onepage-preview");
			const label = this.previewContainerEl.createEl("div", {
				text: "Preview",
			});
			label.addClass("qa-onepage-preview-label");
			void this.updatePreviews();
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

	onOpen() {
		// Auto-focus the first field so keyboard-first users can start typing
		// immediately, matching the single-field prompts.
		const firstField = this.contentEl.querySelector<HTMLElement>(
			"input, textarea, select",
		);
		firstField?.focus();

		// Mod+Enter submits without reaching for the mouse. Guarded because the
		// test mock's Modal has no scope.
		const scope = (
			this as unknown as {
				scope?: {
					register?: (
						mods: string[],
						key: string,
						cb: () => boolean,
					) => void;
				};
			}
		).scope;
		if (typeof scope?.register === "function") {
			scope.register(["Mod"], "Enter", () => {
				this.submit();
				return false;
			});
		}
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
				input.inputEl.addClass("qa-onepage-textarea");
				this.enableImagePaste(req, input.inputEl);
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
				this.enableImagePaste(req, input.inputEl);
				break;
			}
			case "number": {
				// |type:number — a numeric input so the one-page form rejects
				// non-numeric text like the runtime NumberInputPrompt does.
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
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
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				setting.controlEl.parentElement?.addClass(
					"qa-onepage-slider-setting",
				);
				if (req.description) setting.setDesc(req.description);
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
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
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
					withTime: req.withTime === true,
					onSelect: (iso) => {
						if (iso) applyPickerSelection(iso);
						else clearPickerSelection();
					},
				});

				const preview = container.createDiv();
				preview.addClass("qa-date-preview-text");

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

					const aliasList = aliasDetails.createEl("div");
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
					selectedIso = iso;
					this.dateParseErrors.delete(req.id);
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
					// A blank optional date means "leave empty" — never
					// resurrect the default the user just cleared.
					if (!inputVal && req.defaultValue && !req.optional) {
						const parsed = parseNaturalLanguageDate(
							req.defaultValue,
							req.dateFormat,
						);
						if (parsed.isValid && parsed.isoString) {
							selectedIso = parsed.isoString;
							this.dateParseErrors.delete(req.id);
							setValue(req.id, `@date:${parsed.isoString}`);
							syncSelection(parsed.isoString);
							const formatted =
								parsed.formatted ??
								formatIsoForDisplay(parsed.isoString);
							renderPreview(formatted, false);
							return;
						}
						renderPreview(parsed.error || "Unable to parse date", true);
						this.dateParseErrors.add(req.id);
						setValue(req.id, "");
						syncSelection();
						return;
					}
					if (!inputVal) {
						selectedIso = undefined;
						this.dateParseErrors.delete(req.id);
						setValue(req.id, "");
						syncSelection();
						renderPreview(
							req.optional
								? "Will be left empty"
								: "Preview will appear here",
							false,
						);
						return;
					}

					if (inputVal.startsWith("@date:")) {
						const iso = inputVal.slice(6).trim();
						if (iso) {
							this.dateParseErrors.delete(req.id);
							applyPickerSelection(iso);
							return;
						}
					}

					const parsed = parseNaturalLanguageDate(inputVal, req.dateFormat);
					if (parsed.isValid && parsed.isoString) {
						selectedIso = parsed.isoString;
						this.dateParseErrors.delete(req.id);
						setValue(req.id, `@date:${parsed.isoString}`);
						syncSelection(parsed.isoString);
						const formatted =
							parsed.formatted ?? formatIsoForDisplay(parsed.isoString);
						renderPreview(formatted, false);
					} else {
						selectedIso = undefined;
						this.dateParseErrors.add(req.id);
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
				// Attach inline suggester powered by vault data & filters encoded in
				// req.id. Collected FIELD requirements are keyed "FIELD:<specifier>";
				// strip the prefix so the suggester parses the bare field specifier.
				const fieldSpecifier = req.id.startsWith(FIELD_VARIABLE_PREFIX)
					? req.id.slice(FIELD_VARIABLE_PREFIX.length)
					: req.id;
				try {
					new FieldValueInputSuggest(this.app, input.inputEl, fieldSpecifier);
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
						new SuggesterInputSuggest(
							this.app,
							input.inputEl,
							displayOptions,
							caseSensitive,
							multiSelect,
							multiSelect
								? (item) => {
										const arr = this.multiSelections.get(req.id) ?? [];
										arr.push(item);
										this.multiSelections.set(req.id, arr);
									}
								: undefined,
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
				this.enableImagePaste(req, input.inputEl);
			}
		}

		// Initialize stored value for empty inputs to ensure presence
		if (!this.result.has(req.id)) this.result.set(req.id, starting);
	}

	/**
	 * Free-text fields accept clipboard-image paste UNLESS any scanned
	 * occurrence of the variable was path context (file name, folder, capture
	 * target, location target, template path) - an embed link would corrupt a
	 * path (issue #1484). The destination is unresolved at preflight time, so
	 * the saver runs with "" (vault-root placement and links that resolve
	 * from anywhere).
	 */
	private enableImagePaste(
		req: FieldRequirement,
		inputEl: HTMLInputElement | HTMLTextAreaElement,
	): void {
		if (req.pathContext) return;
		this.imagePasteHandles.push(attachImagePasteHandler(this.app, inputEl, {}));
	}

	private decorateLabel(req: FieldRequirement): string | DocumentFragment {
		if (!req.optional) return req.label;

		// Use the modal's own document (popout-aware) rather than the bare global.
		const doc = this.contentEl.ownerDocument;
		const fragment = doc.createDocumentFragment();
		fragment.appendChild(doc.createTextNode(req.label));
		const badge = doc.createElement("span");
		badge.textContent = " (optional)";
		badge.className = "qa-onepage-optional-badge";
		fragment.appendChild(badge);
		return fragment;
	}

	private submit() {
		if (this.settled) return;
		// A pasted image may still be saving in one of the fields; defer so
		// paste-then-Mod+Enter submits WITH the embed link.
		const busyHandle = this.imagePasteHandles.find((handle) =>
			handle.isBusy(),
		);
		if (busyHandle) {
			void busyHandle.whenIdle().then(() => this.submit());
			return;
		}
		const out: Record<string, string> = {};
		const requirementsById = new Map(
			this.requirements.map((req) => [req.id, req]),
		);

		// A required date whose typed text failed to parse must not slip through:
		// without a parse error the value would be silently dropped (and the
		// script path has no sequential re-prompt to recover it). Block Submit and
		// point the user at the offending field instead.
		const erroredDate = this.requirements.find(
			(req) =>
				req.type === "date" &&
				!req.optional &&
				this.dateParseErrors.has(req.id),
		);
		if (erroredDate) {
			new Notice(
				`QuickAdd: "${erroredDate.label}" is not a valid date. Fix it or clear it before submitting.`,
			);
			return;
		}

		// Reconcile the per-pick multi-select arrays against the final text: if the
		// user manually edited the field after picking (so the recorded picks no
		// longer reproduce the text), drop the array and let the consumer fall back
		// to text parsing. Otherwise the unambiguous picked order is authoritative.
		for (const [id, picks] of this.multiSelections) {
			const text = (this.result.get(id) ?? "").replace(/,\s*$/, "").trim();
			if (picks.join(", ") !== text) this.multiSelections.delete(id);
		}

		this.result.forEach((v, k) => {
			const requirement = requirementsById.get(k);

			// Empty date fields: an optional date that is genuinely blank is
			// answered-empty (""). A required blank date — or any date whose
			// text failed to parse — is OMITTED so it stays unresolved and the
			// sequential date prompt (with picker and aliases) still fires.
			if (requirement?.type === "date" && v === "") {
				const hasParseError = this.dateParseErrors.has(k);
				if (!requirement.optional || hasParseError) return;
			}

			// Store the field value verbatim. A textarea value used to be
			// backslash-doubled here; nothing downstream un-doubled it (the formatter
			// substitutes a {{VALUE}} verbatim and never linebreak-processes it), so
			// the doubling corrupted paths/regex/code — and compounded with the
			// |type:text YAML quoter, which escapes backslashes again. Keep it literal,
			// matching the wide and single-line prompts.
			out[k] = v;
		});
		this.settled = true;
		this.close();
		this.resolvePromise(out);
	}

	private cancel() {
		this.settled = true;
		this.close();
		this.rejectPromise("cancelled");
	}

	onClose() {
		for (const handle of this.imagePasteHandles) handle.detach();
		this.imagePasteHandles.length = 0;
		// Esc (or any close that isn't submit/cancel) must settle the promise,
		// otherwise the choice execution hangs forever on waitForClose.
		if (!this.settled) {
			this.settled = true;
			this.rejectPromise("cancelled");
		}
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
				const row = this.previewContainerEl!.createDiv({
					cls: "qa-onepage-preview-row",
				});
				row.createEl("div", {
					text: `${k}:`,
					cls: "qa-preview-key",
				});
				row.createEl("div", { text: String(v), cls: "qa-preview-val" });
			});
		} catch {
			// Ignore preview errors
		}
	}
}
