/**
 * Obsidian-free decision logic for `obsidian://quickadd` x-callback-url support:
 * target selection, scheme allow-listing and URL building.
 */

/**
 * Schemes a callback URL may use. `http(s)` is excluded: it would send
 * vault-relative paths to a destination the incoming URI controls.
 */
const ALLOWED_CALLBACK_SCHEMES = new Set(["shortcuts:", "obsidian:"]);

export interface CallbackTargets {
	success?: string;
	error?: string;
	cancel?: string;
	/** True when at least one callback target was provided. */
	any: boolean;
}

/** The x-callback-url-related fields read off the incoming obsidian:// params. */
interface RawCallbackParams {
	"x-success"?: string;
	"x-error"?: string;
	"x-cancel"?: string;
	"x-callback-url"?: string;
}

function nonEmpty(value: string | undefined): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Resolves which callback URL fires for each outcome from the incoming URI params.
 *
 * `x-success` / `x-error` / `x-cancel` are the canonical x-callback-url params. The
 * legacy single-URL `x-callback-url` shorthand is honoured ONLY when none of the
 * three explicit params is present; it then fires for both success AND cancel (both
 * are "completed actions"), never for error.
 */
export function parseCallbackTargets(
	params: RawCallbackParams,
): CallbackTargets {
	const success = nonEmpty(params["x-success"]);
	const error = nonEmpty(params["x-error"]);
	const cancel = nonEmpty(params["x-cancel"]);

	if (success || error || cancel) {
		return { success, error, cancel, any: true };
	}

	const legacy = nonEmpty(params["x-callback-url"]);
	if (legacy) {
		return { success: legacy, cancel: legacy, any: true };
	}

	return { any: false };
}

/** All non-empty callback URLs across the resolved targets (deduped order: success, error, cancel). */
export function callbackUrls(targets: CallbackTargets): string[] {
	return [targets.success, targets.error, targets.cancel].filter(
		(url): url is string => typeof url === "string" && url.length > 0,
	);
}

/**
 * True if `url` parses and uses an allow-listed scheme. `new URL().protocol`
 * normalises leading whitespace and control characters, so the allow-list keeps
 * `file:`, `javascript:` and the like out.
 */
export function isCallbackUrlAllowed(url: string): boolean {
	try {
		const protocol = new URL(url).protocol.toLowerCase();
		return ALLOWED_CALLBACK_SCHEMES.has(protocol);
	} catch {
		return false;
	}
}

/**
 * Appends `params` as query parameters to `base` (percent-encoded). `base` is the
 * caller-provided callback URL, already validated by {@link isCallbackUrlAllowed}.
 */
export function buildCallbackUrl(
	base: string,
	params: Record<string, string>,
): string {
	const url = new URL(base);
	for (const [key, value] of Object.entries(params)) {
		// `set` (not `append`) so QuickAdd's reserved result keys (status/path/url/
		// errorCode) override any same-named param the caller already put on the URL,
		// rather than producing a duplicate that consumers may read first.
		url.searchParams.set(key, value);
	}
	return url.toString();
}

/**
 * Builds an `obsidian://open?vault=…&file=…` URL from public vault/file data.
 * (Obsidian's internal `app.getObsidianUrl` is not part of the public typings, so we
 * construct it ourselves.)
 */
export function buildObsidianOpenUrl(
	vaultName: string,
	filePath: string,
): string {
	return (
		"obsidian://open?vault=" +
		encodeURIComponent(vaultName) +
		"&file=" +
		encodeURIComponent(filePath)
	);
}
