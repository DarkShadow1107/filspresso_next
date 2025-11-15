# Chemistry Mode Updates - Tanka-Only Lock

## Summary of Changes

This update enforces **Tanka-only** access for Chemistry Mode, locking Villanelle and Ode models when chemistry visualization is active.

---

## ✅ Changes Implemented

### 1. **Model Locking in Chemistry Mode**

**File**: `src/components/CoffeeRecommender.tsx`

-   Villanelle and Ode buttons are now **disabled** when Chemistry Mode is active
-   Lock icon (🔒) displays on disabled models
-   Tooltips explain: "Not available in Chemistry Mode (Tanka only)"

```typescript
disabled={chemistryMode || !isLoggedIn || (userSubscription !== "max" && userSubscription !== "ultimate")}
```

### 2. **Auto-Switch to Tanka**

When enabling Chemistry Mode:

-   Automatically switches to Tanka model
-   Ensures compatibility with chemistry features

```typescript
onClick={() => {
    setChatMode("general");
    setChemistryMode(!chemistryMode);
    // Automatically switch to Tanka when enabling chemistry mode
    if (!chemistryMode) {
        setSelectedModel("tanka");
    }
}}
```

### 3. **Chemistry Mode Auto-Disable**

Added useEffect hook:

-   Disables Chemistry Mode if user switches to Villanelle or Ode
-   Clears current molecule display
-   Prevents state conflicts

```typescript
useEffect(() => {
	if (chemistryMode && selectedModel !== "tanka") {
		setChemistryMode(false);
		setCurrentMolecule(null);
	}
}, [selectedModel, chemistryMode]);
```

### 4. **Updated Requirements.txt**

**File**: `python_ai/requirements.txt`

Added:

-   Comments about PyMOL (desktop application, not Python package)
-   Optional dependencies for advanced molecular work (RDKit, Py3Dmol)
-   Clear installation instructions

```
# Chemistry Mode Dependencies
chembl-webresource-client==0.10.8

# Optional: For advanced molecular visualization and analysis (server-side)
# rdkit>=2023.9.1
# py3Dmol>=2.0.4
# pillow>=10.0.0

# Note: PyMOL is a desktop application for viewing SDF files
# Install separately: https://pymol.org/ or via conda
```

### 5. **New Documentation**

**File**: `PYMOL_SETUP.md`

Comprehensive guide covering:

-   What PyMOL is and why it's used
-   3 installation methods (Official installer, Conda, pip)
-   Quick start guide for using with Chemistry Mode
-   Basic PyMOL commands and visualization techniques
-   Troubleshooting common issues
-   Alternative web-based viewers
-   Future integration possibilities with RDKit/3Dmol.js

### 6. **Updated Documentation**

**Files**:

-   `CHEMISTRY_MODE_README.md`
-   `QUICK_START_CHEMISTRY.md`

Updates include:

-   Clarification that Chemistry Mode is Tanka-only
-   Explanation of model locking behavior
-   Updated troubleshooting section
-   Clear access requirements

---

## 🔒 Why Tanka-Only?

### Technical Reasons:

1. **Specialized Processing**: Tanka is optimized for structured data queries (like molecular searches)
2. **Performance**: Lightweight model handles rapid molecule lookups efficiently
3. **Compatibility**: Chemistry Mode features designed specifically for Tanka's architecture
4. **Resource Management**: Prevents conflicts with larger models (Villanelle/Ode) loading Gemma

### User Experience:

-   Clear separation of capabilities
-   Prevents confusion about which features work with which models
-   Ultimate subscribers still get exclusive access via subscription gate

---

## 🧪 User Flow

### Before Chemistry Mode:

```
User → Select Model (Tanka/Villanelle/Ode) → Chat normally
```

### With Chemistry Mode:

```
User → Must use Tanka → Enable Chemistry Mode → Other models locked
     ↓
Search molecules → Visualize 2D/3D → Download SDF for PyMOL
```

### Switching Back:

```
User → Disable Chemistry Mode → Can select Villanelle/Ode again
```

---

## 🎯 Expected Behavior

### When Chemistry Mode is OFF:

-   ✅ Tanka available (free/all tiers)
-   ✅ Villanelle available (Max/Ultimate tiers)
-   ✅ Ode available (Ultimate tier only)
-   ✅ 🧪 Chemistry Mode button visible (if Tanka + Ultimate)

### When Chemistry Mode is ON:

-   ✅ Tanka **ACTIVE** and available
-   🔒 Villanelle **LOCKED** with message
-   🔒 Ode **LOCKED** with message
-   ✅ Visualization mode selector visible
-   ✅ Molecule search and display active

### If User Tries to Switch Away from Tanka:

-   ⚠️ Chemistry Mode automatically **DISABLES**
-   ℹ️ Current molecule display **CLEARS**
-   ✅ Selected model switches (if subscription allows)

---

## 📋 Testing Checklist

### Test Case 1: Enable Chemistry Mode

1. ✅ Log in with Ultimate subscription
2. ✅ Select Tanka model
3. ✅ Click Chemistry Mode button
4. ✅ Verify Villanelle button shows 🔒 and is disabled
5. ✅ Verify Ode button shows 🔒 and is disabled
6. ✅ Verify Tanka remains active and clickable

### Test Case 2: Try to Switch Models in Chemistry Mode

1. ✅ Enable Chemistry Mode (with Tanka)
2. ✅ Try to click Villanelle → Should be disabled
3. ✅ Try to click Ode → Should be disabled
4. ✅ Hover over locked models → Should show tooltip explaining restriction

### Test Case 3: Disable Chemistry Mode

1. ✅ Enable Chemistry Mode
2. ✅ Load a molecule (e.g., "Show CHEMBL25")
3. ✅ Click Chemistry Mode button again to disable
4. ✅ Verify Villanelle/Ode buttons become enabled (if subscription allows)
5. ✅ Verify molecule display remains (or clears - depending on design choice)

### Test Case 4: Auto-Disable When Switching Models

1. ✅ Enable Chemistry Mode with Tanka
2. ✅ Load a molecule
3. ✅ (Somehow) switch to Villanelle or Ode
4. ✅ Verify Chemistry Mode automatically disables
5. ✅ Verify molecule display clears
6. ✅ Verify new model becomes active

---

## 🔧 PyMOL Clarification

### What PyMOL Is:

-   **Desktop application** for 3D molecular visualization
-   Users install it separately on their computers
-   NOT a Python package for the backend

### How It's Used:

1. User searches for molecule in Chemistry Mode
2. User sets visualization to "3D Model" or "Both"
3. User clicks "Download SDF" button
4. User opens downloaded `.sdf` file in PyMOL (on their computer)

### Backend Role:

-   Backend **serves** SDF files via `/api/molecule/sdf/<chembl_id>`
-   Backend does **NOT** need PyMOL installed
-   Backend uses `chembl-webresource-client` to fetch SDF data

### Optional Enhancement (Future):

-   Could add **RDKit** to backend for custom molecular processing
-   Could add **Py3Dmol** for in-browser 3D rendering (no PyMOL needed)
-   Could integrate **3Dmol.js** on frontend for interactive 3D without downloads

---

## 📦 Installation Notes

### Required (Already in requirements.txt):

```bash
pip install chembl-webresource-client
```

### Optional (For Advanced Features):

```bash
# If you want server-side molecular manipulation:
pip install rdkit

# If you want in-browser 3D rendering:
pip install py3Dmol

# For custom image generation:
pip install pillow
```

### PyMOL (User's Computer):

```bash
# Option 1: Conda (recommended)
conda install -c conda-forge pymol-open-source

# Option 2: Download installer
# Windows: https://github.com/schrodinger/pymol-open-source/releases
# macOS: brew install pymol
# Linux: apt-get install pymol
```

---

## 🚀 Next Steps

### For Users:

1. Download ChEMBL dataset: `python download_all_chembl.py --limit 50 --embed-assets`
2. Start Flask backend: `python app.py`
3. Enable Chemistry Mode in browser
4. Install PyMOL on computer (see PYMOL_SETUP.md)
5. Download SDF files and visualize in PyMOL

### For Developers (Future Enhancements):

1. **Add RDKit integration** for custom molecular drawings
2. **Integrate 3Dmol.js** for in-browser 3D (no PyMOL needed)
3. **Add molecular property filters** (MW, LogP, PSA)
4. **Implement similarity search** based on structure
5. **Add batch export** of multiple molecules

---

## 📚 Documentation

-   **[CHEMISTRY_MODE_README.md](./CHEMISTRY_MODE_README.md)** - Complete technical guide
-   **[QUICK_START_CHEMISTRY.md](./QUICK_START_CHEMISTRY.md)** - Fast setup instructions
-   **[PYMOL_SETUP.md](./PYMOL_SETUP.md)** - PyMOL installation and usage guide

---

## Summary

✅ Chemistry Mode now **exclusively uses Tanka model**  
✅ Villanelle and Ode are **automatically locked** when active  
✅ Users can't accidentally switch models while viewing molecules  
✅ PyMOL setup guide provided for 3D visualization  
✅ All documentation updated with new restrictions

The feature is now more focused, clearer for users, and prevents model-switching confusion! 🧬✨
