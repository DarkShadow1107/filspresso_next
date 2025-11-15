# Tanka Chemistry Mode 🧪

## Overview

Tanka Chemistry Mode is an advanced molecular understanding feature exclusively available for **Ultimate subscription** users.

**Important**: The Tanka model **ALWAYS uses GNN+RNN architecture** regardless of chemistry mode. Chemistry mode only affects:

1. **Embeddings**: Uses specialized chemistry embeddings (atoms, bonds, molecular properties)
2. **Training Data**: Trained on ChemBL molecular database instead of coffee text

## Architecture

### GNN + RNN Hybrid (ALWAYS ENABLED)

-   **Graph Neural Network (GNN)**: Processes molecular graph structures, understanding atoms and bonds
-   **Recurrent Neural Network (RNN)**: Models sequential dependencies in molecular descriptions
-   **Always Active**: Both GNN and RNN are enabled for all Tanka models

### Chemistry Mode Features

When chemistry mode is enabled (Ultimate subscription):

-   **Chemistry Embeddings**: Specialized embeddings for atoms, bonds, molecular weight, and logP values
-   **ChemBL Training**: Model trained on molecular database instead of coffee text
-   **Molecular Understanding**: Enhanced ability to understand chemical structures and properties

### Model Features

-   **Parameters**: ~30M (same as regular Tanka)
-   **Training Data**: ChemBL molecular database
-   **Capabilities**:
    -   Molecular structure understanding
    -   Chemical property analysis
    -   Coffee chemistry expertise (caffeine, chlorogenic acid, trigonelline, etc.)
    -   Flavor compound analysis
    -   Antioxidant and bioactive compound knowledge

## Training Data Format

Chemistry mode uses ChemBL-formatted JSON data. Example structure:

```json
{
	"metadata": {
		"source": "ChemBL Database",
		"description": "Molecular chemistry training data",
		"categories": ["caffeine_compounds", "flavor_molecules", "aroma_compounds", "antioxidants"]
	},
	"molecules": [
		{
			"id": "CHEMBL113",
			"name": "Caffeine",
			"smiles": "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
			"molecular_weight": 194.19,
			"logp": -0.07,
			"properties": {
				"category": "caffeine_compounds",
				"description": "Primary stimulant alkaloid found in coffee",
				"biological_activity": "Adenosine receptor antagonist",
				"concentration_in_coffee": "40-180 mg per cup"
			},
			"atoms": [
				{ "type": "C", "id": 0 },
				{ "type": "N", "id": 1 }
			],
			"bonds": [{ "from": 0, "to": 1, "type": "single" }],
			"training_text": "Caffeine is a xanthine alkaloid..."
		}
	],
	"training_prompts": [
		{
			"prompt": "What is the molecular structure of caffeine?",
			"response": "Caffeine has the molecular formula C8H10N4O2..."
		}
	]
}
```

## API Usage

### Generate with Chemistry Mode

```bash
POST http://localhost:5000/api/generate
Content-Type: application/json

{
  "model": "tanka",
  "prompt": "Explain the chemistry of caffeine",
  "chemistry_mode": true,
  "subscription": "ultimate",
  "max_length": 256,
  "temperature": 0.7
}
```

**Response:**

```json
{
	"model": "tanka_chemistry",
	"prompt": "Explain the chemistry of caffeine",
	"generated": "Caffeine (C8H10N4O2) is a xanthine alkaloid...",
	"chemistry_mode": true
}
```

### Chat with Chemistry Mode

```bash
POST http://localhost:5000/api/chat
Content-Type: application/json

{
  "model": "tanka",
  "message": "What compounds give coffee its antioxidant properties?",
  "chemistry_mode": true,
  "subscription": "ultimate",
  "temperature": 0.7
}
```

### Train Chemistry Mode

```bash
POST http://localhost:5000/api/train
Content-Type: application/json

{
  "model": "tanka",
  "chemistry_mode": true,
  "subscription": "ultimate",
  "chembl_json_path": "./data/chembl-training.json",
  "num_epochs": 3,
  "batch_size": 16,
  "learning_rate": 0.0001
}
```

## Subscription Requirements

| Feature            | Free | Basic | Plus | Pro | Max | **Ultimate** |
| ------------------ | ---- | ----- | ---- | --- | --- | ------------ |
| Regular Tanka      | ✅   | ✅    | ✅   | ✅  | ✅  | ✅           |
| **Chemistry Mode** | ❌   | ❌    | ❌   | ❌  | ❌  | **✅**       |
| GNN Architecture   | ❌   | ❌    | ❌   | ❌  | ❌  | **✅**       |
| ChemBL Training    | ❌   | ❌    | ❌   | ❌  | ❌  | **✅**       |
| Molecular Analysis | ❌   | ❌    | ❌   | ❌  | ❌  | **✅**       |

## Error Handling

If a user without Ultimate subscription tries to access chemistry mode:

```json
{
	"error": "Chemistry mode requires Ultimate subscription",
	"message": "Please upgrade to Ultimate subscription to access molecular analysis features"
}
```

HTTP Status: `403 Forbidden`

## Data Location

Training data is stored in:

```
python_ai/data/chembl-training.json
```

Previously in `python_ai/training_data/` has been moved to `python_ai/data/` for consistency.

## Model Checkpoints

-   **Regular Tanka**: `python_ai/models_checkpoint/tanka_best.pt`
-   **Chemistry Mode**: `python_ai/models_checkpoint/tanka_chemistry_best.pt`

## Example Use Cases

1. **Molecular Structure Queries**

    - "What is the molecular structure of caffeine?"
    - "Explain chlorogenic acid's antioxidant mechanism"

2. **Coffee Chemistry**

    - "What compounds contribute to coffee's bitter taste?"
    - "How does roasting affect trigonelline?"

3. **Flavor Analysis**

    - "Which molecules create coffee's aroma?"
    - "What is 2-methylfuran's role in coffee flavor?"

4. **Health & Bioactivity**
    - "What are the health benefits of chlorogenic acid?"
    - "How does cafestol affect cholesterol?"

## Development

### Creating Chemistry Models

```python
from models import create_tanka_model

# Regular Tanka
tanka_model, config = create_tanka_model(vocab_size=50000, chemistry_mode=False)

# Chemistry Mode Tanka
tanka_chem_model, config = create_tanka_model(vocab_size=50000, chemistry_mode=True)
```

### Training with ChemBL Data

```python
from trainer import Trainer
from tokenizer import SimpleTokenizer

tokenizer = SimpleTokenizer(vocab_size=50000)
trainer = Trainer(tanka_chem_model, tokenizer, device='cuda')

history = trainer.train(
    train_texts=[],
    model_name='tanka_chemistry',
    chembl_json_path='./data/chembl-training.json',
    num_epochs=5
)
```

## Technical Details

### GNN Architecture

-   **Node Features**: Atom embeddings (C, N, O, etc.)
-   **Graph Convolution**: 2 layers
-   **Hidden Size**: 256
-   **Message Passing**: Optional adjacency matrix support

### RNN Architecture

-   **Type**: Bidirectional LSTM
-   **Hidden Size**: 256
-   **Layers**: 2
-   **Features**: Residual connections, layer normalization

### Chemistry Embeddings

-   **Atom Embeddings**: Vocabulary-based
-   **Bond Embeddings**: 10 bond types
-   **Molecular Weight**: Linear projection
-   **LogP**: Linear projection
-   **Fusion Layer**: Combines all features

## Future Enhancements

-   [ ] Support for more complex molecular graphs
-   [ ] 3D structural information
-   [ ] Reaction prediction
-   [ ] Retrosynthesis planning
-   [ ] Extended ChemBL dataset (currently 100 molecules, expandable to millions)

## References

-   ChemBL Database: https://www.ebi.ac.uk/chembl/
-   Coffee Chemistry Literature
-   Graph Neural Networks for Molecular Property Prediction
-   Transformer Models for Chemical Understanding

---

**Note**: Chemistry mode is a premium feature designed for advanced users interested in molecular-level understanding of coffee chemistry. Ultimate subscription required.
