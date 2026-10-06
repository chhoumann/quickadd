import { refuse } from "../errors/RefusalError";

/** An AI request while the user has turned online features off. */
export function onlineFeaturesOffRefusal() {
	return refuse("Online features are off", "the AI request was not sent", "Turn off \"Disable AI & online features\" in QuickAdd's settings.");
}

/** An AI step whose model no provider offers. */
export function unknownModelRefusal(model: string) {
	return refuse(`No AI provider offers the model ${model}`, "the AI request was not sent", "Pick a model on the step's row.");
}
