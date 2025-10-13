import { Notice } from "obsidian";
import { MacroAbortError } from "../errors/MacroAbortError";
import { settingsStore } from "../settingsStore";
import { log } from "../logger/logManager";

interface MacroAbortHandlerOptions {
	logPrefix: string;
	noticePrefix?: string;
	defaultReason: string;
}

/**
 * Handles MacroAbortError instances in a consistent way across engines.
 * Logs the abort, optionally shows a notice depending on user settings,
 * and returns true when the error was handled.
 *
 * @param error The error that was caught
 * @param options Labels describing the operation being aborted
 * @returns true if the error was a MacroAbortError and has been handled
 */
export function handleMacroAbort(
	error: unknown,
	{ logPrefix, noticePrefix = logPrefix, defaultReason }: MacroAbortHandlerOptions
): error is MacroAbortError {
	if (!(error instanceof MacroAbortError)) return false;

	const message =
		typeof error.message === "string" && error.message.trim().length > 0
			? error.message
			: defaultReason;

	log.logMessage(`${logPrefix}: ${message}`);

	const isUserCancellation =
		typeof error.message === "string" &&
		error.message.toLowerCase().includes("cancelled by user");

	if (
		!isUserCancellation ||
		settingsStore.getState().showInputCancellationNotification
	) {
		new Notice(`${noticePrefix}: ${message}`);
	}

	return true;
}
