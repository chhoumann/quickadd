export interface PreservedUiContextOptions {
	scrollRootSelector?: string;
	restoreFocus?: boolean;
	restorePhase?: "immediate" | "animationFrame" | "both";
}

type ScrollSnapshot = {
	key: string;
	top: number;
	left: number;
};

type SelectionDirection = "forward" | "backward" | "none";

type ActiveElementSnapshot = {
	qaKey?: string;
	id?: string;
	name?: string;
	placeholder?: string;
	tagName: string;
	inputType?: string;
	focusIndex: number;
	selection?: {
		start: number;
		end: number;
		direction: SelectionDirection;
	};
};

type UiSnapshot = {
	scroll: ScrollSnapshot[];
	active?: ActiveElementSnapshot;
};

const FOCUSABLE_SELECTOR =
	"input, textarea, select, button, [tabindex]:not([tabindex='-1'])";

function getScopeRoot(root: HTMLElement): HTMLElement {
	return (root.closest(".modal") as HTMLElement | null) ?? root;
}

function normalizeSelectionDirection(
	direction: string | null | undefined,
): SelectionDirection {
	if (direction === "backward" || direction === "forward") return direction;
	return "none";
}

function getFocusableElements(scopeRoot: HTMLElement): HTMLElement[] {
	return Array.from(scopeRoot.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
		(el) => el instanceof HTMLElement,
	) as HTMLElement[];
}

function getScrollTargets(
	root: HTMLElement,
	options?: PreservedUiContextOptions,
): Map<string, HTMLElement> {
	const targets = new Map<string, HTMLElement>();
	const scopeRoot = getScopeRoot(root);
	const modalContent = root.closest(".modal-content") as HTMLElement | null;

	if (modalContent) targets.set("modal-content", modalContent);
	targets.set("root", root);

	if (options?.scrollRootSelector) {
		scopeRoot
			.querySelectorAll(options.scrollRootSelector)
			.forEach((el, index) => {
				if (!(el instanceof HTMLElement)) return;
				targets.set(`selector:${index}`, el);
			});
	}

	scopeRoot.querySelectorAll("[data-qa-scroll]").forEach((el, index) => {
		if (!(el instanceof HTMLElement)) return;
		const key = el.dataset.qaScroll || `qa-scroll:${index}`;
		targets.set(`qa-scroll:${key}`, el);
	});

	return targets;
}

function captureActiveElement(root: HTMLElement): ActiveElementSnapshot | undefined {
	const doc = root.ownerDocument;
	const activeElement = doc.activeElement;
	if (!(activeElement instanceof HTMLElement)) return undefined;

	const scopeRoot = getScopeRoot(root);
	if (!scopeRoot.contains(activeElement)) return undefined;

	const focusables = getFocusableElements(scopeRoot);
	const focusIndex = Math.max(0, focusables.indexOf(activeElement));

	const snapshot: ActiveElementSnapshot = {
		qaKey: activeElement.dataset.qaKey,
		id: activeElement.id || undefined,
		name: activeElement.getAttribute("name") || undefined,
		placeholder:
			activeElement instanceof HTMLInputElement ||
			activeElement instanceof HTMLTextAreaElement
				? activeElement.placeholder || undefined
				: undefined,
		tagName: activeElement.tagName,
		inputType:
			activeElement instanceof HTMLInputElement
				? activeElement.type
				: undefined,
		focusIndex,
	};

	if (
		activeElement instanceof HTMLInputElement ||
		activeElement instanceof HTMLTextAreaElement
	) {
		if (
			activeElement.selectionStart !== null &&
			activeElement.selectionEnd !== null
		) {
			snapshot.selection = {
				start: activeElement.selectionStart,
				end: activeElement.selectionEnd,
				direction: normalizeSelectionDirection(activeElement.selectionDirection),
			};
		}
	}

	return snapshot;
}

function captureUiSnapshot(
	root: HTMLElement,
	options?: PreservedUiContextOptions,
): UiSnapshot {
	const scrollTargets = getScrollTargets(root, options);
	const scroll: ScrollSnapshot[] = Array.from(scrollTargets.entries()).map(
		([key, el]) => ({
			key,
			top: el.scrollTop,
			left: el.scrollLeft,
		}),
	);

	return {
		scroll,
		active: captureActiveElement(root),
	};
}

function escapeAttributeValue(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("\n", "\\n");
}

function findActiveElement(
	root: HTMLElement,
	snapshot: ActiveElementSnapshot,
): HTMLElement | null {
	const scopeRoot = getScopeRoot(root);

	if (snapshot.qaKey) {
		const byQaKey = scopeRoot.querySelector(
			`[data-qa-key="${escapeAttributeValue(snapshot.qaKey)}"]`,
		);
		if (byQaKey instanceof HTMLElement) return byQaKey;
	}

	if (snapshot.id) {
		const byId = scopeRoot.querySelector(`#${escapeAttributeValue(snapshot.id)}`);
		if (byId instanceof HTMLElement) return byId;
	}

	if (snapshot.name) {
		const byName = scopeRoot.querySelector(
			`${snapshot.tagName}[name="${escapeAttributeValue(snapshot.name)}"]`,
		);
		if (byName instanceof HTMLElement) return byName;
	}

	if (snapshot.placeholder) {
		const byPlaceholder = scopeRoot.querySelector(
			`${snapshot.tagName}[placeholder="${escapeAttributeValue(snapshot.placeholder)}"]`,
		);
		if (byPlaceholder instanceof HTMLElement) return byPlaceholder;
	}

	const focusables = getFocusableElements(scopeRoot);
	return focusables[snapshot.focusIndex] ?? null;
}

function restoreUiSnapshot(
	root: HTMLElement,
	snapshot: UiSnapshot,
	scrollTargets: Map<string, HTMLElement>,
	options?: PreservedUiContextOptions,
) {
	for (const scroll of snapshot.scroll) {
		const target = scrollTargets.get(scroll.key);
		if (!target) continue;
		target.scrollTop = scroll.top;
		target.scrollLeft = scroll.left;
	}

	if (options?.restoreFocus === false || !snapshot.active) return;

	const target = findActiveElement(root, snapshot.active);
	if (!(target instanceof HTMLElement)) return;

	try {
		target.focus({ preventScroll: true });
	} catch {
		target.focus();
	}

	if (
		snapshot.active.selection &&
		(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
	) {
		try {
			target.setSelectionRange(
				snapshot.active.selection.start,
				snapshot.active.selection.end,
				snapshot.active.selection.direction,
			);
		} catch {
			// noop - some input types do not support setting selection range.
		}
	}
}

function scheduleRestore(
	root: HTMLElement,
	snapshot: UiSnapshot,
	options?: PreservedUiContextOptions,
) {
	// "both" is the default to handle immediate sync rebuilds and layout work
	// that lands on the next frame; callers can now opt into a single phase.
	const restoreTargets = getScrollTargets(root, options);
	const restore = () => restoreUiSnapshot(root, snapshot, restoreTargets, options);
	const phase = options?.restorePhase ?? "both";
	if (phase === "immediate" || phase === "both") {
		restore();
	}

	const win = root.ownerDocument.defaultView;
	if (!win) return;

	if (
		(phase === "animationFrame" || phase === "both") &&
		typeof win.requestAnimationFrame === "function"
	) {
		win.requestAnimationFrame(() => {
			restore();
		});
		return;
	}

	if (phase === "animationFrame") {
		restore();
	}
}

export function withPreservedUiContext(
	root: HTMLElement,
	rebuild: () => void,
	options?: PreservedUiContextOptions,
): void {
	const snapshot = captureUiSnapshot(root, options);
	rebuild();
	scheduleRestore(root, snapshot, options);
}
