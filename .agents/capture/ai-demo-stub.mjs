// A local OpenAI-compatible server with one canned reply, for the
// AI_Assistant_Macro.gif recording (see record-ai-summarize-macro.sh).
import http from "node:http";
const reply = "The team will freeze scope on Friday, run a bug bash on Tuesday, and ship the release candidate to beta users on Thursday, with Priya on the launch checklist and Tom on the announcement post.";
http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		console.log(req.method, req.url);
		res.setHeader("Content-Type", "application/json");
		if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "demo", object: "model" }] }));
		const model = (() => { try { return JSON.parse(body).model; } catch { return "demo"; } })();
		setTimeout(() => res.end(JSON.stringify({
			id: "chatcmpl-demo", object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
			choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
			usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
		})), 900);
	});
}).listen(18431, "127.0.0.1", () => console.log("stub on 18431"));
