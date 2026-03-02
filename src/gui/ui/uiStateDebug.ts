export interface QuickAddUiDebugStats {
	choiceBuilderMounts: number;
	choiceBuilderReloads: number;
}

const stats: QuickAddUiDebugStats = {
	choiceBuilderMounts: 0,
	choiceBuilderReloads: 0,
};

export function recordChoiceBuilderMount(): void {
	stats.choiceBuilderMounts += 1;
}

export function recordChoiceBuilderReload(): void {
	stats.choiceBuilderReloads += 1;
}

export function getQuickAddUiDebugStats(): QuickAddUiDebugStats {
	return { ...stats };
}

export function resetQuickAddUiDebugStats(): void {
	stats.choiceBuilderMounts = 0;
	stats.choiceBuilderReloads = 0;
}
