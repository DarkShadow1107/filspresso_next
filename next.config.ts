import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Standalone output: produces a self-contained .next/standalone/server.js
	// used by Dockerfile.next for a minimal production Docker image.
	output: "standalone",

	// Turbopack root — use process.cwd() so it works on any machine / in Docker
	turbopack: {
		root: process.cwd(),
	},

	devIndicators: false,
};

export default nextConfig;
