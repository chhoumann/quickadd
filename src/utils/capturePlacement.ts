export type CaptureCursor =
	| { readonly kind: "none" }
	| {
			readonly kind: "offset";
			readonly value: number;
			readonly source: "marker" | "defaultEnd";
	  };

export type CapturePlacementResult = Readonly<{
	content: string;
	cursor: CaptureCursor;
}>;

export function stripCursorMarkers(content: string): string {
	return content.replace(/\{\{CURSOR\}\}/gi, "");
}

export function prepareCapture(content: string): CapturePlacementResult {
	const marker = /\{\{CURSOR\}\}/i.exec(content);
	content = stripCursorMarkers(content);
	return {
		content,
		cursor: /^[ \t\r\n\f\v]*$/.test(content)
			? { kind: "none" }
			: {
					kind: "offset",
					value: marker?.index ?? content.length,
					source: marker ? "marker" : "defaultEnd",
			  },
	};
}

export function surroundCapture(
	payload: CapturePlacementResult,
	before: string,
	after = "",
): CapturePlacementResult {
	return {
		content: before + payload.content + after,
		cursor: payload.cursor.kind === "none"
			? payload.cursor
			: { ...payload.cursor, value: before.length + payload.cursor.value },
	};
}

export function placeCapture(
	payload: CapturePlacementResult,
	content: string,
	offset: number | null,
): CapturePlacementResult {
	return {
		content,
		cursor: payload.cursor.kind === "none" || offset === null
			? { kind: "none" }
			: { ...payload.cursor, value: offset },
	};
}
