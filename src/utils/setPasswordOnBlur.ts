export function setPasswordOnBlur(el: HTMLInputElement) {
	el.addEventListener("focus", () => {
		el.type = "text";
	});

	el.addEventListener("blur", () => {
		el.type = "password";
	});

	el.type = "password";
}
