export default function invariant(
	condition: unknown,
	message?: string | (() => string)
): void {
	if (!condition) {
		throw new Error(typeof message === "function" ? message() : message);
	}

	return;
}
