import { fireEvent, render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import { beforeEach, describe, expect, it } from "vitest";
import { settingNames } from "../../../../tests/helpers/settings/fields";
import { DEFAULT_SETTINGS } from "../../../settings";
import { settingsStore } from "../../../settingsStore";
import { CaptureChoice } from "../../../types/choices/CaptureChoice";
import type IChoice from "../../../types/choices/IChoice";
import { migrateSettingsV2 } from "../../../v3/migrate";
import type { ActionNode } from "../../../v3/model";
import { findAction } from "../../../v3/storage";
import RibbonSetting from "./RibbonSetting.svelte";

const inbox = Object.assign(new CaptureChoice("Inbox"), { id: "inbox" });

function useSettings(choices: IChoice[], migrated = true) {
	const { actions } = migrateSettingsV2({ choices: JSON.parse(JSON.stringify(choices)) });
	settingsStore.replaceState({
		...structuredClone(DEFAULT_SETTINGS),
		migrations: { ...DEFAULT_SETTINGS.migrations, migrateToV3Actions: migrated },
		choices,
		...(migrated ? { actions } : {}),
	});
}

const toggle = (container: HTMLElement) =>
	container.querySelector<HTMLElement>('[role="switch"][aria-label="Show in ribbon"]');

const stored = (id: string): ActionNode | undefined => findAction(settingsStore.getState().actions, id);

describe("RibbonSetting", () => {
	beforeEach(() => useSettings([inbox]));

	it("shows the action in the ribbon when flipped on, and takes it out when flipped off", async () => {
		const { container } = render(RibbonSetting, { props: { choiceId: "inbox" } });
		expect(settingNames(container)).toEqual(["Show in ribbon"]);
		expect(toggle(container)?.getAttribute("aria-checked")).toBe("false");

		await fireEvent.click(toggle(container)!);
		flushSync();
		expect(stored("inbox")).toMatchObject({ show: { ribbon: true } });

		await fireEvent.click(toggle(container)!);
		flushSync();
		expect(stored("inbox")).not.toHaveProperty("show.ribbon");
	});

	it("reads what the action holds", () => {
		const actions = settingsStore.getState().actions as ActionNode[];
		settingsStore.setState({ actions: [{ ...actions[0], show: { command: true, ribbon: true } } as ActionNode] });
		const { container } = render(RibbonSetting, { props: { choiceId: "inbox" } });
		expect(toggle(container)?.getAttribute("aria-checked")).toBe("true");
	});

	it("works for a choice added since the last save", async () => {
		const added = Object.assign(new CaptureChoice("Added"), { id: "added" });
		settingsStore.setState({ choices: [inbox, added] });
		const { container } = render(RibbonSetting, { props: { choiceId: "added" } });

		await fireEvent.click(toggle(container)!);
		flushSync();
		expect(stored("added")).toMatchObject({ name: "Added", show: { ribbon: true } });
	});

	it("is not offered before the choices moved to actions, or for a choice nested in a macro", () => {
		expect(settingNames(render(RibbonSetting, { props: { choiceId: "nested" } }).container)).toEqual([]);
		useSettings([inbox], false);
		expect(settingNames(render(RibbonSetting, { props: { choiceId: "inbox" } }).container)).toEqual([]);
	});
});
