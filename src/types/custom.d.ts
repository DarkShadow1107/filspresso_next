// Broad module declarations for non-TS assets imported as side-effects in the app
// This prevents TypeScript errors for importing .css and image files in Next.js
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

// Allow importing raw HTML or other text assets if needed
declare module "*.html";

// Generic catch-all for other asset imports used in the repo
declare module "*.module.*";

export {};
