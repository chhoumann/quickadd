import Fuse from "fuse.js";
import type { IndexedFile } from "../gui/suggesters/FileIndex";
import type { WorkerRequest, WorkerResponse, IndexOperation } from "../types/workerMessages";

type IncomingMessage = WorkerRequest;

// In the worker context, `self` refers to the global scope. Typing with `any` avoids lib dependency issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const self: any;

let fuseInstance: Fuse<IndexedFile> | null = null;
let index: Map<string, IndexedFile> = new Map();

self.onmessage = (e: MessageEvent<IncomingMessage>) => {
	const data = e.data;
	if (data.type === "updateIndex") {
		processUpdates(data.updates, data.currentIndex);
	} else if (data.type === "search") {
		performSearch(data.query);
	}
};

function buildFuse() {
	fuseInstance = new Fuse(Array.from(index.values()), {
		keys: [
			{ name: "basename", weight: 0.8 },
			{ name: "aliases", weight: 0.6 },
			{ name: "path", weight: 0.2 },
		],
		ignoreLocation: true,
		findAllMatches: true,
		shouldSort: true,
	});
}

function processUpdates(
	updates: Array<[string, IndexOperation]>,
	currentIndex: Array<[string, unknown]>
) {
	// Start from the provided snapshot (cast unknown -> IndexedFile safely)
	index = new Map(currentIndex as Array<[string, IndexedFile]>);

	for (const [path, operation] of updates) {
		if (operation === "delete") {
			index.delete(path);
			continue;
		}

		// For add / update; rely on existing snapshot item
		// The main thread already placed the new IndexedFile in the snapshot
	}

	buildFuse();

	self.postMessage({
		type: "indexUpdated",
		index: Array.from(index.entries()),
	});
}

function performSearch(query: string) {
	if (!fuseInstance) return;
	const results = fuseInstance.search(query);
	self.postMessage({ type: "searchResults", results });
}