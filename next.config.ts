import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	/* config options here */
	// Explicitly set Turbopack root to avoid warnings when multiple lockfiles
	// exist on the system (for example a package-lock.json in the user home).
	// Set this to the path of your project root relative to the workspace.
	turbopack: {
		root: "./",
	},
	devIndicators: false,
};

export default nextConfig;
