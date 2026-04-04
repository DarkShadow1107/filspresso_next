/**
 * Molecule Search Utility - Fallback for Chemistry Mode
 * Searches molecules by name/synonyms when API is unavailable
 */

// Load molecules from local data (should be bundled with your app)
let moleculesCache: any[] | null = null;
const moleculeApiBase = "/api/molecule";

const MOLECULE_PROMPT_PREFIX_PATTERNS = [
	/^(?:i\s+want\s+to\s+know\s+more\s+about|i\s+want\s+to\s+learn\s+about|i\s+want\s+to\s+know\s+about|i\s+want\s+to\s+understand|i\s+want\s+about|i\s+want)\s+(.+)$/i,
	/^(?:tell\s+me\s+(?:more\s+)?about|what\s+is|what's|show\s+me|display|find|search\s+for|look\s+up|lookup|explain|give\s+me\s+(?:info(?:rmation)?|details)\s+about)\s+(.+)$/i,
	/^(?:molecule|compound|structure)\s+(?:of\s+)?(.+)$/i,
	/^(.+?)\s+(?:molecule|compound|structure)$/i,
];

const MOLECULE_TRAILING_WORDS = /\b(?:molecule|compound|structure|please|pls|thanks|thank\s+you)\b/gi;
const MOLECULE_STOPWORDS = new Set([
	"i",
	"want",
	"to",
	"know",
	"more",
	"about",
	"tell",
	"me",
	"what",
	"is",
	"the",
	"a",
	"an",
	"show",
	"display",
	"find",
	"search",
	"for",
	"look",
	"up",
	"lookup",
	"explain",
	"give",
	"info",
	"information",
	"details",
]);

function cleanMoleculeCandidate(input: string): string {
	return input
		.replace(/[?!.,;:()[\]{}]+/g, " ")
		.replace(MOLECULE_TRAILING_WORDS, " ")
		.replace(/^\s*(?:the|a|an)\s+/i, "")
		.replace(/\s+/g, " ")
		.trim();
}

function buildSearchCandidates(query: string): string[] {
	const normalized = cleanMoleculeCandidate(query);
	if (!normalized) return [];

	const candidates = new Set<string>();
	candidates.add(normalized);

	const extracted = extractMoleculeQuery(normalized);
	if (extracted) {
		candidates.add(extracted);
	}

	const tokens = normalized.split(" ").filter(Boolean);
	if (tokens.length > 1) {
		const filtered = tokens.filter((token) => !MOLECULE_STOPWORDS.has(token.toLowerCase()));
		const source = filtered.length > 0 ? filtered : tokens;
		const maxSize = Math.min(3, source.length);
		for (let size = maxSize; size >= 1; size -= 1) {
			candidates.add(source.slice(-size).join(" "));
		}
	}

	return [...candidates].filter(Boolean);
}

export async function loadMoleculesData(): Promise<any[]> {
	if (moleculesCache) {
		return moleculesCache;
	}

	try {
		// Try to load from local file first (for offline support)
		const response = await fetch("/data/chembl-molecules.json");
		if (!response.ok) {
			throw new Error("Failed to load molecules data");
		}
		const data = await response.json();

		// Handle both formats: array or nested under 'molecules' key
		const moleculesArray = Array.isArray(data) ? data : data.molecules || [];

		if (!Array.isArray(moleculesArray)) {
			throw new Error("Molecules data is not an array");
		}

		moleculesCache = moleculesArray;
		console.log(`✓ Loaded ${moleculesArray.length} molecules from local cache`);
		return moleculesArray;
	} catch (error) {
		console.error("Could not load local molecules data:", error);
		// Return empty array as fallback
		return [];
	}
}

export function searchMoleculesByName(molecules: any[], query: string): any[] {
	const lowerQuery = query.toLowerCase().trim();

	return molecules
		.filter((mol) => {
			// Search in name
			if (mol.name && mol.name.toLowerCase().includes(lowerQuery)) {
				return true;
			}

			// Search in synonyms
			if (mol.synonyms && Array.isArray(mol.synonyms)) {
				return mol.synonyms.some((syn: string) => syn.toLowerCase().includes(lowerQuery));
			}

			// Search in formula
			if (mol.molecular_formula && mol.molecular_formula.toLowerCase().includes(lowerQuery)) {
				return true;
			}

			return false;
		})
		.slice(0, 5); // Return top 5 matches
}

export function searchMoleculesByChEMBLId(molecules: any[], chemblId: string): any | null {
	return molecules.find((mol) => mol.chembl_id === chemblId.toUpperCase()) || null;
}

/**
 * Smart molecule search - tries exact match, then partial matches
 */
export async function smartSearchMolecule(query: string): Promise<any | null> {
	const trimmedQuery = query.trim();
	if (!trimmedQuery) return null;
	const candidates = buildSearchCandidates(trimmedQuery);
	if (candidates.length === 0) return null;

	// DB-backed search only (synonyms included server-side).
	for (const candidate of candidates) {
		try {
			const apiRes = await fetch(`${moleculeApiBase}/search?q=${encodeURIComponent(candidate)}&limit=1`);
			if (apiRes.ok) {
				const apiData = await apiRes.json();
				if (Array.isArray(apiData?.molecules) && apiData.molecules.length > 0) {
					return apiData.molecules[0];
				}
			}
		} catch (error) {
			console.warn("Molecule API search unavailable", error);
		}
	}

	// Local JSON fallback when API is unavailable or has no match.
	const molecules = await loadMoleculesData();
	for (const candidate of candidates) {
		const chemblMatch = candidate.match(/CHEMBL\d+/i);
		if (chemblMatch) {
			const exact = searchMoleculesByChEMBLId(molecules, chemblMatch[0]);
			if (exact) return exact;
		}

		const localMatches = searchMoleculesByName(molecules, candidate);
		if (localMatches.length > 0) {
			return localMatches[0];
		}
	}

	return null;
}

/**
 * Get molecule visualization data from Python API (RDKit + Py3Dmol + Pillow)
 */
export async function getMoleculeVisualization(
	moleculeIdentifier: string,
	visualizationMode: "text" | "2d" | "3d" | "both",
	useApi: boolean = true,
): Promise<{
	svg?: string;
	sdf?: string;
	error?: string;
}> {
	const result: any = {};

	// Skip API if explicitly disabled
	if (!useApi) {
		console.log("API visualization disabled, returning empty result");
		return result;
	}

	try {
		// Try API with timeout
		const apiTimeout = 10000; // 10 second timeout for molecule rendering
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), apiTimeout);

		try {
			// Try 2D rendering (RDKit + Pillow)
			if (visualizationMode === "2d" || visualizationMode === "both") {
				try {
					const response = await fetch(
						`${moleculeApiBase}/render2d/${encodeURIComponent(moleculeIdentifier)}?width=500&height=400`,
						{
							signal: controller.signal,
						},
					);
					if (response.ok) {
						const blob = await response.blob();
						// Convert blob to base64 data URL for image display
						const reader = new FileReader();
						result.svg = await new Promise((resolve) => {
							reader.onload = () => resolve(reader.result as string);
							reader.readAsDataURL(blob);
						});
						console.log("✅ 2D structure loaded from API (RDKit + Pillow)");
					}
				} catch (e) {
					console.warn("2D rendering failed:", e);
				}
			}

			// Try 3D rendering (Py3Dmol)
			if (visualizationMode === "3d" || visualizationMode === "both") {
				try {
					const response = await fetch(
						`${moleculeApiBase}/render3d/${encodeURIComponent(moleculeIdentifier)}?style=stick&width=620&height=320`,
						{
							signal: controller.signal,
						},
					);
					if (response.ok) {
						result.sdf = await response.text(); // HTML with Py3Dmol viewer embedded
						console.log("✅ 3D model loaded from API (Py3Dmol)");
					}
				} catch (e) {
					console.warn("3D rendering failed:", e);
				}
			}

			clearTimeout(timeoutId);
			return result;
		} catch (apiError) {
			clearTimeout(timeoutId);
			console.warn("API visualization request failed:", apiError);
			return result;
		}
	} catch (error) {
		console.error("Visualization error:", error);
		return {
			error: `Visualization unavailable for ${moleculeIdentifier}`,
		};
	}
}

/**
 * Get a simple text-based molecule card when visualizations fail
 */
export function getMoleculeCard(molecule: any): string {
	if (!molecule) return "";

	const name = molecule.name || molecule.chembl_id || "Unknown";
	const formula = molecule.molecular_formula || "N/A";
	const weight = molecule.molecular_weight ? molecule.molecular_weight.toFixed(2) + " g/mol" : "N/A";
	const logp =
		molecule.alogp !== undefined ? molecule.alogp.toFixed(2) : molecule.logp !== undefined ? molecule.logp.toFixed(2) : "N/A";
	const tpsa =
		molecule.polar_surface_area !== undefined
			? molecule.polar_surface_area.toFixed(2)
			: molecule.tpsa !== undefined
				? molecule.tpsa.toFixed(2)
				: "N/A";
	const hba = molecule.hba !== undefined ? molecule.hba : "N/A";
	const hbd = molecule.hbd !== undefined ? molecule.hbd : "N/A";

	return `
📊 **${name}**
🔬 **ChEMBL ID:** ${molecule.chembl_id}
🧪 **Formula:** ${formula}
⚖️ **Molecular Weight:** ${weight}
🔗 **LogP (Lipophilicity):** ${logp}
📐 **TPSA (Polarity):** ${tpsa}
🔶 **H-Bond Acceptors:** ${hba}
🔵 **H-Bond Donors:** ${hbd}
	`.trim();
}

/**
 * Detect if user is asking about a molecule
 */
export function isMoleculeQuery(text: string): boolean {
	const moleculeKeywords = [
		"molecule",
		"chemical",
		"structure",
		"compound",
		"caffeine",
		"chembl",
		"show",
		"display",
		"visualize",
		"3d",
		"2d",
	];

	return moleculeKeywords.some((keyword) => text.toLowerCase().includes(keyword));
}

/**
 * Extract molecule name/ID from user query
 */
export function extractMoleculeQuery(text: string): string | null {
	// Try ChEMBL ID
	const chemblMatch = text.match(/CHEMBL\d+/i);
	if (chemblMatch) {
		return chemblMatch[0].toUpperCase();
	}

	const compact = text
		.replace(/[\n\r\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!compact) return null;

	for (const pattern of MOLECULE_PROMPT_PREFIX_PATTERNS) {
		const match = compact.match(pattern);
		if (match && match[1]) {
			const candidate = cleanMoleculeCandidate(match[1]);
			if (candidate) return candidate;
		}
	}

	const cleaned = cleanMoleculeCandidate(compact);
	if (!cleaned) return null;

	const tokenCount = cleaned.split(" ").length;
	if (tokenCount <= 4) {
		return cleaned;
	}

	const filteredTokens = cleaned.split(" ").filter((token) => token && !MOLECULE_STOPWORDS.has(token.toLowerCase()));

	if (filteredTokens.length > 0) {
		const tail = filteredTokens.slice(-3).join(" ").trim();
		if (tail) {
			return tail;
		}
	}

	return null;
}
