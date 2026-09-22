import { callBackend } from "../../_bridge.js";

export async function POST(request) {
  return callBackend(request);
}
