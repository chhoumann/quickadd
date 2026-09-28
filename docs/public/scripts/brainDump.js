const CAPTURE_CHOICE = "Capture choice";

module.exports = {
	entry: start,
	settings: {
		name: "Brain dump",
		author: "QuickAdd",
		options: {
			[CAPTURE_CHOICE]: {
				type: "text",
				defaultValue: "Add to inbox",
				placeholder: "Add to inbox",
				description: "The Capture choice to open again after each entry",
			},
		},
	},
};

async function start(params, settings) {
	const choice =
		String(settings?.[CAPTURE_CHOICE] ?? "").trim() || "Add to inbox";

	// Each entry runs the Capture once. Press Esc (or Cancel) to stop.
	while (true) {
		const started = Date.now();
		await params.quickAddApi.executeChoice(choice);

		// A Capture that never asks for input would repeat forever.
		if (Date.now() - started < 300) {
			new params.obsidian.Notice(
				`Brain dump stopped: "${choice}" didn't ask for any input.`,
			);
			return;
		}
	}
}
