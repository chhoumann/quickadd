import { Notice } from "obsidian";
import { isCancellationError, markErrorReported } from "../utils/errorUtils";

const noticeMsg = (task: string, message: string) => {
	// The "dead" status is the failure surface; "Assistant is dead." reads as a
	// jarring, unhelpful headline, so use clear failure wording instead.
	const headline =
		task === "dead" ? "AI request failed." : `Assistant is ${task}.`;
	return `${headline}${message ? `\n\n${message}` : ""}`;
};

interface NoticeHandler {
    setMessage: (status: string, msg: string) => void;
    hide: () => void;
    /**
     * End the run on `error`: show it as the run's one failure notice, or close
     * the notice if the user cancelled. The caller still re-throws the error.
     */
    fail: (error: unknown) => void;
}
export function makeNoticeHandler(showMessages: boolean): NoticeHandler {
    if (showMessages) {
        const n = new Notice(noticeMsg("starting", ""), 1000000);

        return {
            setMessage: (status: string, msg: string) => {
                n.setMessage(noticeMsg(status, msg));
            },
            hide: () => n.hide(),
            fail: (error: unknown) => {
                if (isCancellationError(error)) {
                    n.hide();
                    return;
                }
                n.setMessage(noticeMsg("dead", (error as { message?: string })?.message ?? String(error)));
                // The error is re-thrown; whatever reports it further up must not
                // show it a second time.
                markErrorReported(error);
                window.setTimeout(() => n.hide(), 5000);
            },
        };
    }

    return {
        setMessage: () => { },
        hide: () => { },
        fail: () => { },
    };
}
