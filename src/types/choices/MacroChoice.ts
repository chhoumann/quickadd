import { Choice } from "./Choice";
import type IMacroChoice from "./IMacroChoice";
import type { IMacro } from "../macros/IMacro";
import { QuickAddMacro } from "../macros/QuickAddMacro";

export class MacroChoice extends Choice implements IMacroChoice {
	macro: IMacro;
	runOnStartup = false;

	constructor(name: string) {
		super(name, "Macro");
		this.macro = new QuickAddMacro(name);
	}
}
