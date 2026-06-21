export type DatePickerSelectSource = "picker" | "action";

export interface DatePickerController {
	setSelectedIso(
		iso?: string,
		options?: { updateView?: boolean },
	): void;
	setViewFromIso(iso: string): void;
	destroy(): void;
}

export interface DatePickerOptions {
	container: HTMLElement;
	initialIso?: string;
	weekStartsOn?: number;
	/** When true, render a time control and emit datetime ISOs (issue #757). */
	withTime?: boolean;
	onSelect: (iso: string | null, source: DatePickerSelectSource) => void;
}

interface TimeParts {
	hour: number;
	minute: number;
}

const pad = (value: number) => value.toString().padStart(2, "0");

const getWeekStartsOn = (value?: number): number => {
	if (typeof value === "number" && value >= 0 && value <= 6) return value;
	const moment = window.moment;
	const firstDay = moment?.localeData?.()?.firstDayOfWeek?.();
	if (typeof firstDay === "number" && firstDay >= 0 && firstDay <= 6)
		return firstDay;
	return 0;
};

const getWeekdayLabels = (weekStartsOn: number): string[] => {
	const formatter = new Intl.DateTimeFormat(undefined, {
		weekday: "short",
	});
	const base = new Date(2021, 7, 1);
	const labels = Array.from({ length: 7 }, (_, i) => {
		const date = new Date(
			base.getFullYear(),
			base.getMonth(),
			base.getDate() + i,
		);
		return formatter.format(date);
	});
	return labels.slice(weekStartsOn).concat(labels.slice(0, weekStartsOn));
};

const getMonthLabel = (year: number, month: number): string => {
	const formatter = new Intl.DateTimeFormat(undefined, {
		month: "long",
		year: "numeric",
	});
	return formatter.format(new Date(year, month, 1));
};

const formatDateKey = (year: number, month: number, day: number): string =>
	`${year}-${pad(month + 1)}-${pad(day)}`;

const toDateKey = (date: Date): string =>
	formatDateKey(date.getFullYear(), date.getMonth(), date.getDate());

const parseIsoToDate = (iso?: string): Date | null => {
	if (!iso) return null;
	const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (dateOnlyMatch) {
		const [, year, month, day] = dateOnlyMatch;
		return new Date(
			Number.parseInt(year, 10),
			Number.parseInt(month, 10) - 1,
			Number.parseInt(day, 10),
		);
	}
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed;
};

/**
 * Builds the ISO emitted on selection. Without time it stays the bare
 * `YYYY-MM-DD` date key (byte-identical to the date-only picker). With time it
 * appends an OFFSET-LESS local wall-clock `THH:mm:00` — never `Z`/toISOString,
 * so the chosen hour round-trips identically across timezones.
 */
export const toIsoFromParts = (
	year: number,
	month: number,
	day: number,
	time?: TimeParts | null,
): string => {
	const dateKey = formatDateKey(year, month, day);
	if (!time) return dateKey;
	return `${dateKey}T${pad(time.hour)}:${pad(time.minute)}:00`;
};

/** Reads HH:mm out of a `...THH:mm` or `... HH:mm` ISO; null when absent. */
export const extractTimeFromIso = (iso?: string): TimeParts | null => {
	if (!iso) return null;
	const match = /[T ](\d{2}):(\d{2})/.exec(iso);
	if (!match) return null;
	const hour = Number.parseInt(match[1], 10);
	const minute = Number.parseInt(match[2], 10);
	if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return { hour, minute };
};

export const createDatePicker = (
	options: DatePickerOptions,
): DatePickerController => {
	const weekStartsOn = getWeekStartsOn(options.weekStartsOn);
	const weekdayLabels = getWeekdayLabels(weekStartsOn);

	const initialDate =
		parseIsoToDate(options.initialIso) ?? new Date();
	let viewYear = initialDate.getFullYear();
	let viewMonth = initialDate.getMonth();
	let selectedIso = options.initialIso;

	const withTime = options.withTime === true;
	// The wall-clock time merged into every picked day. Seeded from the initial
	// ISO (if it carried a time), else midnight.
	let currentTime: TimeParts | null = withTime
		? extractTimeFromIso(options.initialIso) ?? { hour: 0, minute: 0 }
		: null;

	const root = options.container.createDiv({ cls: "qa-date-picker" });

	const header = root.createDiv({ cls: "qa-date-picker__header" });
	const prevBtn = header.createEl("button", {
		cls: "qa-date-picker__nav",
		text: "‹",
	});
	prevBtn.type = "button";
	prevBtn.setAttr("aria-label", "Previous month");

	const label = header.createDiv({ cls: "qa-date-picker__label" });

	const nextBtn = header.createEl("button", {
		cls: "qa-date-picker__nav",
		text: "›",
	});
	nextBtn.type = "button";
	nextBtn.setAttr("aria-label", "Next month");

	const weekdayRow = root.createDiv({ cls: "qa-date-picker__weekdays" });
	weekdayLabels.forEach((day) => {
		const cell = weekdayRow.createDiv({ cls: "qa-date-picker__weekday" });
		cell.textContent = day;
	});

	const grid = root.createDiv({ cls: "qa-date-picker__grid" });

	const actions = root.createDiv({ cls: "qa-date-picker__actions" });
	const todayBtn = actions.createEl("button", {
		cls: "qa-date-picker__action",
		text: "Today",
	});
	todayBtn.type = "button";

	const clearBtn = actions.createEl("button", {
		cls: "qa-date-picker__action",
		text: "Clear",
	});
	clearBtn.type = "button";

	let timeInput: HTMLInputElement | undefined;
	if (withTime) {
		const timeRow = root.createDiv({ cls: "qa-date-picker__time" });
		timeRow.createEl("label", {
			cls: "qa-date-picker__time-label",
			text: "Time",
		});
		timeInput = timeRow.createEl("input", { cls: "qa-date-picker__time-input" });
		timeInput.type = "time";
		if (currentTime) {
			timeInput.value = `${pad(currentTime.hour)}:${pad(currentTime.minute)}`;
		}
	}

	const shiftMonth = (delta: number) => {
		viewMonth += delta;
		if (viewMonth > 11) {
			viewMonth = 0;
			viewYear += 1;
		} else if (viewMonth < 0) {
			viewMonth = 11;
			viewYear -= 1;
		}
		render();
	};

	const selectIso = (iso: string, source: DatePickerSelectSource) => {
		selectedIso = iso;
		options.onSelect(iso, source);
		render();
	};

	const clearSelection = (source: DatePickerSelectSource) => {
		selectedIso = undefined;
		options.onSelect(null, source);
		render();
	};

	prevBtn.addEventListener("click", () => shiftMonth(-1));
	nextBtn.addEventListener("click", () => shiftMonth(1));

	todayBtn.addEventListener("click", () => {
		const today = new Date();
		const iso = toIsoFromParts(
			today.getFullYear(),
			today.getMonth(),
			today.getDate(),
			currentTime,
		);
		viewYear = today.getFullYear();
		viewMonth = today.getMonth();
		selectIso(iso, "action");
	});

	clearBtn.addEventListener("click", () => clearSelection("action"));

	if (timeInput) {
		timeInput.addEventListener("change", () => {
			// Clearing the field drops the time back to midnight instead of
			// keeping the previously merged wall-clock time on later day picks.
			if (timeInput.value.trim() === "") {
				currentTime = { hour: 0, minute: 0 };
			} else {
				const [h, m] = timeInput.value
					.split(":")
					.map((p) => Number.parseInt(p, 10));
				if (Number.isNaN(h) || Number.isNaN(m)) return;
				currentTime = { hour: h, minute: m };
			}
			// Re-emit so editing the time after picking a day updates the value
			// instead of being dropped.
			if (selectedIso) {
				const parsed = parseIsoToDate(selectedIso);
				if (parsed) {
					selectIso(
						toIsoFromParts(
							parsed.getFullYear(),
							parsed.getMonth(),
							parsed.getDate(),
							currentTime,
						),
						"picker",
					);
				}
			}
		});
	}

	const render = () => {
		label.textContent = getMonthLabel(viewYear, viewMonth);
		grid.empty();

		const firstOfMonth = new Date(viewYear, viewMonth, 1);
		const startOffset =
			(firstOfMonth.getDay() - weekStartsOn + 7) % 7;
		const startDate = new Date(viewYear, viewMonth, 1 - startOffset);
		const todayKey = toDateKey(new Date());
		const selectedDate = selectedIso ? parseIsoToDate(selectedIso) : null;
		const selectedKey = selectedDate ? toDateKey(selectedDate) : undefined;

		const ariaFormatter = new Intl.DateTimeFormat(undefined, {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
		});

		for (let i = 0; i < 42; i += 1) {
			const date = new Date(startDate);
			date.setDate(startDate.getDate() + i);

			const dayKey = toDateKey(date);
			const isOutside = date.getMonth() !== viewMonth;
			const isToday = dayKey === todayKey;
			const isSelected = selectedKey && dayKey === selectedKey;

			const dayBtn = grid.createEl("button", {
				cls: "qa-date-picker__day",
				text: String(date.getDate()),
			});
			dayBtn.type = "button";
			dayBtn.setAttr("aria-label", ariaFormatter.format(date));

			if (isOutside) dayBtn.addClass("is-outside");
			if (isToday) dayBtn.addClass("is-today");
			if (isSelected) {
				dayBtn.addClass("is-selected");
				dayBtn.setAttr("aria-pressed", "true");
			}

			dayBtn.addEventListener("click", () => {
				const iso = toIsoFromParts(
					date.getFullYear(),
					date.getMonth(),
					date.getDate(),
					currentTime,
				);
				selectIso(iso, "picker");
			});
		}
	};

	render();

	return {
		setSelectedIso: (iso, { updateView } = {}) => {
			selectedIso = iso;
			if (iso && updateView !== false) {
				const parsed = parseIsoToDate(iso);
				if (parsed) {
					viewYear = parsed.getFullYear();
					viewMonth = parsed.getMonth();
				}
			}
			// Reflect a time carried by the incoming ISO (e.g. parsed from the
			// text box) into the time control so the two stay in sync.
			if (withTime && iso) {
				const time = extractTimeFromIso(iso);
				if (time) {
					currentTime = time;
					if (timeInput) {
						timeInput.value = `${pad(time.hour)}:${pad(time.minute)}`;
					}
				}
			}
			render();
		},
		setViewFromIso: (iso: string) => {
			const parsed = parseIsoToDate(iso);
			if (parsed) {
				viewYear = parsed.getFullYear();
				viewMonth = parsed.getMonth();
				render();
			}
		},
		destroy: () => {
			root.remove();
		},
	};
};
