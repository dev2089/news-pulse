export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    projectProductionUrl:
      process.env.PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      null,
    vercelUrl: process.env.PUBLIC_VERCEL_URL || process.env.VERCEL_URL || null,
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
  });
}
