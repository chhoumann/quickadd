export class MacroAbortError extends Error {
	constructor(message?: string) {
		super(message || "Macro execution aborted");
		this.name = "MacroAbortError";
	}
}
