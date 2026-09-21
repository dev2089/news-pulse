import { listClusters } from "../../../lib/news-api.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ clusters: await listClusters() });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
