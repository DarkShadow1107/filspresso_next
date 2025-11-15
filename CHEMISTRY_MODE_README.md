# Chemistry Mode - Molecule Visualization System

## Overview

The Chemistry Mode feature enables **Tanka Ultimate** subscribers to explore molecular structures with interactive 2D/3D visualizations directly in the Kafelot chat interface. This system integrates ChEMBL molecular data with SVG (2D) and SDF (3D) visualization formats.

---

## Features

### 🧪 Chemistry Mode Access

-   **Visibility**: Always visible in chat mode selector
-   **Requirements**: Tanka model + Ultimate subscription + User logged in
-   **Locked States**:
    -   🔒 If not logged in: "Login required"
    -   🔒 If not Ultimate subscription: "Ultimate subscription required"
    -   🔒 If Villanelle or Ode selected: "Switch to Tanka model first"
-   **Model Restriction**: Only Tanka model is available in Chemistry Mode (Villanelle and Ode are locked)
-   **Functionality**: Search and visualize molecules from ChEMBL database

### 🔬 Visualization Modes

1. **Text Only** - Display molecular properties without graphics
2. **2D Structure** - SVG molecular diagrams
3. **3D Model** - SDF format files (PyMOL-compatible)
4. **Both** - Show 2D and 3D visualizations simultaneously

### 📊 Molecular Data

-   ChEMBL ID and preferred name
-   Molecular formula and weight
-   SMILES notation
-   Structural properties (H-bond donors/acceptors, rotatable bonds, etc.)
-   Interactive SVG renderings
-   Downloadable SDF files for PyMOL

---

## Setup Instructions

### 1. Download ChEMBL Molecule Dataset

Run the downloader script to fetch molecules from ChEMBL:

```bash
# Basic download (10 molecules, metadata only)
python python_ai/download_all_chembl.py --limit 10

# Download with separate SVG/SDF files (50 molecules)
python python_ai/download_all_chembl.py --limit 50 --download-svg --download-sdf

# Download with embedded base64 assets (100 molecules)
python python_ai/download_all_chembl.py --limit 100 --embed-assets

# Resume an interrupted download
python python_ai/download_all_chembl.py --limit 1000 --resume --embed-assets
```

**Output files:**

-   `python_ai/data/chembl-molecules.json` - Main dataset
-   `python_ai/data/svg/*.svg` - 2D structure images (if `--download-svg`)
-   `python_ai/data/sdf/*.sdf` - 3D model files (if `--download-sdf`)

### 2. Start the Flask Backend

Ensure the Python Flask API is running:

```bash
cd python_ai
python app.py
```

The backend provides these chemistry endpoints:

-   `GET /api/molecules/search?q=<query>` - Search molecules by name
-   `GET /api/molecule/<chembl_id>` - Get molecule details
-   `GET /api/molecule/svg/<chembl_id>` - Fetch 2D SVG image
-   `GET /api/molecule/sdf/<chembl_id>` - Fetch 3D SDF file

### 3. Configure User Subscription

Chemistry Mode requires **Ultimate subscription**. In the browser console or localStorage:

```javascript
localStorage.setItem("user_logged_in", "true");
localStorage.setItem("user_subscription", "ultimate");
```

Then refresh the page.

---

## Usage Guide

### Accessing Chemistry Mode

1. Open the Kafelot recommender (coffee cup icon, bottom-right)
2. Click "Start Chat"
3. You will see the **🧪 Chemistry Mode** button in the chat mode toggle bar (always visible)
4. **Check the button status:**
    - **Enabled (no 🔒)**: Tanka selected + Ultimate subscription + Logged in → Click to enable
    - **Locked 🔒**: Shows reason in tooltip:
        - "Login required" - You need to log in
        - "Ultimate subscription required" - Upgrade to Ultimate
        - "Switch to Tanka model first" - Select Tanka model (green 🌿 button)
5. Once enabled, Villanelle and Ode models will be automatically locked

### Searching for Molecules

Once in Chemistry Mode, use natural language queries:

**By ChEMBL ID:**

```
Show me CHEMBL25
Display CHEMBL192
```

**By molecule name:**

```
Show caffeine molecule
Display aspirin structure
Find glucose
Show me chlorogenic acid
```

### Selecting Visualization Mode

Use the **🔬 Molecule Display** selector to choose:

-   **📝 Text Only** - Properties without graphics
-   **🖼️ 2D Structure** - SVG diagram
-   **🧊 3D Model** - SDF file (downloadable)
-   **🔄 Both** - 2D + 3D together

The visualization updates automatically when you request a molecule.

### Viewing Results

Molecule information appears below the chat messages:

-   **Header**: Molecule name and ChEMBL ID
-   **Info Panel**: Formula, weight, SMILES notation
-   **2D Structure**: Inline SVG rendering (if mode = 2D or Both)
-   **3D Model**: Download button for SDF file + preview (if mode = 3D or Both)

### Using with PyMOL

1. Set visualization mode to **3D Model** or **Both**
2. Search for a molecule
3. Click **⬇️ Download SDF** button
4. Open the downloaded `.sdf` file in PyMOL:
    ```bash
    pymol CHEMBL25.sdf
    ```

---

## Backend API Reference

### Search Molecules

```http
GET /api/molecules/search?q=<query>&limit=<n>
```

**Parameters:**

-   `q` (required) - Search term (name, ChEMBL ID, or synonym)
-   `limit` (optional) - Max results (default: 10)

**Response:**

```json
{
	"status": "success",
	"count": 3,
	"molecules": [
		{
			"chembl_id": "CHEMBL113",
			"name": "Aspirin",
			"molecular_formula": "C9H8O4",
			"molecular_weight": 180.16,
			"smiles": "CC(=O)Oc1ccccc1C(=O)O"
		}
	]
}
```

### Get Molecule Details

```http
GET /api/molecule/<chembl_id>
```

**Response:**

```json
{
	"status": "success",
	"molecule": {
		"chembl_id": "CHEMBL113",
		"name": "Aspirin",
		"molecular_formula": "C9H8O4",
		"molecular_weight": 180.16,
		"alogp": 1.19,
		"polar_surface_area": 63.6,
		"smiles": "CC(=O)Oc1ccccc1C(=O)O",
		"inchi": "InChI=1S/C9H8O4/c1-6(10)13-8-5-3-2-4-7(8)9(11)12/h2-5H,1H3,(H,11,12)",
		"synonyms": ["Acetylsalicylic acid", "2-Acetoxybenzoic acid"]
	}
}
```

### Get SVG Image

```http
GET /api/molecule/svg/<chembl_id>
```

**Response:** SVG image (Content-Type: `image/svg+xml`)

### Get SDF File

```http
GET /api/molecule/sdf/<chembl_id>
```

**Response:** SDF file (Content-Type: `chemical/x-mdl-sdfile`)

---

## Frontend Implementation

### State Management

```typescript
const [chemistryMode, setChemistryMode] = useState(false);
const [visualizationMode, setVisualizationMode] = useState<"text" | "2d" | "3d" | "both">("text");
const [currentMolecule, setCurrentMolecule] = useState<MoleculeData | null>(null);
```

### Fetching Molecule Data

```typescript
const fetchMoleculeData = async (chemblId: string) => {
	// Fetch details
	const detailsRes = await fetch(`http://localhost:5000/api/molecule/${chemblId}`);
	const detailsData = await detailsRes.json();

	// Fetch SVG if needed
	if (visualizationMode === "2d" || visualizationMode === "both") {
		const svgRes = await fetch(`http://localhost:5000/api/molecule/svg/${chemblId}`);
		const svgData = await svgRes.text();
		// ... store in state
	}

	// Fetch SDF if needed
	if (visualizationMode === "3d" || visualizationMode === "both") {
		const sdfRes = await fetch(`http://localhost:5000/api/molecule/sdf/${chemblId}`);
		const sdfData = await sdfRes.text();
		// ... store in state
	}
};
```

### Subscription Check

```typescript
{
	selectedModel === "tanka" && isLoggedIn && userSubscription === "ultimate" && (
		<button
			className={chemistryMode ? "active chemistry-mode" : "chemistry-mode"}
			onClick={() => setChemistryMode(!chemistryMode)}
		>
			🧪 Chemistry Mode
		</button>
	);
}
```

---

## File Structure

```
python_ai/
├── download_all_chembl.py        # ChEMBL data downloader
├── test_chembl_download.py       # Test/demo script
├── app.py                         # Flask API (includes chemistry endpoints)
└── data/
    ├── chembl-molecules.json      # Molecule dataset
    ├── svg/                       # 2D structure images
    │   └── CHEMBL*.svg
    └── sdf/                       # 3D model files
        └── CHEMBL*.sdf

src/
├── components/
│   └── CoffeeRecommender.tsx     # Main component with chemistry mode
└── styles/
    └── globals.css               # Chemistry mode styles
```

---

## Troubleshooting

### Chemistry Mode Button Not Visible

-   **Update**: Chemistry Mode button is now **always visible** (as of latest version)
-   Shows as locked (🔒) with explanatory tooltip when requirements not met

### Chemistry Mode Button Is Locked

**Three possible reasons:**

1. **Not logged in**: Login to your account first
2. **Not Ultimate subscription**: Upgrade to Ultimate tier
3. **Wrong model selected**: Switch to Tanka model (green 🌿 button)

**To unlock:**

-   Ensure logged in: `localStorage.getItem('user_logged_in') === 'true'`
-   Ensure Ultimate: `localStorage.getItem('user_subscription') === 'ultimate'`
-   Select Tanka model (not Villanelle or Ode)

### Models Are Locked in Chemistry Mode

-   **Expected Behavior**: Villanelle and Ode models are automatically disabled when Chemistry Mode is active
-   **Why**: Chemistry Mode uses specialized Tanka processing optimized for molecular data
-   **Solution**: To use other models, disable Chemistry Mode first

### Molecule Not Found

-   **Cause**: Dataset may not include the requested molecule
-   **Solution**: Download more molecules with higher `--limit` value
-   **Alternative**: Search by exact ChEMBL ID (e.g., `CHEMBL25`) instead of name

### SVG/SDF Not Loading

-   **Cause**: Assets not downloaded or embedded
-   **Solution**: Re-run downloader with `--download-svg --download-sdf` or `--embed-assets`
-   **Check**: Flask backend is running on `http://localhost:5000`

### Backend Connection Failed

-   **Cause**: Flask server not running or wrong port
-   **Solution**: Start Flask: `python python_ai/app.py`
-   **Check**: Verify port in `python_ai/app.py` (default: 5000)

---

## Dependencies

### Python Requirements

```
chembl_webresource_client>=0.10.0
rdkit>=2023.9.1
py3Dmol>=2.0.4
pillow>=10.0.0
requests>=2.28.0
flask>=2.3.0
flask-cors>=4.0.0
```

Install with:

```bash
pip install -r python_ai/requirements.txt
```

### Frontend Requirements

Already included in Next.js project dependencies.

---

## Development Notes

### Adding More Molecules

To expand the dataset:

```bash
python python_ai/download_all_chembl.py --limit 5000 --resume --embed-assets
```

The `--resume` flag will add to existing data without duplicates.

### Custom Visualization

Modify `src/components/CoffeeRecommender.tsx`:

-   Update `.molecule-display` rendering logic
-   Add custom SVG styling in `src/styles/globals.css`
-   Integrate 3D viewers (e.g., 3Dmol.js) for in-browser SDF rendering

### Performance Optimization

-   Use `--embed-assets` for faster loading (no external file requests)
-   Cache molecule data in frontend state
-   Implement pagination for large result sets

---

## License & Attribution

-   **ChEMBL Data**: © European Bioinformatics Institute (EBI), licensed under CC BY-SA 3.0
-   **Citation**: Gaulton A, et al. (2017) The ChEMBL database in 2017. Nucleic Acids Res., 45(D1) D945-D954.

---

## Future Enhancements

-   [ ] In-browser 3D rendering with 3Dmol.js
-   [ ] Similarity search based on molecular structure
-   [ ] Export molecule collections
-   [ ] Property-based filtering (MW, LogP, PSA, etc.)
-   [ ] Integration with PubChem and PDB databases
-   [ ] Batch download via UI
