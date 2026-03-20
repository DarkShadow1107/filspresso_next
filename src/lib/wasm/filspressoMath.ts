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

let modulePromise: Promise<FilspressoMathModule> | null = null;

async function loadFactory(): Promise<WasmFactory> {
	// Generated at runtime by the wasm builder and served from /public/wasm.
	// @ts-expect-error Runtime asset emitted to public/wasm by wasm_builder.
	const imported = await import("/wasm/filspresso_math.js");
	return imported.default as WasmFactory;
}

export async function loadFilspressoMathModule(): Promise<FilspressoMathModule> {
	if (typeof window === "undefined") {
		throw new Error("WASM module can only be loaded in the browser");
	}

	if (!modulePromise) {
		modulePromise = loadFactory().then((factory) => factory());
	}

	return modulePromise;
}

export async function preprocessToBinary(
	rgba: Uint8ClampedArray,
	threshold = 128,
): Promise<{ gray: Uint8Array; binary: Uint8Array }> {
	const module = await loadFilspressoMathModule();
	const pixelCount = Math.floor(rgba.length / 4);

	const rgbaPtr = module._malloc(rgba.length);
	const grayPtr = module._malloc(pixelCount);
	const binaryPtr = module._malloc(pixelCount);

	try {
		module.HEAPU8.set(rgba, rgbaPtr);
		module._filspresso_preprocess_rgba_to_gray(rgbaPtr, pixelCount, grayPtr);
		module._filspresso_binarize_gray(grayPtr, pixelCount, threshold, binaryPtr);

		const gray = new Uint8Array(module.HEAPU8.buffer, grayPtr, pixelCount).slice();
		const binary = new Uint8Array(module.HEAPU8.buffer, binaryPtr, pixelCount).slice();
		return { gray, binary };
	} finally {
		module._free(binaryPtr);
		module._free(grayPtr);
		module._free(rgbaPtr);
	}
}

export async function qrFinderScore(binary: Uint8Array, width: number, height: number): Promise<number> {
	const module = await loadFilspressoMathModule();
	const expectedLength = width * height;

	if (binary.length !== expectedLength) {
		throw new Error("Binary image length does not match width*height");
	}

	const binaryPtr = module._malloc(binary.length);
	try {
		module.HEAPU8.set(binary, binaryPtr);
		return module._filspresso_qr_finder_score(binaryPtr, width, height);
	} finally {
		module._free(binaryPtr);
	}
}

export async function cosineSimilarity(a: Float32Array, b: Float32Array): Promise<number> {
	const module = await loadFilspressoMathModule();

	if (a.length !== b.length) {
		throw new Error("Vectors must have the same length");
	}

	const bytes = a.length * Float32Array.BYTES_PER_ELEMENT;
	const aPtr = module._malloc(bytes);
	const bPtr = module._malloc(bytes);

	try {
		module.HEAPF32.set(a, aPtr / Float32Array.BYTES_PER_ELEMENT);
		module.HEAPF32.set(b, bPtr / Float32Array.BYTES_PER_ELEMENT);
		return module._filspresso_vector_cosine(aPtr, bPtr, a.length);
	} finally {
		module._free(bPtr);
		module._free(aPtr);
	}
}
