# ChEMBL Data Download Guide

## Prerequisites

Install the ChEMBL web resource client:

```powershell
pip install chembl-webresource-client
```

This package is already included in `requirements.txt`.

## Quick Start

### Download Coffee-Related Molecules

```powershell
cd python_ai
python download_chembl_data.py
```

This will:

1. Search ChEMBL for coffee compounds (caffeine, chlorogenic acid, trigonelline, etc.)
2. Search for flavor and aroma compounds (2-methylfuran, guaiacol, vanillin, etc.)
3. Format data into the training JSON format
4. Save to `data/chembl-training.json`

### Options

```powershell
# Specify custom output file
python download_chembl_data.py --output data/my_chembl_data.json

# Limit number of molecules
python download_chembl_data.py --max-molecules 20
```

## What Gets Downloaded

### Coffee Compounds

-   **Caffeine** - Primary stimulant alkaloid
-   **Chlorogenic acid** - Main antioxidant
-   **Trigonelline** - Flavor compound
-   **Caffeic acid** - Polyphenol antioxidant
-   **Quinic acid** - Organic acid
-   **Theobromine** - Methylxanthine
-   **Theophylline** - Methylxanthine
-   **Cafestol** - Diterpene
-   **Kahweol** - Diterpene
-   **Ferulic acid** - Antioxidant

### Flavor & Aroma Compounds

-   **2-Methylfuran** - Sweet, caramel notes
-   **Furfural** - Almond-like aroma
-   **Guaiacol** - Smoky, phenolic
-   **4-Ethylguaiacol** - Spicy, clove-like
-   **Vanillin** - Vanilla notes
-   **2-Methylpyrazine** - Nutty, roasted
-   **Acetaldehyde** - Fruity, green apple
-   **Diacetyl** - Buttery notes

## Output Format

The script creates a JSON file with this structure:

```json
{
  "metadata": {
    "source": "ChEMBL Database",
    "description": "Molecular chemistry training data",
    "total_molecules": 18,
    "categories": ["caffeine_compounds", "antioxidants", "flavor_molecules", "aroma_compounds"]
  },
  "molecules": [
    {
      "id": "CHEMBL113",
      "name": "Caffeine",
      "smiles": "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
      "molecular_weight": 194.19,
      "logp": -0.07,
      "properties": { ... },
      "atoms": [ ... ],
      "bonds": [ ... ],
      "training_text": "Caffeine is a molecule with..."
    }
  ],
  "training_prompts": [
    {
      "prompt": "What is the molecular structure of caffeine?",
      "response": "Caffeine has a molecular weight of..."
    }
  ]
}
```

## Training with Downloaded Data

After downloading, train the chemistry mode:

```powershell
python train_chemistry.py
```

Or use the API:

```powershell
curl -X POST http://localhost:5000/api/train \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tanka",
    "chemistry_mode": true,
    "subscription": "ultimate",
    "chembl_json_path": "./data/chembl-training.json",
    "num_epochs": 5
  }'
```

## Troubleshooting

### Connection Issues

If you get connection errors:

```python
requests.exceptions.ConnectionError: HTTPSConnectionPool
```

The ChEMBL API may be temporarily unavailable. Try again later or check:
https://www.ebi.ac.uk/chembl/

### No Results Found

If molecules aren't found:

-   ChEMBL may not have data for all compounds
-   Try alternative names (e.g., "1,3,7-Trimethylxanthine" instead of "Caffeine")
-   The script will continue with found molecules

### Rate Limiting

ChEMBL API may rate-limit requests. The script includes delays between requests. If you hit rate limits:

-   Wait a few minutes and try again
-   Reduce `--max-molecules`
-   Download in smaller batches

## Manual ChEMBL Search

You can also manually search ChEMBL and add molecules:

```python
from chembl_webresource_client.new_client import new_client

# Search for a specific molecule
molecule = new_client.molecule
results = molecule.search('caffeine')

# Get molecule details
mol = results[0]
print(mol['molecule_structures']['canonical_smiles'])
print(mol['molecule_properties']['full_mwt'])
```

## API Reference

### search_molecules_by_name(molecule_names)

Search for specific molecules by name.

### search_coffee_compounds()

Search for predefined coffee compounds.

### search_flavor_aroma_compounds()

Search for flavor and aroma compounds.

### download_chembl_data(output_file, max_molecules)

Main download function.

## Next Steps

1. **Download Data**: `python download_chembl_data.py`
2. **Verify Data**: Check `data/chembl-training.json`
3. **Train Model**: `python train_chemistry.py`
4. **Test Chemistry Mode**: See `CHEMISTRY_MODE.md` for API usage

## Resources

-   ChEMBL Database: https://www.ebi.ac.uk/chembl/
-   ChEMBL API Docs: https://chembl.gitbook.io/chembl-interface-documentation/
-   Coffee Chemistry: https://www.sciencedirect.com/topics/food-science/coffee-chemistry

---

**Note**: ChEMBL data is freely available but please cite the database if publishing research:

```
Gaulton A, et al. (2017) 'The ChEMBL database in 2017.' Nucleic Acids Res., 45(D1) D945-D954.
```
