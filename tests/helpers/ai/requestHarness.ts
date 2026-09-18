import { vi } from "vitest";
import type { App } from "obsidian";

const storeState = vi.hoisted(() => ({
	disableOnlineFeatures: false,
}));

const mocks = vi.hoisted(() => ({
	requestUrlMock: vi.fn(),
	beginAIRequestLogEntryMock: vi.fn(),
	finishAIRequestLogEntryMock: vi.fn(),
	getModelProviderMock: vi.fn(),
	logMessageMock: vi.fn(),
	logErrorMock: vi.fn(),
	noticeMock: vi.fn(),
}));

vi.mock("obsidian", () => ({
	requestUrl: mocks.requestUrlMock,
	Notice: mocks.noticeMock,
}));

vi.mock("src/settingsStore", () => ({
	settingsStore: {
		getState: () => storeState,
	},
}));

vi.mock("src/ai/requestLog", () => ({
	beginAIRequestLogEntry: mocks.beginAIRequestLogEntryMock,
	finishAIRequestLogEntry: mocks.finishAIRequestLogEntryMock,
}));

vi.mock("src/ai/aiHelpers", () => ({
	getModelProvider: mocks.getModelProviderMock,
}));

vi.mock("src/logger/logManager", () => ({
	log: {
		logMessage: mocks.logMessageMock,
		logError: mocks.logErrorMock,
	},
}));

export function makeApp(): App {
	return { workspace: { activeEditor: undefined } } as unknown as App;
}

export { storeState, mocks };
