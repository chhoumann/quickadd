import { Choice } from "./Choice";
import type IMacroChoice from "./IMacroChoice";
import type { IMacro } from "../macros/IMacro";

export class MacroChoice extends Choice implements IMacroChoice {
	macro?: IMacro;
	macroId = "";

	constructor(name: string) {
		super(name, "Macro");
	}
}
