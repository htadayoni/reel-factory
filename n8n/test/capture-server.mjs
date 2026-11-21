// Stand-in for Google Sheets row updates in the test workflow: logs every POST to stdout as JSON.
import http from "node:http";
const port = Number(process.argv[2] || 3095);
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end("{}");
      if (req.method === "POST") console.log(JSON.stringify({ at: new Date().toISOString(), path: req.url, body: JSON.parse(body || "{}") }));
    });
  })
  .listen(port, () => console.error(`capture server on :${port}`));
