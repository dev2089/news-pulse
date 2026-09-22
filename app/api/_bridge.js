import { handle } from "../../../backend/index.js";

export async function callBackend(request) {
  const url = new URL(request.url);
  const nodeReq = {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries())
  };

  let response = null;
  const nodeRes = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      response = Response.json(payload, {
        status: this.statusCode || 200,
        headers: { "cache-control": "no-store" }
      });
      return this;
    }
  };

  await handle(nodeReq, nodeRes);
  return response || Response.json(
    { error: "empty backend response" },
    { status: 500, headers: { "cache-control": "no-store" } }
  );
}
