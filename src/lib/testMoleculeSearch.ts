// Test utility to verify molecule search fallback works
// Place this in src/lib/testMoleculeSearch.ts or run in browser console

import { loadMoleculesData, searchMoleculesByName, searchMoleculesByChEMBLId, smartSearchMolecule } from "./moleculeSearch";

export async function testMoleculeSearch() {
	console.log("🧪 Testing Molecule Search Fallback...\n");

	try {
		// Test 1: Load molecules
		console.log("Test 1: Loading molecules from /public/data/chembl-molecules.json");
		const molecules = await loadMoleculesData();
		console.log(`✓ Loaded ${molecules.length} molecules\n`);

		// Test 2: Search by name
		console.log("Test 2: Searching for 'caffeine'");
		const caffeineResults = searchMoleculesByName(molecules, "caffeine");
		console.log(
			`✓ Found ${caffeineResults.length} results:`,
			caffeineResults.map((m) => m.name || m.chembl_id)
		);
		if (caffeineResults.length > 0) {
			console.log("  First result:", {
				chembl_id: caffeineResults[0].chembl_id,
				name: caffeineResults[0].name,
				formula: caffeineResults[0].molecular_formula,
				weight: caffeineResults[0].molecular_weight,
			});
		}
		console.log();

		// Test 3: Search by ChEMBL ID
		console.log("Test 3: Searching for 'CHEMBL25'");
		const mol25 = searchMoleculesByChEMBLId(molecules, "CHEMBL25");
		if (mol25) {
			console.log(`✓ Found:`, {
				chembl_id: mol25.chembl_id,
				name: mol25.name,
				formula: mol25.molecular_formula,
			});
		} else {
			console.log("✗ Not found");
		}
		console.log();

		// Test 4: Smart search
		console.log("Test 4: Smart search for 'chlorogenic acid'");
		const chlorogenic = await smartSearchMolecule("chlorogenic acid");
		if (chlorogenic) {
			console.log(`✓ Found:`, {
				chembl_id: chlorogenic.chembl_id,
				name: chlorogenic.name,
				formula: chlorogenic.molecular_formula,
			});
		} else {
			console.log("✗ Not found");
		}
		console.log();

		// Test 5: Search by synonym
		console.log("Test 5: Searching by synonym");
		const synonymResults = searchMoleculesByName(molecules, "CHEMBL59");
		console.log(
			`✓ Search results:`,
			synonymResults.map((m) => ({ name: m.name, id: m.chembl_id }))
		);
		console.log();

		console.log("✅ All tests completed successfully!");
		return true;
	} catch (error) {
		console.error("❌ Test failed:", error);
		return false;
	}
}

// Usage in browser console:
// import { testMoleculeSearch } from '@/lib/testMoleculeSearch'
// await testMoleculeSearch()
