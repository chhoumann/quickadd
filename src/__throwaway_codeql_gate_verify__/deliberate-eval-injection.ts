/**
 * THROWWAWAY — CodeQL gate verification only. DO NOT MERGE.
 *
 * Deliberate medium+/high CodeQL finding: remote HTTP input flows into
 * eval() (code injection) so Protect master Code scanning results can
 * block the merge. Delete this file/branch after verification.
 */
import * as http from "node:http";

export function startDeliberateCodeqlGateServer(port = 0): http.Server {
	const server = http.createServer((req, res) => {
		const q =
			new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("q") ??
			"";
		// CodeQL: js/code-injection / js/eval-injection (remote → eval)
		const result = eval(q);
		res.end(String(result));
	});
	server.listen(port);
	return server;
}
