import * as React from "react";
import { createRoot } from "react-dom/client";
import { Choice } from "src/types/choices/Choice";
import { AppContext } from "../context";
import ActionsView from "../ChoiceView";

interface Props {
	choices: Choice[];
}

export default function Create(rootEl: HTMLElement, props: Props) {
	const root = createRoot(rootEl);

	root.render(
		<React.StrictMode>
			<AppContext.Provider value={this.app}>
				<ActionsView {...props} />
			</AppContext.Provider>
		</React.StrictMode>
	);

	return root;
}
