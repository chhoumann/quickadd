import { settingsStore } from "src/settingsStore";

/**
 * Throws when the user turned online features off. Every outbound AI request
 * and model lookup checks this before touching the network.
 */
export function assertOnlineFeaturesEnabled(
	message = "Blocking request: Online features are disabled in settings.",
): void {
	if (settingsStore.getState().disableOnlineFeatures) throw new Error(message);
}
