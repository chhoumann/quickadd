import { Choice } from "./Choice";
import { ChoiceType } from "./choiceType";
import type IMacroChoice from "./IMacroChoice";
import type { IMacro } from "../macros/IMacro";

export class MacroChoice extends Choice implements IMacroChoice {
	macro?: IMacro;
	macroId: string;

	constructor(name: string) {
		super(name, ChoiceType.Macro);

		this.macroId = null!;
	}
}
