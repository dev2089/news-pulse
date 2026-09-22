/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/clusters", destination: "/api/clusters" },
        { source: "/clusters/:id", destination: "/api/clusters/:id" },
        { source: "/timeline", destination: "/api/timeline" },
        { source: "/ingest/trigger", destination: "/api/ingest/trigger" },
        { source: "/ingest/status/:jobId", destination: "/api/ingest/status/:jobId" }
      ]
    };
  }
};

export default nextConfig;
