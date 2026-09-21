import { getCluster } from "../../../../lib/news-api.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  if (!id) return Response.json({ error: "cluster id is required" }, { status: 400 });
  try {
    const cluster = await getCluster(id);
    if (!cluster || !cluster.articles.length) {
      return Response.json({ error: "cluster not found or empty" }, { status: 404 });
    }
    return Response.json({ cluster });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
