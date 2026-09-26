import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import moment from "moment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scriptPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../docs/public/scripts/TodoistScript.js",
);

type ScriptFn = (params: unknown, settings: Record<string, unknown>) => Promise<string>;
type TodoistScript = {
	entry: ScriptFn;
	settings: { options: Record<string, { type: string; id?: string; defaultValue?: unknown }> };
	SelectFromAllTasks: ScriptFn;
	GetAllTasksFromProject: ScriptFn;
	GetAllTasksFromSection: ScriptFn;
};

const TOKEN = "Todoist API token";
const COMPLETE = "Complete imported tasks in Todoist";

function loadScript(): TodoistScript {
	const source = readFileSync(scriptPath, "utf8");
	const module = { exports: {} as TodoistScript };
	new Function("module", "exports", source)(module, module.exports);
	return module.exports;
}

type Task = {
	id: string;
	content: string;
	project_id: string;
	section_id: string | null;
	due: { date: string } | null;
};

const projects = [
	{ id: "p-home", name: "Home" },
	{ id: "p-work", name: "Work" },
];
const sections = [
	{ id: "s-errands", project_id: "p-home", name: "Errands" },
	{ id: "s-garden", project_id: "p-home", name: "Garden" },
];
// More tasks than one page, so a client that ignores `next_cursor` misses some.
const tasks: Task[] = [
	{ id: "t1", content: "Buy oat milk", project_id: "p-home", section_id: "s-errands", due: { date: "2031-01-15" } },
	{ id: "t2", content: "Return library books", project_id: "p-home", section_id: "s-errands", due: null },
	{ id: "t3", content: "Water the plants", project_id: "p-home", section_id: "s-garden", due: { date: "2031-03-20T09:00:00" } },
	{ id: "t4", content: "Plan picnic", project_id: "p-home", section_id: null, due: null },
	{ id: "t5", content: "Send report", project_id: "p-work", section_id: null, due: { date: "2031-02-03T23:30:00Z" } },
	{ id: "t6", content: "Plan picnic", project_id: "p-work", section_id: null, due: null },
];

const PAGE_SIZE = 2;

function createTodoist(options: { status?: number; failClose?: string[] } = {}) {
	const closed: string[] = [];
	const requests: Array<{ method: string; url: string; auth?: string }> = [];

	const requestUrl = vi.fn(
		async (request: { url: string; method?: string; headers?: Record<string, string> }) => {
			const method = request.method ?? "GET";
			requests.push({ method, url: request.url, auth: request.headers?.Authorization });
			if (options.status) return { status: options.status, text: "", json: null };

			const url = new URL(request.url);
			expect(url.origin + url.pathname.replace(/\/[^/]+(\/close)$/, "/:id$1")).toMatch(
				/^https:\/\/api\.todoist\.com\/api\/v1\/(tasks|projects|sections|tasks\/:id\/close)$/,
			);

			const close = url.pathname.match(/\/tasks\/([^/]+)\/close$/);
			if (close && method === "POST") {
				if (options.failClose?.includes(close[1])) return { status: 500, text: "", json: null };
				closed.push(close[1]);
				return { status: 204, text: "", json: null };
			}

			const collection = { tasks, projects, sections }[url.pathname.split("/").pop() as string];
			if (!collection || method !== "GET") return { status: 404, text: "", json: null };
			expect(Number(url.searchParams.get("limit"))).toBeLessThanOrEqual(200);
			const start = Number(url.searchParams.get("cursor") ?? 0);
			const end = start + PAGE_SIZE;
			const body = {
				results: collection.slice(start, end),
				next_cursor: end < collection.length ? String(end) : null,
			};
			return { status: 200, text: JSON.stringify(body), json: body };
		},
	);

	return { requestUrl, closed, requests };
}

function setup(options: {
	settings?: Record<string, unknown>;
	suggest?: (labels: string[]) => number;
	check?: (labels: string[]) => string[];
	status?: number;
	failClose?: string[];
} = {}) {
	const todoist = createTodoist({ status: options.status, failClose: options.failClose });
	const notices: string[] = [];
	const suggester = vi.fn(async (labels: string[], items: unknown[]) =>
		items[options.suggest ? options.suggest(labels) : 0],
	);
	const checkboxPrompt = vi.fn(async (labels: string[]) => options.check?.(labels) ?? []);
	const params = {
		obsidian: {
			requestUrl: todoist.requestUrl,
			Notice: class {
				constructor(message: string) {
					notices.push(message);
				}
			},
		},
		quickAddApi: { suggester, checkboxPrompt },
	};
	const settings = { [TOKEN]: "test-token", [COMPLETE]: true, ...options.settings };
	return { params, settings, notices, suggester, checkboxPrompt, ...todoist };
}

function localDate(iso: string) {
	const d = new Date(iso);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("Todoist example script", () => {
	beforeEach(() => {
		(window as unknown as { moment: typeof moment }).moment = moment;
	});
	afterEach(() => {
		delete (window as unknown as { moment?: typeof moment }).moment;
	});

	it("declares the API token as a secret setting and completion as an opt-out checkbox", () => {
		const { settings } = loadScript();
		expect(settings.options[TOKEN]).toMatchObject({ type: "secret", id: "todoist-api-token" });
		expect(settings.options[COMPLETE]).toMatchObject({ type: "checkbox", defaultValue: true });
	});

	it("imports every task in a project, across pages and sections, then completes them", async () => {
		const ctx = setup({ suggest: (labels) => labels.indexOf("Home (4)") });

		const output = await loadScript().GetAllTasksFromProject(ctx.params, ctx.settings);

		expect(output).toBe(
			[
				"- [ ] Buy oat milk 📅 2031-01-15",
				"- [ ] Return library books",
				"- [ ] Water the plants 📅 2031-03-20",
				"- [ ] Plan picnic",
				"",
			].join("\n"),
		);
		expect(ctx.suggester.mock.calls[0][0]).toEqual(["Home (4)", "Work (2)"]);
		expect(ctx.closed).toEqual(["t1", "t2", "t3", "t4"]);
		expect(ctx.notices).toEqual(["Added 4 tasks from 'Home'."]);
		expect(new Set(ctx.requests.map((r) => r.auth))).toEqual(new Set(["Bearer test-token"]));
	});

	it("imports only the chosen section's tasks", async () => {
		const ctx = setup({ suggest: (labels) => labels.indexOf("Home > Garden (1)") });

		const output = await loadScript().GetAllTasksFromSection(ctx.params, ctx.settings);

		expect(ctx.suggester.mock.calls[0][0]).toEqual(["Home > Errands (2)", "Home > Garden (1)"]);
		expect(output).toBe("- [ ] Water the plants 📅 2031-03-20\n");
		expect(ctx.closed).toEqual(["t3"]);
	});

	it("imports only the checked tasks, telling apart tasks with the same name", async () => {
		const ctx = setup({ check: (labels) => [labels[5]] });

		const output = await loadScript().SelectFromAllTasks(ctx.params, ctx.settings);

		expect(ctx.checkboxPrompt.mock.calls[0][0]).toHaveLength(6);
		expect(output).toBe("- [ ] Plan picnic\n");
		expect(ctx.closed).toEqual(["t6"]);
	});

	it("writes a fixed-time-zone due date (UTC in the API) as the local date", async () => {
		const originalTz = process.env.TZ;
		process.env.TZ = "Asia/Tokyo"; // 2031-02-03T23:30Z is 08:30 on Feb 4 in Tokyo
		try {
			const ctx = setup({ check: (labels) => labels.filter((l) => l.endsWith("Send report")) });

			const output = await loadScript().SelectFromAllTasks(ctx.params, ctx.settings);

			expect(output).toBe("- [ ] Send report 📅 2031-02-04\n");
		} finally {
			if (originalTz === undefined) delete process.env.TZ;
			else process.env.TZ = originalTz;
		}
	});

	it("leaves tasks open in Todoist when completion is turned off", async () => {
		const ctx = setup({ settings: { [COMPLETE]: false }, suggest: (labels) => labels.indexOf("Work (2)") });

		const output = await loadScript().GetAllTasksFromProject(ctx.params, ctx.settings);

		expect(output).toBe(`- [ ] Send report 📅 ${localDate("2031-02-03T23:30:00Z")}\n- [ ] Plan picnic\n`);
		expect(ctx.closed).toEqual([]);
		expect(ctx.requests.every((r) => r.method === "GET")).toBe(true);
	});

	it("still returns the capture and completes the rest when a mid-batch close fails", async () => {
		const ctx = setup({ failClose: ["t2"], suggest: (labels) => labels.indexOf("Home (4)") });
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		const output = await loadScript().GetAllTasksFromProject(ctx.params, ctx.settings);

		expect(output).toBe(
			[
				"- [ ] Buy oat milk 📅 2031-01-15",
				"- [ ] Return library books",
				"- [ ] Water the plants 📅 2031-03-20",
				"- [ ] Plan picnic",
				"",
			].join("\n"),
		);
		expect(ctx.closed).toEqual(["t1", "t3", "t4"]);
		expect(ctx.notices).toEqual([
			"Could not complete 1 of 4 imported tasks in Todoist; they are still open there.",
			"Added 4 tasks from 'Home'.",
		]);
	});

	it("imports nothing when no task is checked", async () => {
		const ctx = setup({ check: () => [] });

		const output = await loadScript().SelectFromAllTasks(ctx.params, ctx.settings);

		expect(output).toBe("");
		expect(ctx.closed).toEqual([]);
	});

	it("asks which export to run when the macro calls the script without `::`", async () => {
		const ctx = setup({
			suggest: (labels) =>
				labels.includes("GetAllTasksFromSection") ? labels.indexOf("GetAllTasksFromSection") : 0,
		});

		const output = await loadScript().entry(ctx.params, ctx.settings);

		expect(ctx.suggester.mock.calls[0][0]).toEqual([
			"SelectFromAllTasks",
			"GetAllTasksFromProject",
			"GetAllTasksFromSection",
		]);
		expect(output).toBe("- [ ] Buy oat milk 📅 2031-01-15\n- [ ] Return library books\n");
	});

	it("explains a missing token without calling Todoist", async () => {
		const ctx = setup({ settings: { [TOKEN]: "" } });

		await expect(loadScript().GetAllTasksFromProject(ctx.params, ctx.settings)).rejects.toThrow(
			/Add your Todoist API token/,
		);
		expect(ctx.requestUrl).not.toHaveBeenCalled();
	});

	it("explains a rejected token", async () => {
		const ctx = setup({ status: 401 });

		await expect(loadScript().SelectFromAllTasks(ctx.params, ctx.settings)).rejects.toThrow(
			"Todoist rejected the API token (HTTP 401).",
		);
	});
});
