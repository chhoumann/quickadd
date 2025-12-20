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
	onSelect: (iso: string | null, source: DatePickerSelectSource) => void;
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

const toIsoFromParts = (year: number, month: number, day: number): string => {
	return formatDateKey(year, month, day);
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
		);
		viewYear = today.getFullYear();
		viewMonth = today.getMonth();
		selectIso(iso, "action");
	});

	clearBtn.addEventListener("click", () => clearSelection("action"));

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
