import { beforeAll, describe, expect, it } from "vitest";
import type { ObsidianClient, SandboxApi } from "obsidian-e2e";
import { createQuickAddE2EHarness, PLUGIN_ID } from "./e2eVault";

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const TPL_CONTENT = "APPLIED_TEMPLATE_CONTENT";
const TPL_FM = "---\nstatus: draft\npriority: high\n---\nTPL_BODY";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

type ApplyResult = { ok: boolean; path?: string | null; error?: string };

const getContext = createQuickAddE2EHarness("apply-template");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a file into the sandbox and wait for Obsidian to index it. */
async function seedFile(sandbox: SandboxApi, name: string, content: string) {
	await sandbox.write(name, content, {
		waitForContent: true,
		waitOptions: WAIT_OPTS,
	});
}

/**
 * Opens the note in the active leaf, then calls the public API seam
 * `applyTemplateToActiveFile`. Results land in a window global we poll for rather
 * than reading `evalJsonAsync`'s return: template application emits `QuickAdd:`
 * notices into the eval output channel that corrupt the JSON envelope, so the
 * async work is decoupled from a clean, synchronous JSON read of the global.
 */
async function applyTemplate(
	obsidian: ObsidianClient,
	notePath: string,
	templatePath: string,
	mode?: string,
): Promise<ApplyResult> {
	const options = mode ? `{ mode: ${JSON.stringify(mode)} }` : "undefined";

	await obsidian.dev.evalRaw(`(async () => {
		window.__qaApplyTplResult = null;
		try {
			// The vault index can lag behind sandbox writes; poll for the note.
			let file = null;
			for (let attempt = 0; attempt < 50 && !file; attempt++) {
				file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
				if (!file) await new Promise((resolve) => setTimeout(resolve, 100));
			}
			if (!file) throw new Error("note not found: " + ${JSON.stringify(notePath)});
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(file);
			app.workspace.setActiveLeaf(leaf, { focus: true });
			const result = await app.plugins.plugins.${PLUGIN_ID}.api.applyTemplateToActiveFile(
				${JSON.stringify(templatePath)},
				${options},
			);
			window.__qaApplyTplResult = { ok: true, path: result ? result.path : null };
		} catch (e) {
			window.__qaApplyTplResult = { ok: false, error: String((e && e.message) || e) };
		}
	})()`);

	const result = await obsidian.waitFor(async () => {
		const value = await obsidian.dev.evalJson<ApplyResult | null>(
			"window.__qaApplyTplResult ?? null",
		);
		return value ?? false;
	}, WAIT_OPTS);

	return result as ApplyResult;
}

function expectOrderedSubstrings(
	content: string,
	first: string,
	second: string,
) {
	const firstIndex = content.indexOf(first);
	const secondIndex = content.indexOf(second);

	expect(firstIndex).toBeGreaterThanOrEqual(0);
	expect(secondIndex).toBeGreaterThanOrEqual(0);
	expect(firstIndex).toBeLessThan(secondIndex);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("apply template to active note (API seam)", () => {
	beforeAll(async () => {
		const { sandbox } = getContext();
		await seedFile(sandbox, "tpl-plain.md", TPL_CONTENT);
		await seedFile(sandbox, "tpl-fm.md", TPL_FM);
	});

	it("A01: empty note fast path - applies template as full content", async () => {
		const { obsidian, sandbox } = getContext();
		await seedFile(sandbox, "a01-empty.md", "");

		const result = await applyTemplate(
			obsidian,
			sandbox.path("a01-empty.md"),
			sandbox.path("tpl-plain.md"),
		);

		expect(result.ok).toBe(true);
		const content = await sandbox.waitForContent(
			"a01-empty.md",
			(c) => c.includes(TPL_CONTENT),
			WAIT_OPTS,
		);
		expect(content.trim()).toBe(TPL_CONTENT);
	});

	it("A02: bottom (default for non-empty notes) - appends after existing content", async () => {
		const { obsidian, sandbox } = getContext();
		await seedFile(sandbox, "a02-bottom.md", "EXISTING_CONTENT");

		const result = await applyTemplate(
			obsidian,
			sandbox.path("a02-bottom.md"),
			sandbox.path("tpl-plain.md"),
		);

		expect(result.ok).toBe(true);
		const content = await sandbox.waitForContent(
			"a02-bottom.md",
			(c) => c.includes(TPL_CONTENT),
			WAIT_OPTS,
		);
		expectOrderedSubstrings(content, "EXISTING_CONTENT", TPL_CONTENT);
	});

	it("A03: top - inserts before existing content", async () => {
		const { obsidian, sandbox } = getContext();
		await seedFile(sandbox, "a03-top.md", "EXISTING_CONTENT");

		const result = await applyTemplate(
			obsidian,
			sandbox.path("a03-top.md"),
			sandbox.path("tpl-plain.md"),
			"top",
		);

		expect(result.ok).toBe(true);
		const content = await sandbox.waitForContent(
			"a03-top.md",
			(c) => c.includes(TPL_CONTENT),
			WAIT_OPTS,
		);
		expectOrderedSubstrings(content, TPL_CONTENT, "EXISTING_CONTENT");
	});

	it("A04: replace - replaces existing content", async () => {
		const { obsidian, sandbox } = getContext();
		await seedFile(sandbox, "a04-replace.md", "OLD_CONTENT_TO_REPLACE");

		const result = await applyTemplate(
			obsidian,
			sandbox.path("a04-replace.md"),
			sandbox.path("tpl-plain.md"),
			"replace",
		);

		expect(result.ok).toBe(true);
		const content = await sandbox.waitForContent(
			"a04-replace.md",
			(c) => c.includes(TPL_CONTENT),
			WAIT_OPTS,
		);
		expect(content).not.toContain("OLD_CONTENT_TO_REPLACE");
	});

	it("A05: cursor - inserts via the active editor", async () => {
		const { obsidian, sandbox } = getContext();
		await seedFile(sandbox, "a05-cursor.md", "EXISTING_CONTENT");

		const result = await applyTemplate(
			obsidian,
			sandbox.path("a05-cursor.md"),
			sandbox.path("tpl-plain.md"),
			"cursor",
		);

		expect(result.ok).toBe(true);
		const content = await sandbox.waitForContent(
			"a05-cursor.md",
			(c) => c.includes(TPL_CONTENT),
			WAIT_OPTS,
		);
		expect(content).toContain("EXISTING_CONTENT");
	});

	it("A06: top with frontmatter - merges template properties, existing values win", async () => {
		const { obsidian, sandbox } = getContext();
		await seedFile(sandbox, "a06-fm.md", "---\nstatus: done\n---\nEXISTING_CONTENT");

		const result = await applyTemplate(
			obsidian,
			sandbox.path("a06-fm.md"),
			sandbox.path("tpl-fm.md"),
			"top",
		);

		expect(result.ok).toBe(true);
		const content = await sandbox.waitForContent(
			"a06-fm.md",
			(c) => c.includes("TPL_BODY"),
			WAIT_OPTS,
		);

		// Body lands below the note frontmatter, above existing content.
		expectOrderedSubstrings(content, "TPL_BODY", "EXISTING_CONTENT");
		// Existing property wins; missing property is filled from template.
		expect(content).toContain("status: done");
		expect(content).not.toContain("status: draft");
		expect(content).toContain("priority: high");
		// No duplicate frontmatter blocks.
		expect(content.match(/^---$/gm)?.length).toBe(2);
	});

	it("A07: canvas template - rejects with a helpful error", async () => {
		const { obsidian, sandbox } = getContext();
		await seedFile(sandbox, "tpl-board.canvas", '{"nodes":[],"edges":[]}');
		await seedFile(sandbox, "a07-canvas-tpl.md", "EXISTING_CONTENT");

		const result = await applyTemplate(
			obsidian,
			sandbox.path("a07-canvas-tpl.md"),
			sandbox.path("tpl-board.canvas"),
		);

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/only supports markdown templates/);
		expect(await sandbox.read("a07-canvas-tpl.md")).toBe("EXISTING_CONTENT");
	});

	it("A08: invalid mode - rejects with a helpful error", async () => {
		const { obsidian, sandbox } = getContext();
		await seedFile(sandbox, "a08-invalid.md", "EXISTING_CONTENT");

		const result = await applyTemplate(
			obsidian,
			sandbox.path("a08-invalid.md"),
			sandbox.path("tpl-plain.md"),
			"sideways",
		);

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/Invalid mode/);
	});
});
