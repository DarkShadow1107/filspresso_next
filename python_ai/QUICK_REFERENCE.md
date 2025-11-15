# Tanka Model Quick Reference

## Architecture

```
🧠 Tanka Model Architecture (ALWAYS the same)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Input → Embeddings → Positional
           ↓
    Graph Neural Network (GNN) ← ALWAYS ON
           ↓
  Recurrent Neural Network (RNN) ← ALWAYS ON
           ↓
   Transformer Layers (8 layers)
           ↓
    Multi-Query Attention (MQA)
           ↓
  Coffee Domain Attention
           ↓
      SwiGLU Activation
           ↓
         Output
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Parameters: ~30M
GNN Layers: 2 (256 hidden)
RNN Layers: 2 (256 hidden, bidirectional LSTM)
Transformer Layers: 8 (512 hidden)
Attention Heads: 8 (2 KV heads for MQA)
```

## Chemistry Mode Toggle

| Feature           | Standard Mode       | Chemistry Mode            |
| ----------------- | ------------------- | ------------------------- |
| **Architecture**  | GNN+RNN+Transformer | GNN+RNN+Transformer       |
| **Embeddings**    | Standard            | Chemistry-specific        |
| **Training Data** | Coffee text files   | ChEMBL molecular JSON     |
| **Subscription**  | Any tier            | **Ultimate only**         |
| **Checkpoint**    | `tanka_best.pt`     | `tanka_chemistry_best.pt` |

## Quick Commands

### Setup

```powershell
# Install dependencies
pip install -r requirements.txt

# Download ChEMBL data (optional)
python download_chembl_data.py
```

### Training

```powershell
# Train standard mode (coffee text)
python app.py  # Auto-loads tanka-training.txt

# Train chemistry mode (ChEMBL data)
python train_chemistry.py
```

### API Endpoints

#### Standard Mode (Any Subscription)

```bash
POST /api/generate
{
  "model": "tanka",
  "prompt": "What is the ideal espresso temperature?",
  "chemistry_mode": false,
  "subscription": "basic"
}
```

#### Chemistry Mode (Ultimate Only)

```bash
POST /api/generate
{
  "model": "tanka",
  "prompt": "Explain the molecular structure of caffeine",
  "chemistry_mode": true,
  "subscription": "ultimate"
}
```

## File Locations

```
python_ai/
├── models.py                    # GNN+RNN always enabled
├── app.py                       # Flask server
├── download_chembl_data.py      # ChEMBL download script
├── train_chemistry.py           # Chemistry training script
├── data/
│   ├── tanka-training.txt       # Standard text data
│   └── chembl-training.json     # Chemistry molecular data
└── models_checkpoint/
    ├── tanka_best.pt            # Standard checkpoint
    └── tanka_chemistry_best.pt  # Chemistry checkpoint
```

## Subscription Requirements

```
┌──────────────────────────────────────────┐
│  Feature              Subscription       │
├──────────────────────────────────────────┤
│  Standard Tanka       Any tier          │
│  GNN Architecture     Any tier          │
│  RNN Architecture     Any tier          │
│  Chemistry Mode       Ultimate only 🔒   │
│  ChEMBL Training      Ultimate only 🔒   │
├──────────────────────────────────────────┤
│  Chemistry mode requires Ultimate        │
│  subscription for access to molecular    │
│  embeddings and ChEMBL training data     │
└──────────────────────────────────────────┘
```

## Key Concepts

### GNN (Graph Neural Network)

-   **Purpose**: Process graph/structure data
-   **Layers**: 2 graph convolution layers
-   **Hidden Size**: 256
-   **Use**: Understands relationships and connections
-   **Active**: ✅ ALWAYS (standard and chemistry modes)

### RNN (Recurrent Neural Network)

-   **Purpose**: Sequential dependency modeling
-   **Type**: Bidirectional LSTM
-   **Layers**: 2
-   **Hidden Size**: 256 (512 total with bidirectional)
-   **Use**: Better context understanding
-   **Active**: ✅ ALWAYS (standard and chemistry modes)

### Chemistry Mode

-   **Embeddings**: Atoms, bonds, molecular weight, logP
-   **Training**: ChEMBL molecular database
-   **Subscription**: Ultimate tier required
-   **Benefits**: Molecular structure understanding

## Common Tasks

### Download ChEMBL Data

```powershell
# Default (18 compounds)
python download_chembl_data.py

# Limit molecules
python download_chembl_data.py --max-molecules 10

# Custom output
python download_chembl_data.py --output custom.json
```

### Test Models

```powershell
# Create models
python -c "from models import create_tanka_model; \
           tanka, config = create_tanka_model()"

# Verify GNN+RNN
python -c "from models import create_tanka_model; \
           t, c = create_tanka_model(); \
           print(f'GNN: {c.use_gnn}, RNN: {c.use_rnn}')"
```

### Run Server

```powershell
# Development
python app.py

# Production (Waitress)
python waitress_runner.py
```

### Test API

```powershell
# Start server in one terminal
python app.py

# Run tests in another terminal
python test_chemistry_api.py
```

## Troubleshooting

### GNN/RNN not enabled

**Issue**: Model doesn't have GNN/RNN
**Solution**: Update to latest `models.py` - GNN/RNN now always enabled

### ChEMBL download fails

**Issue**: Connection error or no results
**Solution**:

-   Check internet connection
-   Verify ChEMBL API is online: https://www.ebi.ac.uk/chembl/
-   Try with `--max-molecules 5` for smaller download

### Chemistry mode returns 403

**Issue**: Unauthorized access to chemistry mode
**Solution**: Chemistry mode requires Ultimate subscription

```json
{
	"subscription": "ultimate" // Required
}
```

### Import errors

**Issue**: `ModuleNotFoundError: chembl_webresource_client`
**Solution**: Install dependencies

```powershell
pip install -r requirements.txt
```

## Resources

-   **Documentation**: `README.md`
-   **Chemistry Guide**: `CHEMISTRY_MODE.md`
-   **ChEMBL Guide**: `CHEMBL_DOWNLOAD_GUIDE.md`
-   **Update Summary**: `GNN_RNN_ALWAYS_ON_UPDATE.md`
-   **Full Summary**: `RESTRUCTURING_SUMMARY.md`

## Quick Links

-   ChEMBL Database: https://www.ebi.ac.uk/chembl/
-   ChEMBL API: https://chembl.gitbook.io/chembl-interface-documentation/
-   Coffee Chemistry: https://www.sciencedirect.com/topics/food-science/coffee-chemistry

---

**Remember**:

-   ✅ GNN+RNN is **ALWAYS enabled** for Tanka
-   🧪 Chemistry mode = Different embeddings + ChemBL data
-   🔒 Chemistry mode requires **Ultimate subscription**
