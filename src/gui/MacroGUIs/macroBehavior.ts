import type IMacroChoice from "../../types/choices/IMacroChoice";

export type MacroBehavior = Pick<
	IMacroChoice,
	"onePageInput" | "dateOrigin" | "runOnStartup" | "command" | "pickDayCommand" | "icon"
>;
