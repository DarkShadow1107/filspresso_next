/**
 * Molecule Search Utility - Fallback for Chemistry Mode
 * Searches molecules by name/synonyms when API is unavailable
 */

// Load molecules from local data (should be bundled with your app)
let moleculesCache: any[] | null = null;

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
	const molecules = await loadMoleculesData();

	if (molecules.length === 0) {
		return null;
	}

	// Try exact ChEMBL ID first
	const chemblMatch = query.match(/CHEMBL\d+/i);
	if (chemblMatch) {
		const exact = searchMoleculesByChEMBLId(molecules, chemblMatch[0]);
		if (exact) return exact;
	}

	// Try name search
	const nameResults = searchMoleculesByName(molecules, query);
	if (nameResults.length > 0) {
		return nameResults[0]; // Return best match
	}

	// Fallback: search common coffee compounds
	const coffeeCompounds = ["caffeine", "chlorogenic acid", "trigonelline", "quinides", "polyphenols"];
	const lowerQuery = query.toLowerCase();
	for (const compound of coffeeCompounds) {
		if (lowerQuery.includes(compound) || compound.includes(lowerQuery)) {
			const results = searchMoleculesByName(molecules, compound);
			if (results.length > 0) return results[0];
		}
	}

	return null;
}

/**
 * Get molecule visualization data from Python API (RDKit + Py3Dmol + Pillow)
 */
export async function getMoleculeVisualization(
	chemblId: string,
	visualizationMode: "text" | "2d" | "3d" | "both",
	useApi: boolean = true
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
					const response = await fetch(`http://localhost:5000/api/molecule/render2d/${chemblId}?width=500&height=400`, {
						signal: controller.signal,
					});
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
					const response = await fetch(`http://localhost:5000/api/molecule/render3d/${chemblId}?style=stick`, {
						signal: controller.signal,
					});
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
			error: `Visualization unavailable for ${chemblId}`,
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
		return chemblMatch[0];
	}

	// Extract molecule name (text between keywords)
	const patterns = [
		/(?:show|display|find|structure|molecule|about)\s+(?:me\s+)?(?:the\s+)?(?:molecule\s+)?(.+?)(?:\s+molecule|\s+structure|\s+compound|\?|$)/i,
		/(?:what.*?is|tell.*?about)\s+(.+?)(?:\?|$)/i,
		/^(.+?)(?:\s+molecule|\s+compound|\s+structure)?$/i,
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match && match[1]) {
			return match[1].trim();
		}
	}

	return null;
}
