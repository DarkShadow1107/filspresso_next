# Quick Start Guide - Chemistry Mode

## 🚀 Getting Started in 3 Steps

### Step 1: Download Molecule Data (5 minutes)

```bash
# Navigate to python_ai folder
cd python_ai

# Download 50 molecules with embedded visualizations
python download_all_chembl.py --limit 50 --embed-assets
```

**What this does:**

-   Downloads 50 named molecules from ChEMBL
-   Embeds SVG (2D) and SDF (3D) data directly in JSON
-   Creates `python_ai/data/chembl-molecules.json` (~2-5 MB for 50 molecules)

### Step 2: Start Flask Backend

```bash
# In python_ai folder
python app.py
```

**Expected output:**

```
🚀 Starting Flask server on port 5000
Initializing Kafelot coffee models...
Models loaded successfully
```

### Step 3: Enable Chemistry Mode in Browser

1. Open your FilSpresso Next app: `http://localhost:3000`
2. Open browser console (F12) and run:
    ```javascript
    localStorage.setItem("user_logged_in", "true");
    localStorage.setItem("user_subscription", "ultimate");
    ```
3. Refresh the page
4. Click the **Kafelot** icon (bottom-right corner)
5. Click **Start Chat**
6. Select **Tanka model** (green 🌿 button)
7. The **🧪 Chemistry Mode** button is now **always visible** - check if it's unlocked:
    - ✅ **No lock icon** = Ready to use
    - 🔒 **Lock icon** = Hover to see why (login/subscription/model)
8. Click Chemistry Mode to enable
9. **Note**: When Chemistry Mode is active, Villanelle and Ode models will be locked (Tanka only)

---

## 🧪 Example Queries

Once in Chemistry Mode, try these:

### By ChEMBL ID

```
Show me CHEMBL25
Display CHEMBL113
```

### By Common Name

```
Show caffeine molecule
Display aspirin structure
Find glucose
Show me chlorogenic acid
```

---

## 🔬 Visualization Options

Click on the visualization mode buttons:

-   **📝 Text Only**: See molecular properties without graphics
-   **🖼️ 2D Structure**: View SVG chemical structure diagram
-   **🧊 3D Model**: Get SDF file for PyMOL (downloadable)
-   **🔄 Both**: Display 2D and 3D simultaneously

---

## 💡 Quick Tips

### Download More Molecules

```bash
# Download 500 molecules (takes ~5-10 minutes)
python download_all_chembl.py --limit 500 --embed-assets

# Resume an interrupted download
python download_all_chembl.py --limit 1000 --resume --embed-assets
```

### Save SVG/SDF as Separate Files

```bash
# Better for large datasets
python download_all_chembl.py --limit 200 --download-svg --download-sdf
```

Files saved to:

-   `python_ai/data/svg/CHEMBL*.svg`
-   `python_ai/data/sdf/CHEMBL*.sdf`

### Use PyMOL for 3D Viewing

1. Set visualization mode to **3D Model**
2. Search for a molecule (e.g., "Show aspirin")
3. Click **⬇️ Download SDF** button
4. Open in PyMOL:
    ```bash
    pymol CHEMBL113.sdf
    ```

---

## 🐛 Common Issues

### "Chemistry Mode button not appearing"

**Update**: Chemistry Mode button is now **always visible** (latest version).

If you see it but it's locked (🔒), check:

-   **Login status**: `localStorage.getItem('user_logged_in')` should return `"true"`
-   **Subscription**: `localStorage.getItem('user_subscription')` should return `"ultimate"`
-   **Model selection**: Tanka model (green 🌿 button) must be selected
-   Refresh page after setting localStorage

### "Molecule not found"

**Solution:**

-   Download more molecules: `python download_all_chembl.py --limit 500 --embed-assets`
-   Try searching by exact ChEMBL ID instead of name
-   Check `python_ai/data/chembl-molecules.json` exists

### "Failed to load molecule visualization"

**Solution:**

-   Ensure Flask backend is running: `python python_ai/app.py`
-   Check Flask is on port 5000: `http://localhost:5000/api/health`
-   Re-download dataset with assets: `python download_all_chembl.py --limit 50 --embed-assets`

---

## 📚 Learn More

See [CHEMISTRY_MODE_README.md](./CHEMISTRY_MODE_README.md) for:

-   Complete API reference
-   Frontend implementation details
-   Advanced usage and customization
-   Troubleshooting guide

---

## 🎯 Expected Behavior

### When Chemistry Mode is Active:

✅ Chemistry Mode button shows (always visible now)  
✅ Button is **unlocked** when Tanka + Ultimate + Logged in  
✅ Button is **locked 🔒** when requirements not met (hover for reason)  
✅ Visualization mode selector appears below model selector  
✅ Welcome message shows chemistry-specific examples  
✅ Molecule queries trigger visual display below chat  
✅ SVG renders inline (for 2D mode)  
✅ SDF downloads available (for 3D mode)

### Access Requirements:

-   ✅ User logged in
-   ✅ Ultimate subscription active
-   ✅ **Tanka model selected** (Villanelle and Ode locked in Chemistry Mode)
-   ✅ ChEMBL dataset downloaded
-   ✅ Flask backend running

---

Happy molecule exploring! 🧬✨
