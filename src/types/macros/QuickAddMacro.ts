import type { ICommand } from "./ICommand";
import type { IMacro } from "./IMacro";
import { uuidv4 } from "../../utils/uuid";

export class QuickAddMacro implements IMacro {
	id: string;
	name: string;
	commands: ICommand[];

	constructor(name: string) {
		this.name = name;
		this.id = uuidv4();
		this.commands = [];
	}
}
