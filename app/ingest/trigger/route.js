import { callBackend } from "../../api/_bridge.js";

export async function POST(request) {
  return callBackend(request);
}
