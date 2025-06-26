import { WorkspaceValidationError } from "../errors/workspaceValidationError";

export default function invariant(
	condition: unknown,
	message?: string | (() => string)
): asserts condition {
	if (!condition) {
		const msg = typeof message === "function" ? message() : message;

		if (typeof msg === "string" && msg.toLowerCase().includes("workspace")) {
			throw new WorkspaceValidationError(msg);
		}

		throw new Error(msg);
	}

	return;
}
