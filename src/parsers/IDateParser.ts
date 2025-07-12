export interface ParsedMoment {
	moment: {
		format: (formatStr: string) => string;
		toISOString: () => string;
		isValid: () => boolean;
	};
}

export interface IDateParser {
	parseDate(input?: string): ParsedMoment | null;
}