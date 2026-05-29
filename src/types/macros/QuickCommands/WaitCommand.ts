import { Command } from "../Command";
import { CommandType } from "../CommandType";
import type { IWaitCommand } from "./IWaitCommand";

export class WaitCommand extends Command implements IWaitCommand {
	declare id: string;
	declare name: string;
	time: number;
	declare type: CommandType;

	constructor(time: number) {
		super("Wait", CommandType.Wait);
		this.time = time;
	}
}
