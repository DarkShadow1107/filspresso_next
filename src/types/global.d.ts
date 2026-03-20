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
declare module "@/styles/admin.css";
declare module "../../styles/admin.css";

declare module "/wasm/filspresso_math.js" {
	type FilspressoMathModule = {
		HEAPU8: Uint8Array;
		HEAPF32: Float32Array;
		_malloc(size: number): number;
		_free(ptr: number): void;
		_filspresso_vector_cosine(aPtr: number, bPtr: number, length: number): number;
		_filspresso_qr_finder_score(binaryPtr: number, width: number, height: number): number;
		_filspresso_preprocess_rgba_to_gray(rgbaPtr: number, pixelCount: number, grayPtr: number): void;
		_filspresso_binarize_gray(grayPtr: number, pixelCount: number, threshold: number, binaryPtr: number): void;
	};

	type WasmFactory = () => Promise<FilspressoMathModule>;

	const factory: WasmFactory;
	export default factory;
}

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
