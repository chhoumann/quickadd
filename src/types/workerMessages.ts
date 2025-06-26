export type IndexOperation = "add" | "update" | "delete";

export interface UpdateIndexMessage {
	type: "updateIndex";
	updates: Array<[string, IndexOperation]>;
	currentIndex: Array<[string, unknown]>; // use unknown to avoid dependency cycle
}

export interface SearchMessage {
	type: "search";
	query: string;
}

export interface IndexUpdatedMessage {
	type: "indexUpdated";
	index: Array<[string, unknown]>;
}

export interface SearchResultsMessage {
	type: "searchResults";
	results: unknown;
}

export interface IndexFailedMessage {
	type: "indexFailed";
	error: string;
}

export interface SearchFailedMessage {
	type: "searchFailed";
	error: string;
}

export interface MemoryPressureMessage {
	type: "memoryPressure";
	used: number;
}

export interface MemoryPressureClearedMessage {
	type: "memoryPressureCleared";
}

export type WorkerRequest = UpdateIndexMessage | SearchMessage;
export type WorkerResponse = IndexUpdatedMessage | SearchResultsMessage | IndexFailedMessage | SearchFailedMessage | MemoryPressureMessage | MemoryPressureClearedMessage;