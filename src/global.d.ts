// Global ambient declarations for imported assets
declare module "*.css" {
	const content: Record<string, string>;
	export default content;
}
declare module "*.module.css" {
	const content: Record<string, string>;
	export default content;
}
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

export {};
