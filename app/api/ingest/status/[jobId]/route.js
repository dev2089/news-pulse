import { getIngestionStatus } from "../../../../../lib/news-api.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { jobId } = await params;
  if (!jobId) return Response.json({ error: "job id is required" }, { status: 400 });
  try {
    const status = await getIngestionStatus(jobId);
    if (!status) return Response.json({ error: "job not found" }, { status: 404 });
    return Response.json(status);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
