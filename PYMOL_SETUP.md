# PyMOL Setup Guide for Chemistry Mode

## What is PyMOL?

**PyMOL** is a powerful, open-source molecular visualization system for viewing 3D molecular structures. It's the industry standard for:

-   Protein structure visualization
-   Small molecule viewing and analysis
-   Publication-quality molecular graphics
-   Interactive 3D manipulation

In Chemistry Mode, FilSpresso Next generates **SDF files** (Structure-Data Files) that can be opened directly in PyMOL for full 3D visualization.

---

## Installation Options

### Option 1: PyMOL Official (Recommended for Windows)

#### Free Open-Source Version

1. **Download from GitHub Releases:**

    - Visit: https://github.com/schrodinger/pymol-open-source/releases
    - Download the latest Windows installer (`.exe` or `.msi`)

2. **Install:**

    - Run the installer
    - Follow the installation wizard
    - Default location: `C:\Program Files\PyMOL`

3. **Verify Installation:**
    ```powershell
    pymol --version
    ```

#### Commercial Version (Enhanced Features)

-   Visit: https://pymol.org/
-   Purchase educational or commercial license
-   Includes additional features and support

---

### Option 2: Conda Installation (Cross-Platform)

If you have Anaconda or Miniconda installed:

```bash
# Create a new environment (optional but recommended)
conda create -n pymol python=3.10
conda activate pymol

# Install PyMOL open-source
conda install -c conda-forge pymol-open-source

# Verify
pymol --version
```

**Advantages:**

-   Easy to install across Windows, macOS, Linux
-   Automatic dependency management
-   Can be integrated with Python scripts

---

### Option 3: Python Package (Advanced)

For programmatic use in Python scripts:

```bash
# Install via pip (may require build tools on Windows)
pip install pymol-open-source

# Note: This requires Visual C++ build tools on Windows
# Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
```

---

## Quick Start with Chemistry Mode

### 1. Enable Chemistry Mode in FilSpresso Next

```javascript
// In browser console
localStorage.setItem("user_logged_in", "true");
localStorage.setItem("user_subscription", "ultimate");
// Refresh page
```

### 2. Download a Molecule

1. Open Kafelot chat interface
2. Enable **Chemistry Mode** (🧪 button)
3. Set visualization to **3D Model** or **Both**
4. Search for a molecule:
    ```
    Show me CHEMBL25
    Display aspirin structure
    Find caffeine molecule
    ```

### 3. Open in PyMOL

Click **⬇️ Download SDF** button to save the `.sdf` file.

#### Method A: Double-Click (Windows)

-   Simply double-click the `.sdf` file
-   PyMOL should open automatically if properly installed

#### Method B: Command Line

```powershell
pymol CHEMBL25.sdf
```

#### Method C: PyMOL GUI

1. Launch PyMOL
2. Go to **File → Open**
3. Select your downloaded `.sdf` file

---

## Basic PyMOL Commands

Once your molecule is loaded:

### Navigation

-   **Left mouse button**: Rotate
-   **Right mouse button**: Zoom
-   **Middle mouse button**: Pan
-   **Mouse wheel**: Zoom in/out

### Display Styles

```pymol
# Stick representation
show sticks

# Ball and stick
show sticks
show spheres

# Surface
show surface

# Cartoon (for proteins)
show cartoon

# Hide all
hide everything
```

### Coloring

```pymol
# Color by element (atoms)
color atomic

# Color by structure
color blue
color red
color green

# Rainbow coloring
spectrum count
```

### Visualization Quality

```pymol
# High quality rendering
set ray_trace_mode, 1
ray 1200, 1200

# Save image
png molecule.png
```

### Measurements

```pymol
# Measure distance between atoms
distance selection1, selection2

# Measure angle
angle selection1, selection2, selection3

# Show hydrogen bonds
set h_bond_mode, 1
show h_bonds
```

---

## Troubleshooting

### PyMOL won't open SDF files

**Solution 1: Check file association**

```powershell
# Windows: Re-associate .sdf files with PyMOL
# Right-click .sdf file → Open with → Choose PyMOL → Always use this app
```

**Solution 2: Use command line**

```powershell
# Find PyMOL installation
where pymol

# Open directly
"C:\Program Files\PyMOL\pymol.exe" CHEMBL25.sdf
```

### "PyMOL command not found"

**Solution: Add to PATH**

```powershell
# Windows: Add PyMOL to system PATH
# Control Panel → System → Advanced → Environment Variables
# Add: C:\Program Files\PyMOL to PATH variable
```

### Conda installation fails

**Solution: Use conda-forge channel**

```bash
conda config --add channels conda-forge
conda config --set channel_priority strict
conda install pymol-open-source
```

### Visual C++ build errors (pip install)

**Solution: Install build tools**

1. Download Visual C++ Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. Install "Desktop development with C++" workload
3. Retry: `pip install pymol-open-source`

---

## Alternative: Web-Based 3D Viewing

If you don't want to install PyMOL, you can use online viewers:

### Option 1: Mol\* Viewer (PDB Files)

-   Website: https://molstar.org/viewer/
-   Convert SDF to PDB first (using Open Babel)

### Option 2: NGL Viewer

-   Website: http://nglviewer.org/ngl/
-   Drag and drop SDF files directly

### Option 3: 3Dmol.js (In-Browser)

FilSpresso Next could integrate this for inline 3D viewing without PyMOL:

```javascript
// Future enhancement: Add 3Dmol.js to render SDF inline
import $3Dmol from "3dmol";
```

---

## Advanced: Python Scripting with PyMOL

You can automate PyMOL visualization with Python:

```python
import pymol
from pymol import cmd

# Initialize PyMOL
pymol.finish_launching()

# Load molecule
cmd.load('CHEMBL25.sdf', 'molecule')

# Style it
cmd.show('sticks', 'molecule')
cmd.color('atomic', 'molecule')

# Render and save
cmd.ray(1200, 1200)
cmd.png('output.png')

# Clean up
pymol.cmd.quit()
```

---

## Integration with FilSpresso Next Backend (Future)

For server-side rendering without requiring user to install PyMOL:

```python
# python_ai/app.py - Future enhancement
from rdkit import Chem
from rdkit.Chem import AllChem, Draw
import py3Dmol

@app.route('/api/molecule/render3d/<chembl_id>', methods=['GET'])
def render_molecule_3d(chembl_id):
    """Generate interactive 3D HTML visualization"""
    # Load SDF
    sdf_path = Path(__file__).parent / "data" / "sdf" / f"{chembl_id}.sdf"
    mol = Chem.SDMolSupplier(str(sdf_path))[0]

    # Generate 3D coordinates if needed
    AllChem.EmbedMolecule(mol)

    # Create 3Dmol.js view
    viewer = py3Dmol.view(width=600, height=400)
    viewer.addModel(Chem.MolToMolBlock(mol), 'sdf')
    viewer.setStyle({'stick': {}})
    viewer.zoomTo()

    # Return HTML
    return viewer._make_html(), 200, {'Content-Type': 'text/html'}
```

---

## Resources

### Official Documentation

-   PyMOL Wiki: https://pymolwiki.org/
-   PyMOL Tutorial: https://pymolwiki.org/index.php/Practical_Pymol_for_Beginners
-   Command Reference: https://pymolwiki.org/index.php/Category:Commands

### Video Tutorials

-   PyMOL Basics: https://www.youtube.com/watch?v=KpW0kDluGxY
-   Advanced Visualization: https://www.youtube.com/watch?v=sGSH0dgrXIQ

### Alternative Tools

-   **VMD** (Visual Molecular Dynamics): https://www.ks.uiuc.edu/Research/vmd/
-   **Chimera/ChimeraX**: https://www.cgl.ucsf.edu/chimerax/
-   **Avogadro**: https://avogadro.cc/

---

## Summary

1. **For most users**: Download PyMOL installer from GitHub or official site
2. **For Python users**: Use `conda install -c conda-forge pymol-open-source`
3. **For web-only**: Consider online viewers like Mol\* or NGL
4. **FilSpresso Next**: Download SDF files and open in PyMOL for full 3D visualization

PyMOL is **not required** for the FilSpresso Next backend—it's a **client-side tool** for users to view downloaded SDF files in full 3D.

---

Happy molecular visualization! 🧬✨
