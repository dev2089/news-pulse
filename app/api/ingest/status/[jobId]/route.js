import { callBackend } from "../../../_bridge.js";

export async function GET(request) {
  return callBackend(request);
}
