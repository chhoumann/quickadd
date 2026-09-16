import type { OpenAIModelParameters } from "./OpenAIModelParameters";

export interface AIRequestLogEntry {
	id: string;
	createdAt: number;
	provider: string;
	endpoint: string;
	model: string;
	systemPrompt: string;
	prompt: string;
	modelOptions: Partial<OpenAIModelParameters>;
	status: "pending" | "success" | "error";
	durationMs?: number;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	errorMessage?: string;
}

const MAX_AI_REQUEST_LOG_ENTRIES = 25;
const aiRequestLogEntries: AIRequestLogEntry[] = [];

function cloneRequestLogEntry(entry: AIRequestLogEntry): AIRequestLogEntry {
	return {
		...entry,
		modelOptions: { ...entry.modelOptions },
		usage: entry.usage ? { ...entry.usage } : undefined,
	};
}

export function beginAIRequestLogEntry(
	entry: Omit<AIRequestLogEntry, "id" | "createdAt" | "status">
): string {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const createdAt = Date.now();

	aiRequestLogEntries.push({
		...entry,
		modelOptions: { ...(entry.modelOptions ?? {}) },
		id,
		createdAt,
		status: "pending",
	});

	trimAIRequestLogEntries();

	return id;
}

export function finishAIRequestLogEntry(
	id: string,
	result: Omit<AIRequestLogEntry, "id" | "createdAt" | "provider" | "endpoint" | "model" | "systemPrompt" | "prompt" | "modelOptions">
) {
	const entry = aiRequestLogEntries.find((item) => item.id === id);
	if (!entry) return;

	entry.status = result.status;
	entry.durationMs = result.durationMs;
	entry.usage = result.usage;
	entry.errorMessage = result.errorMessage;

	trimAIRequestLogEntries();
}

export function getAIRequestLogEntries(limit = 10): AIRequestLogEntry[] {
	if (!Number.isFinite(limit)) {
		limit = 10;
	}

	const boundedLimit = Math.floor(limit);
	if (boundedLimit <= 0) return [];

	return aiRequestLogEntries
		.slice(-boundedLimit)
		.map(cloneRequestLogEntry)
		.reverse();
}

function trimAIRequestLogEntries() {
	if (aiRequestLogEntries.length <= MAX_AI_REQUEST_LOG_ENTRIES) return;

	let overflow = aiRequestLogEntries.length - MAX_AI_REQUEST_LOG_ENTRIES;
	while (overflow > 0) {
		const oldestCompletedIndex = aiRequestLogEntries.findIndex(
			(item) => item.status !== "pending"
		);
		if (oldestCompletedIndex === -1) {
			// Avoid dropping in-flight entries. We'll trim once requests finish.
			break;
		}

		aiRequestLogEntries.splice(oldestCompletedIndex, 1);
		overflow -= 1;
	}
}

export function getAIRequestLogEntryById(
	id: string
): AIRequestLogEntry | null {
	const entry = aiRequestLogEntries.find((item) => item.id === id);
	return entry ? cloneRequestLogEntry(entry) : null;
}

export function getLastAIRequestLogEntry(): AIRequestLogEntry | null {
	const latest = aiRequestLogEntries[aiRequestLogEntries.length - 1];
	return latest ? cloneRequestLogEntry(latest) : null;
}

export function clearAIRequestLogEntries(): void {
	aiRequestLogEntries.splice(0, aiRequestLogEntries.length);
}
