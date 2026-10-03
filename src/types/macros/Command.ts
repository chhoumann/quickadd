import type { CommandType } from "./CommandType";
import type { ICommand } from "./ICommand";
import { uuidv4 } from "../../utils/uuid";

export abstract class Command implements ICommand {
	name: string;
	type: CommandType;
	id: string;

	protected constructor(name: string, type: CommandType) {
		this.name = name;
		this.type = type;
		this.id = uuidv4();
	}
}
