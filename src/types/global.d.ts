// Consolidated ambient declarations for static assets and environment variables
// This single file lives under `src/types` so it's discovered by tsconfig.typeRoots

declare module "*.css";
declare module "*.module.css";
declare module "*.scss";
declare module "*.module.scss";

declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.svg";
declare module "*.gif";
declare module "*.webp";
declare module "*.avif";
declare module "*.html";

// Allow other module-like assets if needed
declare module "*.module.*";

// Environment variables (client + server)
declare namespace NodeJS {
	interface ProcessEnv {
		NEXT_PUBLIC_BASE_URL?: string;
		BASE_URL?: string;
		PORT?: string;
		[key: string]: string | undefined;
	}
}

export {};
