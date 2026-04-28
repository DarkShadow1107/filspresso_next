declare module "*.css" {
	const content: { [className: string]: string };
	export default content;
}

declare module "*.scss" {
	const content: { [className: string]: string };
	export default content;
}

declare module "*.svg" {
	import type { FC, SVGProps } from "react";
	export const ReactComponent: FC<SVGProps<SVGSVGElement>>;
	const src: string;
	export default src;
}

declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.gif";
declare module "*.webp";
declare module "*.avif";
