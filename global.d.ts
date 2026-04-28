// Project-root ambient declarations for imported static assets
declare module "*.css";
declare module "*.module.css";
declare module "*.scss";
declare module "*.module.scss";
declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.svg" {
	import type { FC, SVGProps } from "react";
	export const ReactComponent: FC<SVGProps<SVGSVGElement>>;
	const src: string;
	export default src;
}

declare global {
	// Google Authentication Platform types
	type GoogleBasicProfile = {
		getId: () => string;
		getName: () => string;
		getImageUrl: () => string;
		getEmail: () => string | null;
	};

	type GoogleUser = {
		getBasicProfile: () => GoogleBasicProfile;
	};

	type GoogleAuthInstance = {
		signOut: () => Promise<unknown>;
	};

	type GoogleApi = {
		load: (modules: string, callback: () => void) => void;
		auth2: {
			init: (config: { client_id: string; scope?: string }) => unknown;
			getAuthInstance: () => GoogleAuthInstance;
		};
	};

	interface Window {
		onSignIn?: (googleUser: GoogleUser) => void;
		signOut?: () => Promise<void>;
		gapi?: GoogleApi;
	}
}

export {};
