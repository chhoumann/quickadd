import { beforeAll, describe, expect, it } from "vitest";
import type { ObsidianClient, SandboxApi } from "obsidian-e2e";
import { createQuickAddE2EHarness, PLUGIN_ID, seedVaultFile } from "./e2eVault";

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const TPL_CONTENT = "APPLIED_TEMPLATE_CONTENT";
const TPL_FM = "---\nstatus: draft\npriority: high\n---\nTPL_BODY";
const TPL_TAGS = "---\ntags:\n  - from-template\n---\nTPL_TAGS_BODY";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

type ApplyResult = { ok: boolean; path?: string | null; error?: string };

const getContext = createQuickAddE2EHarness("apply-template");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedFile(sandbox: SandboxApi, name: string, content: string) {
	const { obsidian } = getContext();
	await seedVaultFile(obsidian, sandbox, name, content);
}

/**
 * Opens the note in the active leaf, then calls the public API seam
 * `applyTemplateToActiveFile`. Failures come back as `{ ok: false, error }`
 * so tests can assert on the rejection message.
 */
async function applyTemplate(
	obsidian: ObsidianClient,
	notePath: string,
	templatePath: string,
	mode?: string,
): Promise<ApplyResult> {
	const options = mode ? `{ mode: ${JSON.stringify(mode)} }` : "undefined";

	return obsidian.dev.evalJsonAsync<ApplyResult>(`(async () => {
		try {
			const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
			if (!file) throw new Error("note not found: " + ${JSON.stringify(notePath)});
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(file);
			app.workspace.setActiveLeaf(leaf, { focus: true });
			const result = await app.plugins.plugins.${PLUGIN_ID}.api.applyTemplateToActiveFile(
				${JSON.stringify(templatePath)},
				${options},
			);
			return { ok: true, path: result ? result.path : null };
		} catch (e) {
			return { ok: false, error: String((e && e.message) || e) };
		}
	})()`);
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
		await seedFile(sandbox, "tpl-tags.md", TPL_TAGS);
	});

	it("A00: evalJsonAsync survives QuickAdd console noise on the eval channel (obsidian-e2e#18)", async () => {
		// Focused regression for the envelope corruption this suite used to work
		// around: emit plugin-style log lines while the evaluated code runs and
		// read the JSON result directly. Fails on obsidian-e2e < 0.8.2 with
		// "Unexpected token 'Q', ..." because the noise shared the eval channel.
		const { obsidian } = getContext();

		const result = await obsidian.dev.evalJsonAsync<{ ok: boolean; value: number }>(
			`(async () => {
				console.log("QuickAdd: (LOG) noisy plugin output during eval");
				console.error("QuickAdd: (ERROR) more noise");
				return { ok: true, value: 42 };
			})()`,
		);

		expect(result).toEqual({ ok: true, value: 42 });
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

	it("A06: top with frontmatter - merges template properties, existing scalar values win", async () => {
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

	it.each(["top", "bottom"] as const)(
		"A06b: %s with frontmatter - adds template tags without duplicating existing tags",
		async (mode) => {
			const { obsidian, sandbox } = getContext();
			const noteName = `a06b-tags-${mode}.md`;
			await seedFile(
				sandbox,
				noteName,
				"---\ntags:\n  - existing\n  - shared\n---\nEXISTING_CONTENT",
			);

			const result = await applyTemplate(
				obsidian,
				sandbox.path(noteName),
				sandbox.path("tpl-tags.md"),
				mode,
			);

			expect(result.ok).toBe(true);
			const content = await sandbox.waitForContent(
				noteName,
				(c) => c.includes("TPL_TAGS_BODY") && c.includes("from-template"),
				WAIT_OPTS,
			);

			expect(content).toContain("existing");
			expect(content).toContain("shared");
			expect(content).toContain("from-template");
			expect(content.match(/from-template/g)).toHaveLength(1);
			expect(content.match(/^---$/gm)?.length).toBe(2);
		},
	);

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
