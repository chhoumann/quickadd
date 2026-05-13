export type DevelopmentInfo = {
	branch: string | null;
	commit: string | null;
	dirty: boolean | null;
};

function appendDevelopmentInfoRow(
	container: HTMLElement,
	label: string,
	value: string,
	options?: { className?: string },
): HTMLElement {
	const row = document.createElement("div");
	const labelEl = document.createElement("strong");
	labelEl.textContent = label;
	row.appendChild(labelEl);
	row.appendChild(document.createTextNode(` ${value}`));
	if (options?.className) row.classList.add(options.className);
	row.style.marginBottom = "5px";
	container.appendChild(row);
	return row;
}

export function renderDevelopmentInfo(
	container: HTMLElement,
	info: DevelopmentInfo,
): void {
	if (info.branch !== null) {
		appendDevelopmentInfoRow(container, "Branch:", info.branch);
	}

	if (info.commit !== null) {
		appendDevelopmentInfoRow(container, "Commit:", info.commit);
	}

	if (info.dirty !== null) {
		const statusText = info.dirty ? "Yes (uncommitted changes)" : "No";
		const statusClass = info.dirty
			? "qa-dev-dirty-status"
			: "qa-dev-clean-status";
		appendDevelopmentInfoRow(
			container,
			"Uncommitted changes:",
			statusText,
			{ className: statusClass },
		);
	}
}
