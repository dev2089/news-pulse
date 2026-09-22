import { callBackend } from "../../../api/_bridge.js";

export async function GET(request) {
  return callBackend(request);
}
