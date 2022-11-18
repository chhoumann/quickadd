import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import * as ReactDOM from "react-dom";
import ReactView from "./ReactView";
import { createRoot, Root } from "react-dom/client";
import { AppContext } from "./context";

class ReactExampleView extends ItemView {
	private root: Root;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return "react-example";
	}

	getDisplayText(): string {
		return "React Example";
	}

	getIcon(): string {
		return "star";
	}

	async onOpen() {
		this.root = createRoot(this.containerEl.children[1]);
		this.root.render(
			<React.StrictMode>
				<AppContext.Provider value={this.app}>
					<ReactView />
				</AppContext.Provider>
			</React.StrictMode>
		);
	}

	async onClose() {
		this.root.unmount();
	}
}

export default ReactExampleView;
