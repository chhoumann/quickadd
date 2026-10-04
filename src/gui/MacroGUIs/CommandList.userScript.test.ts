import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { App, TFile } from "obsidian";
import CommandList from "./CommandList.svelte";
import { createCommandListProps } from "./commandListProps.svelte";
import { UserScript } from "../../types/macros/UserScript";
import { pickUserScript } from "./pickUserScript";
import { loadUserScript } from "../../utils/userScript";

vi.mock("./pickUserScript", () => ({ pickUserScript: vi.fn() }));
vi.mock("../../utils/userScript", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	loadUserScript: vi.fn(),
}));
vi.mock("../../quickAddInstance", () => ({ getQuickAddInstance: vi.fn(() => ({})) }));

function appWithFiles(...paths: string[]) {
	const app = new App();
	app.vault.getAbstractFileByPath = (path: string) => {
		if (!paths.includes(path)) return null;
		const file = new TFile();
		file.path = path;
		return file;
	};
	return app;
}

function renderList(command: UserScript, app = appWithFiles("scripts/hello.js")) {
	const saveCommands = vi.fn();
	const props = createCommandListProps({
		commands: [command],
		app: app as never,
		plugin: {} as never,
		deleteCommand: vi.fn(),
		saveCommands,
	});
	return { ...render(CommandList, { props }), saveCommands };
}

describe("CommandList script step file", () => {
	afterEach(() => {
		vi.mocked(pickUserScript).mockReset();
		document.body.innerHTML = "";
	});

	it("says no file is chosen and offers to choose one", async () => {
		vi.mocked(pickUserScript).mockResolvedValue({ name: "hello", path: "scripts/hello.js" });
		const { getByText, getByRole, queryByLabelText, saveCommands } = renderList(
			new UserScript("Script", ""),
		);

		getByText("No file chosen");
		expect(queryByLabelText("Configure Script")).toBeNull();
		await fireEvent.click(getByRole("button", { name: "Choose file for Script" }));

		await vi.waitFor(() => expect(saveCommands).toHaveBeenCalledTimes(1));
		expect(saveCommands.mock.calls[0][0]).toEqual([
			expect.objectContaining({ name: "hello", path: "scripts/hello.js" }),
		]);
		getByText("scripts/hello.js");
		getByRole("button", { name: "Configure hello" });
	});

	it("keeps the step when the picker is dismissed", async () => {
		vi.mocked(pickUserScript).mockResolvedValue(null);
		const { getByRole, getByText, saveCommands } = renderList(new UserScript("Script", ""));

		await fireEvent.click(getByRole("button", { name: "Choose file for Script" }));
		await Promise.resolve();

		expect(saveCommands).not.toHaveBeenCalled();
		getByText("No file chosen");
	});

	it("says it can't find a file that is not in the vault", async () => {
		const { getByText, getByRole, queryByLabelText } = renderList(
			new UserScript("moved", "scripts/moved.js"),
		);

		getByText("Can't find scripts/moved.js");
		getByRole("button", { name: "Choose file for moved" });
		expect(queryByLabelText("Configure moved")).toBeNull();
	});

	it("shows the file of a step whose file exists, with its settings button", () => {
		const { getByText, getByRole, queryByText } = renderList(
			new UserScript("hello", "scripts/hello.js"),
		);

		getByText("scripts/hello.js");
		getByRole("button", { name: "Configure hello" });
		expect(queryByText("Choose file")).toBeNull();
	});

	it("shows the file changed from the script's settings", async () => {
		vi.mocked(loadUserScript).mockResolvedValue({ script: () => {}, settings: {} } as never);
		vi.mocked(pickUserScript).mockResolvedValue({ name: "other", path: "scripts/other.js" });
		const { getByRole, findByText, saveCommands } = renderList(
			new UserScript("hello", "scripts/hello.js"),
			appWithFiles("scripts/hello.js", "scripts/other.js"),
		);

		await fireEvent.click(getByRole("button", { name: "Configure hello" }));
		const change = await vi.waitFor(() => {
			const button = Array.from(document.querySelectorAll("button")).find(
				(b) => b.textContent === "Change",
			);
			if (!button) throw new Error("Change button not found");
			return button;
		});
		await fireEvent.click(change);

		await findByText("scripts/other.js");
		getByRole("button", { name: "Configure other" });
		expect(saveCommands.mock.lastCall?.[0]).toEqual([
			expect.objectContaining({ name: "other", path: "scripts/other.js" }),
		]);
	});
});
