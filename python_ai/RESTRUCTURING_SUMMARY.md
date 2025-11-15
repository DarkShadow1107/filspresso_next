# Tanka Model Restructuring - Summary

## Overview

Restructured the Python AI Tanka model with Graph Neural Network (GNN) and Recurrent Neural Network (RNN) architecture, added Chemistry Mode exclusively for Ultimate subscription users, and reorganized training data.

## Major Changes

### 1. Model Architecture (`models.py`)

#### New Components Added:

-   **GraphNeuralNetwork (GNN)**: Processes molecular graph structures

    -   Node features and adjacency matrix support
    -   Message passing for graph convolution
    -   2-layer architecture with 256 hidden size

-   **RecurrentNeuralNetwork (RNN)**: Bidirectional LSTM for sequence modeling

    -   2-layer bidirectional LSTM
    -   256 hidden size
    -   Residual connections and layer normalization

-   **ChemistryEmbedding**: Specialized embeddings for molecular data
    -   Atom embeddings (C, N, O, etc.)
    -   Bond embeddings (single, double, aromatic)
    -   Molecular weight and logP projections
    -   Fusion layer for combining features

#### Updated ModelConfig:

```python
- use_gnn: bool = False
- use_rnn: bool = False
- gnn_hidden_size: int = 256
- rnn_hidden_size: int = 256
- rnn_num_layers: int = 2
- chemistry_mode: bool = False
- chemistry_embedding_size: int = 128
```

#### Updated AdvancedAIModel:

-   Supports chemistry embeddings
-   GNN processing with optional adjacency matrix
-   RNN sequence enhancement
-   Chemistry data forward pass support

#### Updated create_tanka_model:

```python
create_tanka_model(vocab_size=50000, chemistry_mode=False)
```

-   Now accepts `chemistry_mode` parameter
-   Enables GNN+RNN architecture by default
-   Chemistry mode flag for Ultimate subscription

### 2. Inference Engine (`inference.py`)

#### New Features:

-   `_validate_subscription()`: Checks Ultimate subscription for chemistry mode
-   Updated `generate()`: Accepts `subscription_tier` and `chemistry_data` parameters
-   Updated `chat()`: Subscription validation support
-   Error messages for unauthorized chemistry mode access

### 3. Training Pipeline (`trainer.py`)

#### New Components:

-   **ChemBLDataset**: Dataset class for ChemBL JSON format
    -   Loads molecules and training prompts
    -   Extracts training texts automatically
-   **load_chembl_data()**: Helper function to load ChemBL JSON

#### Updated Trainer.train():

```python
train(train_texts, val_texts, model_name, chembl_json_path=None)
```

-   Supports ChemBL JSON path for chemistry training
-   Automatic dataset selection based on data source

### 4. Flask API (`app.py`)

#### Model Initialization:

-   Creates both regular and chemistry Tanka models
-   Separate inference engines for each mode
-   Checkpoint loading for `tanka_chemistry_best.pt`

#### Updated Endpoints:

**POST /api/generate**:

-   New parameters: `subscription`, `chemistry_mode`
-   Subscription validation
-   Returns 403 Forbidden if unauthorized
-   Model selection: `tanka_chemistry` for chemistry mode

**POST /api/chat**:

-   Chemistry mode support
-   Subscription tier checking
-   Ultimate-only access enforcement

**POST /api/train**:

-   `chemistry_mode` parameter
-   `chembl_json_path` parameter
-   Subscription validation for chemistry training
-   Default ChemBL path: `./data/chembl-training.json`

### 5. Training Data Reorganization

#### Data Folder Structure:

```
python_ai/data/
├── capsule_volumes.json
├── tanka-training.txt       (moved from training_data/)
├── villanelle-training.txt  (moved from training_data/)
├── ode-training.txt         (moved from training_data/)
└── chembl-training.json     (NEW - Chemistry Mode)
```

**Migration**: All `.txt` files moved from `training_data/` to `data/` folder.

### 6. ChemBL Training Data (`chembl-training.json`)

#### Structure:

-   **metadata**: Source, description, categories
-   **molecules**: Array of molecule objects with:
    -   id, name, SMILES, InChI
    -   molecular_weight, logp
    -   properties (category, description, biological activity)
    -   atoms and bonds (graph structure)
    -   training_text (natural language description)
-   **training_prompts**: Q&A pairs for fine-tuning

#### Sample Molecules:

1. Caffeine (CHEMBL113)
2. Chlorogenic Acid
3. Trigonelline
4. 2-Methylfuran
5. Cafestol

### 7. Documentation

#### Created Files:

-   **CHEMISTRY_MODE.md**: Complete chemistry mode documentation

    -   Architecture details
    -   API usage examples
    -   Subscription requirements
    -   Training data format
    -   Error handling
    -   Use cases

-   **README.md**: Updated Python AI documentation
    -   Project structure
    -   Model descriptions
    -   Chemistry mode overview
    -   API endpoints
    -   Installation instructions
    -   Subscription tiers

## Subscription Requirements

| Feature            | Subscription Required |
| ------------------ | --------------------- |
| Regular Tanka      | Any tier              |
| Chemistry Mode     | **Ultimate only**     |
| GNN Architecture   | **Ultimate only**     |
| ChemBL Training    | **Ultimate only**     |
| Molecular Analysis | **Ultimate only**     |

## API Error Responses

### 403 Forbidden (Unauthorized Chemistry Mode):

```json
{
	"error": "Chemistry mode requires Ultimate subscription",
	"message": "Please upgrade to Ultimate subscription to access molecular analysis features"
}
```

## Model Checkpoints

-   **tanka_best.pt**: Regular Tanka model
-   **tanka_chemistry_best.pt**: Chemistry mode Tanka model (NEW)
-   **villanelle_best.pt**: Villanelle model
-   **ode_best.pt**: Ode model

## Usage Examples

### Generate with Chemistry Mode:

```python
POST /api/generate
{
  "model": "tanka",
  "prompt": "Explain caffeine structure",
  "chemistry_mode": true,
  "subscription": "ultimate",
  "temperature": 0.7
}
```

### Train Chemistry Mode:

```python
POST /api/train
{
  "model": "tanka",
  "chemistry_mode": true,
  "subscription": "ultimate",
  "chembl_json_path": "./data/chembl-training.json",
  "num_epochs": 5
}
```

## Technical Specifications

### GNN Architecture:

-   **Layers**: 2
-   **Hidden Size**: 256
-   **Activation**: ReLU
-   **Dropout**: 0.1
-   **Message Passing**: Optional adjacency matrix

### RNN Architecture:

-   **Type**: Bidirectional LSTM
-   **Layers**: 2
-   **Hidden Size**: 256
-   **Features**: Residual connections, layer normalization

### Chemistry Embeddings:

-   **Atom Embedding**: Vocabulary-based
-   **Bond Embedding**: 10 types
-   **Molecular Properties**: Weight, logP
-   **Output**: Fused hidden representations

## Benefits

1. **Molecular Understanding**: GNN processes graph structures
2. **Sequence Modeling**: RNN captures temporal dependencies
3. **Coffee Chemistry**: Specialized knowledge of coffee molecules
4. **Premium Feature**: Exclusive to Ultimate subscribers
5. **Flexible Training**: Supports both text and ChemBL data
6. **Subscription Gating**: Proper access control and monetization

## Future Enhancements

-   3D molecular structure support
-   Reaction prediction
-   Retrosynthesis planning
-   Extended ChemBL dataset (100 → millions of molecules)
-   Advanced property prediction

## Files Modified

1. `python_ai/models.py` - Added GNN, RNN, Chemistry embeddings
2. `python_ai/inference.py` - Subscription validation, chemistry support
3. `python_ai/trainer.py` - ChemBL dataset support
4. `python_ai/app.py` - Chemistry mode endpoints, subscription checks
5. `python_ai/data/chembl-training.json` - NEW chemistry training data
6. `python_ai/CHEMISTRY_MODE.md` - NEW documentation
7. `python_ai/README.md` - NEW comprehensive guide

## Testing Commands

```powershell
# Start server
cd python_ai
python app.py

# Test health endpoint
curl http://localhost:5000/api/health

# Test chemistry mode (requires Ultimate)
curl -X POST http://localhost:5000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"tanka","prompt":"Explain caffeine","chemistry_mode":true,"subscription":"ultimate"}'

# Test unauthorized access
curl -X POST http://localhost:5000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"tanka","prompt":"Explain caffeine","chemistry_mode":true,"subscription":"basic"}'
```

## Status

✅ All tasks completed:

1. GNN+RNN architecture implemented
2. Chemistry mode added to Tanka
3. ChemBL training data created
4. Subscription validation added
5. API endpoints updated
6. Training pipeline supports ChemBL
7. Documentation created

**Ready for deployment and testing!**
