# Molecule 3D Rendering & Download API Documentation

## 🎯 Overview

This API provides comprehensive molecule visualization and download capabilities using:

-   **RDKit** 2025.9.1: Molecular structure generation and property calculation
-   **py3Dmol** 2.5.3: Interactive 3D visualization
-   **Pillow** 12.0.0: 2D image rendering

All endpoints work with ChEMBL IDs and support multiple output formats.

---

## 📋 Available Endpoints

### 1. 🔬 3D Interactive Viewer

**Endpoint:** `GET /api/molecule/render3d/<chembl_id>`

Returns an interactive HTML page with 3D molecule visualization.

**Parameters:**

-   `style` (optional): Visualization style
    -   `stick` (default) - Ball-and-stick model
    -   `sphere` - Space-filling spheres
    -   `line` - Line representation
    -   `cross` - Cross representation
    -   `cartoon` - Cartoon representation

**Example:**

```bash
# Default stick style
curl http://localhost:5000/api/molecule/render3d/CHEMBL25

# Sphere style
curl http://localhost:5000/api/molecule/render3d/CHEMBL25?style=sphere
```

**Response:** HTML page with embedded 3D viewer (800x600px)

**Use Cases:**

-   Embed in iframe for in-app visualization
-   Direct link for standalone viewing
-   Educational demonstrations

---

### 2. 🖼️ 2D Structure Image

**Endpoint:** `GET /api/molecule/render2d/<chembl_id>`

Returns a PNG image of the 2D molecular structure.

**Parameters:**

-   `width` (optional, default: 500): Image width in pixels
-   `height` (optional, default: 500): Image height in pixels

**Example:**

```bash
# Default 500x500
curl http://localhost:5000/api/molecule/render2d/CHEMBL25 > molecule.png

# Custom size
curl "http://localhost:5000/api/molecule/render2d/CHEMBL25?width=800&height=600" > molecule_large.png
```

**Response:** PNG image (Content-Type: image/png)

**Use Cases:**

-   Display in UI cards
-   Generate thumbnails
-   Print-quality images
-   Social media sharing

---

### 3. 📊 Molecular Properties

**Endpoint:** `GET /api/molecule/properties/<chembl_id>`

Calculates and returns comprehensive molecular properties.

**Example:**

```bash
curl http://localhost:5000/api/molecule/properties/CHEMBL25
```

**Response:**

```json
{
	"status": "success",
	"chembl_id": "CHEMBL25",
	"properties": {
		"molecular_weight": 180.16,
		"logp": 1.31,
		"hbd": 1,
		"hba": 3,
		"rotatable_bonds": 2,
		"aromatic_rings": 1,
		"tpsa": 63.6,
		"num_atoms": 13,
		"num_heavy_atoms": 13,
		"num_rings": 1,
		"formula": "C9H8O4",
		"lipinski_violations": 0
	}
}
```

**Properties Explained:**

-   `molecular_weight`: Molecular weight in g/mol
-   `logp`: Lipophilicity (octanol-water partition coefficient)
-   `hbd`: Hydrogen bond donors
-   `hba`: Hydrogen bond acceptors
-   `rotatable_bonds`: Number of rotatable bonds
-   `aromatic_rings`: Number of aromatic rings
-   `tpsa`: Topological polar surface area (Ų)
-   `num_atoms`: Total atom count
-   `num_heavy_atoms`: Non-hydrogen atoms
-   `num_rings`: Total ring count
-   `formula`: Molecular formula
-   `lipinski_violations`: Lipinski's Rule of Five violations (0 = drug-like)

**Use Cases:**

-   Drug-likeness assessment
-   Compound filtering
-   Property-based search
-   ADME predictions

---

### 4. 💾 Download Molecule Data

**Endpoint:** `GET /api/molecule/download/<chembl_id>`

Download molecule data in various chemical file formats.

**Parameters:**

-   `format` (optional, default: all): File format
    -   `all` - ZIP file with all formats
    -   `sdf` - Structure Data File (3D)
    -   `mol` - MDL Molfile (2D)
    -   `pdb` - Protein Data Bank format
    -   `smiles` - SMILES string

**Examples:**

```bash
# Download all formats as ZIP
curl http://localhost:5000/api/molecule/download/CHEMBL25 > molecule_data.zip

# Download specific format
curl http://localhost:5000/api/molecule/download/CHEMBL25?format=sdf > molecule.sdf
curl http://localhost:5000/api/molecule/download/CHEMBL25?format=pdb > molecule.pdb
curl http://localhost:5000/api/molecule/download/CHEMBL25?format=smiles > molecule.smi
```

**ZIP Contents (format=all):**

```
CHEMBL25_molecule_data.zip/
├── CHEMBL25.sdf       # 3D structure (SDF)
├── CHEMBL25.mol       # 2D structure (MOL)
├── CHEMBL25.pdb       # 3D structure (PDB)
├── CHEMBL25.smi       # SMILES string
└── CHEMBL25.json      # Metadata (name, formula, etc.)
```

**Use Cases:**

-   Import into molecular modeling software
-   PyMOL/Chimera visualization
-   ChemDraw/MarvinSketch editing
-   Computational chemistry workflows
-   Batch processing

---

## 🔄 Integration Examples

### Frontend (React/TypeScript)

```typescript
// Fetch 3D viewer HTML
async function load3DViewer(chemblId: string, style: string = "stick") {
	const response = await fetch(`/api/molecule/render3d/${chemblId}?style=${style}`);
	const html = await response.text();

	// Display in iframe
	const iframe = document.createElement("iframe");
	iframe.srcdoc = html;
	iframe.style.width = "800px";
	iframe.style.height = "600px";
	document.getElementById("viewer-container").appendChild(iframe);
}

// Fetch 2D image
async function load2DImage(chemblId: string) {
	const response = await fetch(`/api/molecule/render2d/${chemblId}?width=500&height=500`);
	const blob = await response.blob();
	const imageUrl = URL.createObjectURL(blob);

	document.getElementById("molecule-img").src = imageUrl;
}

// Fetch properties
async function loadProperties(chemblId: string) {
	const response = await fetch(`/api/molecule/properties/${chemblId}`);
	const data = await response.json();

	console.log("Molecular Weight:", data.properties.molecular_weight);
	console.log("LogP:", data.properties.logp);
	console.log("Drug-like:", data.properties.lipinski_violations === 0);
}

// Download molecule data
async function downloadMolecule(chemblId: string, format: string = "all") {
	const response = await fetch(`/api/molecule/download/${chemblId}?format=${format}`);
	const blob = await response.blob();

	const url = window.URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = format === "all" ? `${chemblId}_molecule_data.zip` : `${chemblId}.${format}`;
	a.click();
}
```

### Python Client

```python
import requests
import json

BASE_URL = 'http://localhost:5000/api/molecule'

def get_3d_viewer(chembl_id, style='stick'):
    """Get 3D viewer HTML"""
    response = requests.get(f'{BASE_URL}/render3d/{chembl_id}',
                           params={'style': style})
    return response.text

def get_2d_image(chembl_id, width=500, height=500):
    """Get 2D PNG image"""
    response = requests.get(f'{BASE_URL}/render2d/{chembl_id}',
                           params={'width': width, 'height': height})
    return response.content

def get_properties(chembl_id):
    """Get molecular properties"""
    response = requests.get(f'{BASE_URL}/properties/{chembl_id}')
    return response.json()

def download_molecule(chembl_id, format='all', output_path=None):
    """Download molecule data"""
    response = requests.get(f'{BASE_URL}/download/{chembl_id}',
                           params={'format': format})

    if output_path:
        with open(output_path, 'wb') as f:
            f.write(response.content)

    return response.content

# Usage examples
if __name__ == '__main__':
    chembl_id = 'CHEMBL25'  # Aspirin

    # Get properties
    props = get_properties(chembl_id)
    print(f"MW: {props['properties']['molecular_weight']}")
    print(f"LogP: {props['properties']['logp']}")

    # Save 2D image
    img_data = get_2d_image(chembl_id, width=800, height=800)
    with open(f'{chembl_id}.png', 'wb') as f:
        f.write(img_data)

    # Download all formats
    download_molecule(chembl_id, format='all',
                     output_path=f'{chembl_id}_data.zip')
```

### cURL Examples

```bash
# Test all endpoints for Aspirin (CHEMBL25)
CHEMBL_ID="CHEMBL25"

# 1. Get 3D viewer
curl "http://localhost:5000/api/molecule/render3d/${CHEMBL_ID}" > 3d_viewer.html
open 3d_viewer.html  # macOS
# start 3d_viewer.html  # Windows

# 2. Get 2D image
curl "http://localhost:5000/api/molecule/render2d/${CHEMBL_ID}?width=800&height=800" > molecule.png

# 3. Get properties
curl "http://localhost:5000/api/molecule/properties/${CHEMBL_ID}" | jq .

# 4. Download all formats
curl "http://localhost:5000/api/molecule/download/${CHEMBL_ID}?format=all" > molecule_data.zip
unzip molecule_data.zip

# 5. Download specific format
curl "http://localhost:5000/api/molecule/download/${CHEMBL_ID}?format=sdf" > molecule.sdf
curl "http://localhost:5000/api/molecule/download/${CHEMBL_ID}?format=pdb" > molecule.pdb
```

---

## 🎨 Visualization Style Comparison

| Style       | Description                         | Best For                             | Example Use           |
| ----------- | ----------------------------------- | ------------------------------------ | --------------------- |
| **stick**   | Ball-and-stick model with cylinders | General viewing, structural analysis | Default visualization |
| **sphere**  | Space-filling van der Waals spheres | Size/volume representation           | Binding site analysis |
| **line**    | Simple line representation          | Simple sketches, quick preview       | Thumbnails            |
| **cross**   | Cross markers at atom positions     | Atom position highlighting           | Crystal structures    |
| **cartoon** | Simplified backbone representation  | Large molecules (proteins)           | Protein visualization |

---

## 🧪 Chemistry Mode Integration

### Update CoffeeRecommender.tsx

Add these functions to handle 3D rendering:

```typescript
// State for 3D viewer
const [viewer3D, setViewer3D] = useState<string | null>(null);
const [viewerStyle, setViewerStyle] = useState<string>("stick");

// Fetch 3D viewer
const fetch3DViewer = async (chemblId: string, style: string = "stick") => {
	try {
		const response = await fetch(`/api/molecule/render3d/${chemblId}?style=${style}`);
		const html = await response.text();
		setViewer3D(html);
	} catch (error) {
		console.error("Failed to load 3D viewer:", error);
	}
};

// Fetch molecular properties
const fetchProperties = async (chemblId: string) => {
	try {
		const response = await fetch(`/api/molecule/properties/${chemblId}`);
		const data = await response.json();
		return data.properties;
	} catch (error) {
		console.error("Failed to load properties:", error);
		return null;
	}
};

// Download molecule
const downloadMolecule = async (chemblId: string, format: string = "all") => {
	try {
		const response = await fetch(`/api/molecule/download/${chemblId}?format=${format}`);
		const blob = await response.blob();

		const url = window.URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = format === "all" ? `${chemblId}_data.zip` : `${chemblId}.${format}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);
	} catch (error) {
		console.error("Download failed:", error);
	}
};
```

### Add UI Components

```typescript
{
	/* 3D Viewer */
}
{
	viewer3D && (
		<div className="molecule-3d-viewer">
			<div className="viewer-controls">
				<label>Style:</label>
				<select
					value={viewerStyle}
					onChange={(e) => {
						setViewerStyle(e.target.value);
						fetch3DViewer(currentMolecule.chembl_id, e.target.value);
					}}
				>
					<option value="stick">Stick</option>
					<option value="sphere">Sphere</option>
					<option value="line">Line</option>
					<option value="cross">Cross</option>
					<option value="cartoon">Cartoon</option>
				</select>
			</div>
			<iframe srcDoc={viewer3D} style={{ width: "100%", height: "600px", border: "none" }} title="3D Molecule Viewer" />
		</div>
	);
}

{
	/* Download Buttons */
}
<div className="download-buttons">
	<button onClick={() => downloadMolecule(currentMolecule.chembl_id, "all")}>📦 Download All Formats</button>
	<button onClick={() => downloadMolecule(currentMolecule.chembl_id, "sdf")}>📄 Download SDF</button>
	<button onClick={() => downloadMolecule(currentMolecule.chembl_id, "pdb")}>🧬 Download PDB</button>
</div>;
```

---

## 🚀 Performance Optimization

### Caching Generated Images

```python
from functools import lru_cache
from rdkit import Chem
from rdkit.Chem import AllChem

@lru_cache(maxsize=100)
def get_mol_from_smiles(smiles: str):
    """Cached molecule generation"""
    return Chem.MolFromSmiles(smiles)

@lru_cache(maxsize=100)
def get_3d_mol(smiles: str):
    """Cached 3D molecule generation"""
    mol = Chem.MolFromSmiles(smiles)
    if mol:
        mol_3d = Chem.AddHs(mol)
        AllChem.EmbedMolecule(mol_3d, randomSeed=42)
        AllChem.MMFFOptimizeMolecule(mol_3d)
        return Chem.MolToMolBlock(mol_3d)
    return None
```

### File System Caching

```python
# Cache directory
RENDER_CACHE_DIR = Path(__file__).parent / "data" / "render_cache"
RENDER_CACHE_DIR.mkdir(exist_ok=True, parents=True)

def get_cached_render(chembl_id: str, render_type: str):
    """Check if rendered file exists in cache"""
    cache_path = RENDER_CACHE_DIR / f"{chembl_id}_{render_type}.cache"
    if cache_path.exists():
        with open(cache_path, 'rb') as f:
            return f.read()
    return None

def save_to_cache(chembl_id: str, render_type: str, data: bytes):
    """Save rendered data to cache"""
    cache_path = RENDER_CACHE_DIR / f"{chembl_id}_{render_type}.cache"
    with open(cache_path, 'wb') as f:
        f.write(data)
```

---

## 📝 Error Handling

All endpoints return consistent error responses:

```json
{
	"error": "Error message description"
}
```

**Common HTTP Status Codes:**

-   `200` - Success
-   `400` - Bad request (invalid SMILES, unknown format, etc.)
-   `404` - Molecule not found in dataset
-   `500` - Server error (calculation failed, etc.)

---

## 🔬 Testing

Run comprehensive tests:

```bash
cd python_ai
python test_molecule_rendering.py
```

This will:

1. Test all imports (rdkit, py3Dmol, pillow)
2. Generate 2D/3D structures
3. Calculate molecular properties
4. Create test files (HTML, PNG, ZIP)
5. Verify all visualization styles

---

## 📚 External Resources

-   **RDKit Documentation**: https://www.rdkit.org/docs/
-   **py3Dmol Documentation**: https://3dmol.csb.pitt.edu/
-   **ChEMBL API**: https://chembl.gitbook.io/chembl-interface-documentation/
-   **Pillow Documentation**: https://pillow.readthedocs.io/

---

## 🎯 Next Steps

1. ✅ Install dependencies: `pip install -r requirements.txt`
2. ✅ Run tests: `python test_molecule_rendering.py`
3. ✅ Start Flask server: `python app.py`
4. ⏳ Test endpoints with browser/curl
5. ⏳ Integrate with frontend Chemistry Mode
6. ⏳ Add molecule search and filtering
7. ⏳ Implement property-based compound recommendations

---

**Happy Molecular Visualization! 🧬✨**
