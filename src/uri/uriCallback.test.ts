import { describe, expect, it } from "vitest";
import {
	buildCallbackUrl,
	buildObsidianOpenUrl,
	callbackUrls,
	isCallbackUrlAllowed,
	parseCallbackTargets,
} from "./uriCallback";

describe("parseCallbackTargets", () => {
	it("reads explicit x-success / x-error / x-cancel", () => {
		const t = parseCallbackTargets({
			"x-success": "shortcuts://ok",
			"x-error": "shortcuts://err",
			"x-cancel": "shortcuts://cancel",
		});
		expect(t).toEqual({
			success: "shortcuts://ok",
			error: "shortcuts://err",
			cancel: "shortcuts://cancel",
			any: true,
		});
	});

	it("uses x-callback-url as the success AND cancel target (never error) when no explicit slot is present", () => {
		const t = parseCallbackTargets({ "x-callback-url": "shortcuts://done" });
		expect(t.success).toBe("shortcuts://done");
		expect(t.cancel).toBe("shortcuts://done");
		expect(t.error).toBeUndefined();
		expect(t.any).toBe(true);
	});

	it("ignores x-callback-url when any explicit slot is present", () => {
		const t = parseCallbackTargets({
			"x-success": "shortcuts://ok",
			"x-callback-url": "shortcuts://legacy",
		});
		expect(t.success).toBe("shortcuts://ok");
		expect(t.cancel).toBeUndefined();
	});

	it("treats empty strings as absent and reports any:false when nothing is provided", () => {
		expect(parseCallbackTargets({ "x-success": "" }).any).toBe(false);
		expect(parseCallbackTargets({}).any).toBe(false);
	});
});

describe("isCallbackUrlAllowed", () => {
	it("allows shortcuts: and obsidian: schemes", () => {
		expect(isCallbackUrlAllowed("shortcuts://run-shortcut?name=Foo")).toBe(true);
		expect(isCallbackUrlAllowed("obsidian://open?vault=v&file=f")).toBe(true);
	});

	it("rejects dangerous and non-allowlisted schemes", () => {
		for (const url of [
			"https://evil.example/cb",
			"http://evil.example/cb",
			"file:///etc/passwd",
			"javascript:alert(1)",
			"data:text/html,<script>",
			"sms:+15555550123?body=secret",
			"tel:+15555550123",
			"mailto:attacker@example.com",
		]) {
			expect(isCallbackUrlAllowed(url)).toBe(false);
		}
	});

	it("rejects leading-whitespace dangerous schemes (URL normalises them, allowlist still excludes)", () => {
		// new URL(" javascript:...") normalises to protocol "javascript:" which is not allow-listed.
		expect(isCallbackUrlAllowed(" javascript:alert(1)")).toBe(false);
		expect(isCallbackUrlAllowed("\tfile:///x")).toBe(false);
	});

	it("rejects unparseable URLs", () => {
		expect(isCallbackUrlAllowed("not a url")).toBe(false);
		expect(isCallbackUrlAllowed("")).toBe(false);
	});
});

describe("buildCallbackUrl", () => {
	it("appends percent-encoded params and preserves the existing query", () => {
		const out = buildCallbackUrl("shortcuts://run-shortcut?name=Foo", {
			status: "success",
			path: "Daily/My Note.md",
		});
		const url = new URL(out);
		expect(url.searchParams.get("name")).toBe("Foo");
		expect(url.searchParams.get("status")).toBe("success");
		expect(url.searchParams.get("path")).toBe("Daily/My Note.md");
		// the serialized string must not contain a raw space (URLSearchParams encodes
		// space as "+" and "/" as "%2F"; both round-trip correctly via new URL above)
		expect(out).not.toContain(" ");
		expect(out).toContain("Daily%2FMy+Note.md");
	});

	it("overrides a caller-supplied reserved param instead of duplicating it", () => {
		const out = buildCallbackUrl("shortcuts://run-shortcut?name=X&status=old", {
			status: "success",
		});
		const url = new URL(out);
		// QuickAdd's status wins; no duplicate status param a consumer could read first
		expect(url.searchParams.getAll("status")).toEqual(["success"]);
		expect(url.searchParams.get("name")).toBe("X");
	});
});

describe("buildObsidianOpenUrl", () => {
	it("percent-encodes the vault name and file path", () => {
		const out = buildObsidianOpenUrl("My Vault", "Folder/Sub/Note.md");
		expect(out).toBe(
			"obsidian://open?vault=My%20Vault&file=Folder%2FSub%2FNote.md",
		);
	});
});

describe("callbackUrls", () => {
	it("collects the non-empty targets", () => {
		const t = parseCallbackTargets({
			"x-success": "shortcuts://ok",
			"x-error": "shortcuts://err",
		});
		expect(callbackUrls(t)).toEqual(["shortcuts://ok", "shortcuts://err"]);
	});
});
