// Extra Obsidian DOM helpers used by date and multiline fields.
HTMLElement.prototype.toggleClass ??= function (classes, value) {
	for (const cls of Array.isArray(classes) ? classes : [classes]) {
		this.classList.toggle(cls, value);
	}
};
HTMLElement.prototype.setAttr ??= function (name, value) {
	if (value === null || value === false) this.removeAttribute(name);
	else this.setAttribute(name, String(value));
};
