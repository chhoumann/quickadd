import { afterEach, describe, expect, it } from "vitest";
import { uiStore } from "./uiStore";

describe("uiStore", () => {
	afterEach(() => {
		uiStore.setState({ collapsedChoiceIds: {} });
	});

	it("prunes stale collapsed choice ids", () => {
		uiStore.setState({
			collapsedChoiceIds: {
				a: true,
				b: true,
				c: true,
			},
		});

		uiStore.pruneCollapsedChoiceIds(["a", "c"]);

		expect(uiStore.getState().collapsedChoiceIds).toEqual({
			a: true,
			c: true,
		});
	});
});
