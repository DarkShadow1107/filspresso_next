# Chemistry Mode Fallback - Visual Examples

## Chat Window Display

### Example 1: Successful API Response

```
┌─────────────────────────────────────────────────────────────┐
│ You                                                          │
│ Show me the caffeine molecule                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Kafelot                                                      │
│ Found molecule: Caffeine                                    │
│                                                              │
│ Formula: C8H10N4O2                                           │
│ Weight: 194.19 g/mol                                        │
│ SMILES: CN1C=NC2=C1C(=O)N(C(=O)N2C)C                        │
│                                                              │
│ Visualization loaded in 2D and 3D.                          │
│                                                              │
│ ┌────────────────────────┐  ┌────────────────────────┐      │
│ │ 2D Structure (SVG)     │  │ 3D Model (SDF for      │      │
│ │                        │  │ PyMOL)                 │      │
│ │  [caffeine molecule]   │  │ [3D structure data]    │      │
│ │   N bonds visible      │  │ Can import to tools    │      │
│ │                        │  │                        │      │
│ └────────────────────────┘  └────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

### Example 2: Fallback Response (API Down)

```
┌─────────────────────────────────────────────────────────────┐
│ You                                                          │
│ Show me caffeine                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Kafelot                                                      │
│ 🔍 Found molecule (from local cache): Caffeine              │
│                                                              │
│ 📋 Details:                                                 │
│ Formula: C8H10N4O2                                           │
│ Weight: 194.19 g/mol                                        │
│ SMILES: CN1C=NC2=C1C(=O)N(C(=O)N2C)C                        │
│                                                              │
│ ✨ Visualization loaded in 2D and 3D.                       │
│                                                              │
│ 💡 Note: Using local cache (API may be offline).            │
│                                                              │
│ ┌────────────────────────┐  ┌────────────────────────┐      │
│ │ 2D Structure (SVG)     │  │ 3D Model (SDF for      │      │
│ │                        │  │ PyMOL)                 │      │
│ │  [cached structure]    │  │ [SDF data available]   │      │
│ │                        │  │                        │      │
│ └────────────────────────┘  └────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

### Example 3: Molecule Not Found

```
┌─────────────────────────────────────────────────────────────┐
│ You                                                          │
│ Show me xyzabc molecule                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Kafelot                                                      │
│ Could not find molecule "xyzabc" in local cache either.     │
│ Try a common coffee compound like "caffeine" or use a       │
│ ChEMBL ID.                                                  │
│                                                              │
│ 💡 Try these:                                               │
│   • "Show me caffeine"                                      │
│   • "What about chlorogenic acid?"                          │
│   • "Display CHEMBL25"                                      │
└─────────────────────────────────────────────────────────────┘
```

---

### Example 4: Using ChEMBL ID

```
┌─────────────────────────────────────────────────────────────┐
│ You                                                          │
│ What is CHEMBL25?                                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Kafelot                                                      │
│ 🔍 Found molecule (from local cache): Aspirin               │
│                                                              │
│ 📋 Details:                                                 │
│ Formula: C9H8O4                                              │
│ Weight: 180.16 g/mol                                        │
│ Synonyms: Acetylsalicylic acid                              │
│ SMILES: O=C(O)Cc1ccccc1C(=O)O                               │
│                                                              │
│ ✨ Visualization loaded in 2D and 3D.                       │
│                                                              │
│ 💡 Note: Using local cache (API may be offline).            │
│                                                              │
│ [2D Structure Display] [3D Model Display]                   │
└─────────────────────────────────────────────────────────────┘
```

---

### Example 5: Coffee Compound Detection

```
┌─────────────────────────────────────────────────────────────┐
│ You                                                          │
│ Tell me about chlorogenic acid                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Kafelot                                                      │
│ 🔍 Found molecule (from local cache):                       │
│    Chlorogenic acid                                         │
│                                                              │
│ 📋 Details:                                                 │
│ Formula: C16H18O9                                            │
│ Weight: 354.31 g/mol                                        │
│ Found in: Coffee, blueberries, eggplants                    │
│ SMILES: O=C(O)C=Cc1cc(ccc1O)C3CC(c2ccc(O)c(OC(=O)Cc(c(O)  │
│                                                              │
│ ✨ Visualization loaded in 2D.                              │
│                                                              │
│ 💡 Chlorogenic acid is a major antioxidant in coffee!       │
│                                                              │
│ [2D Structure Display]                                      │
│                                                              │
│ (3D data not available in cache)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Comparison

### API Response vs Cache Response

```
┌─────────────────────────────────────────────────┐
│            API              │      CACHE         │
├─────────────────────────────────────────────────┤
│ 🟢 All features available   │ 🟡 Basic features  │
│ ✓ 2D structures             │ ✓ 2D structures    │
│ ✓ 3D models                 │ ✓ 3D models        │
│ ✓ Real-time rendering       │ ✓ Cached data      │
│ ✓ No notice needed          │ 💡 Shows notice    │
│                             │                    │
│ ~200ms response time        │ ~50ms response     │
└─────────────────────────────────────────────────┘
```

---

## Inline Display in Chat

### Text-Only View (Both API and Cache)

```
Kafelot
🧪 Caffeine
ChEMBL ID: CHEMBL113
Formula: C8H10N4O2
Weight: 194.19 g/mol
SMILES: CN1C=NC2=C1C(=O)N(C(=O)N2C)C
```

### With 2D Visualization

```
Kafelot
🧪 Caffeine
ChEMBL ID: CHEMBL113
Formula: C8H10N4O2
Weight: 194.19 g/mol

2D Structure (SVG)
┌─────────────────────────┐
│   [molecular diagram]   │
│   N=C-N               │
│   |     |             │
│   N-C=C-N             │
│   6-membered ring      │
└─────────────────────────┘
```

### With 2D + 3D Visualization

```
Kafelot
🧪 Caffeine

┌─────────────┐   ┌──────────────┐
│  2D View    │   │  3D View     │
│  Structure  │   │  (SDF data)  │
│  Diagram    │   │  PyMOL ready │
└─────────────┘   └──────────────┘
```

---

## User Interaction Flow

```
1. User enables Chemistry Mode ✓
   (Ultimate subscription required)

2. User types molecule request
   "Show me caffeine"

3. System detects molecule query ✓

4. Primary path: Try API
   ├─ Success? → Display API response
   └─ Failure? → Continue to fallback

5. Fallback path: Try local cache
   ├─ Found? → Display cache response + notice
   └─ Not found? → Show helpful message

6. Either way:
   ├─ Molecule displays in chat window
   ├─ User sees 2D/3D visualizations
   ├─ Properties shown
   └─ User can interact (zoom, download, etc.)
```

---

## Graceful Degradation

### Scenario: Visualization API Fails

```
User request: Show caffeine

Result:
✅ Molecular properties loaded (from cache)
✅ Basic info displayed
⚠️ 2D visualization unavailable (API down)
⚠️ 3D visualization unavailable (API down)

Display:
🧪 Caffeine (from local cache)
Formula: C8H10N4O2
Weight: 194.19 g/mol
SMILES: CN1C=NC2=C1C(=O)N(C(=O)N2C)C

Note: Visualizations temporarily unavailable
(Try again when API is online)
```

---

## Advantages of Dual System

```
API Online:
├─ Fast, real-time rendering
├─ All visualizations available
├─ Latest molecule data
└─ Best user experience

API Offline:
├─ Still shows molecules
├─ Basic properties available
├─ Helpful error messages
└─ Graceful fallback

Never shows:
✗ "Error: API unavailable"
✗ "Cannot show molecules"
✗ Complete failure

Always shows:
✓ Molecule information
✓ Properties and formulas
✓ Best available visualizations
```

---

## Summary

Users get:

-   ✅ Molecule search by name
-   ✅ Molecule search by ID
-   ✅ Coffee compound detection
-   ✅ 2D/3D visualizations (when API available)
-   ✅ Graceful fallback when API down
-   ✅ Clear indication of data source
-   ✅ Helpful error messages
-   ✅ Integrated chat window display

All working in Chemistry Mode with Ultimate subscription! 🧪
