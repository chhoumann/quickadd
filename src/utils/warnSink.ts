import { log } from "../logger/logManager";

/**
 * Where a parser sends an authoring warning.
 *
 * The token parsers are shared by four callers with genuinely different needs:
 * the runtime run (which owns the user-facing Notice), the preflight scan and
 * the parsers' own pre-passes (which must stay silent so one mistake is not
 * reported two or three times), and the builders' live preview (which re-parses
 * on every keystroke and needs to *collect* the warnings, not fire them).
 *
 * A required sink rather than a boolean `quiet` flag, so an internal helper
 * that forgets to forward it is a compile error rather than a doubled notice.
 */
export type WarnSink = (message: string) => void;

/** The default: a user-facing warning (a Notice, via GuiLogger). */
export const NOTICE_WARN: WarnSink = (message) => {
	log.logWarning(message);
};

/** Drops the warning. For pre-passes whose main pass reports the same mistake. */
export const SILENT_WARN: WarnSink = () => {};
