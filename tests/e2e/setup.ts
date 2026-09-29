import { beforeEach } from "vitest";
import { createQuickAddObsidianClient } from "./e2eVault";
import { takeInputLog } from "./uiHelpers";

const obsidian = createQuickAddObsidianClient();

beforeEach(async (ctx) => {
	// Notices outlive the spec that raised them. They stack from the top-right
	// corner over any modal, so a busy earlier spec can cover a button this test
	// clicks, or leave a notice this test asserts on.
	await obsidian.dev.evalJson(`(() => {
		for (const notice of document.querySelectorAll(".notice")) notice.remove();
		return true;
	})()`);
	takeInputLog();
	ctx.onTestFailed(() => {
		const log = takeInputLog();
		if (log.length > 0) console.warn(`Native input sent by "${ctx.task.name}":\n${log.join("\n")}`);
	});
});
