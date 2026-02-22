import { beforeEach, describe, expect, it, vi } from "vitest";

const { NoticeMock, noticeSetMessageMock, noticeHideMock } = vi.hoisted(
	() => {
		const noticeSetMessageMock = vi.fn();
		const noticeHideMock = vi.fn();
		const NoticeMock = vi.fn().mockImplementation(() => ({
			setMessage: noticeSetMessageMock,
			hide: noticeHideMock,
		}));

		return {
			NoticeMock,
			noticeSetMessageMock,
			noticeHideMock,
		};
	},
);

vi.mock("obsidian", () => ({
	Notice: NoticeMock,
}));

import { makeNoticeHandler } from "./makeNoticeHandler";

describe("makeNoticeHandler", () => {
	beforeEach(() => {
		NoticeMock.mockClear();
		noticeSetMessageMock.mockClear();
		noticeHideMock.mockClear();
	});

	it("returns no-op handler when assistant messages are disabled", () => {
		const handler = makeNoticeHandler(false);

		handler.setMessage("prompting", "Using custom prompt.");
		handler.setMessage("prompting", "Using custom prompt. (0.10s)");
		handler.hide();

		expect(NoticeMock).not.toHaveBeenCalled();
		expect(noticeSetMessageMock).not.toHaveBeenCalled();
		expect(noticeHideMock).not.toHaveBeenCalled();
	});

	it("uses Notice when assistant messages are enabled", () => {
		const handler = makeNoticeHandler(true);

		handler.setMessage("prompting", "Using custom prompt.");
		handler.hide();

		expect(NoticeMock).toHaveBeenCalledTimes(1);
		expect(noticeSetMessageMock).toHaveBeenCalledTimes(1);
		expect(noticeHideMock).toHaveBeenCalledTimes(1);
	});
});
