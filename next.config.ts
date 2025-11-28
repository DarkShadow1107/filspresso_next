import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	/* config options here */
	// Explicitly set Turbopack root to avoid warnings when multiple lockfiles
	// exist on the system (for example a package-lock.json in the user home).
	// Set this to the path of your project root relative to the workspace.
	turbopack: {
		// Use an absolute path for Turbopack root to ensure stable resolution
		// across environments and avoid multiple-lockfile warnings.
		root: "C:\\Users\\Alexandru Gabriel\\Desktop\\GitHub\\filspresso_next",
	},
	devIndicators: false,
};

export default nextConfig;
