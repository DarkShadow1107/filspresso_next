import type { NextConfig } from "next";

const cspDirectives = [
	"default-src 'self'",
	"base-uri 'self'",
	"object-src 'none'",
	"frame-ancestors 'none'",
	"form-action 'self'",
	"img-src 'self' data: blob: https:",
	"font-src 'self' data:",
	"style-src 'self' 'unsafe-inline'",
	"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
	"connect-src 'self' https: http: ws: wss:",
	"upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
	{ key: "Content-Security-Policy", value: cspDirectives },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
	{ key: "Cross-Origin-Resource-Policy", value: "same-site" },
	{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
	{ key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
];

const nextConfig: NextConfig = {
	// Standalone output: produces a self-contained .next/standalone/server.js
	// used by Dockerfile.next for a minimal production Docker image.
	output: "standalone",

	// Turbopack root — use process.cwd() so it works on any machine / in Docker
	turbopack: {
		root: process.cwd(),
	},

	devIndicators: false,

	async headers() {
		return [
			{
				source: "/:path*",
				headers: securityHeaders,
			},
		];
	},
};

export default nextConfig;
