import { triggerIngestion } from "../../../../lib/news-api.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const result = await triggerIngestion(new URL(request.url).origin);
    if (result.conflict) {
      return Response.json(
        { error: "ingestion already running", job_id: result.job_id },
        { status: 409 }
      );
    }
    return Response.json(result, { status: 202 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "could not start ingestion" }, { status: 500 });
  }
}
