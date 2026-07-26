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
 * A boolean `quiet` flag could express only the first two. It also made the
 * omission at a call site invisible: `parseAnonymousValueOptions` accepted
 * `{ quiet }`, honoured it for `|case:`, and then forwarded `false` to the
 * `|type:`/`|min:`/`|max:`/`|step:` helpers, so the deliberately-quiet pre-pass
 * warned anyway and every anonymous `{{VALUE|...}}` typo notified twice. Passing
 * the sink as a REQUIRED parameter on the internal helpers turns that class of
 * mistake into a compile error.
 */
export type WarnSink = (message: string) => void;

/** The default: a user-facing warning (a Notice, via GuiLogger). */
export const NOTICE_WARN: WarnSink = (message) => {
	log.logWarning(message);
};

/** Drops the warning. For pre-passes whose main pass reports the same mistake. */
export const SILENT_WARN: WarnSink = () => {};
