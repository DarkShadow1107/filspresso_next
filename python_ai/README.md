# Python AI Server - Kafelot Coffee Models

Advanced AI models for coffee domain expertise powered by Flask.

## Models

### Tanka (~30M parameters)

-   **Architecture**: GNN + RNN hybrid with transformer layers (**ALWAYS enabled**)
-   **Features**: Multi-Query Attention, RoPE, SwiGLU, Coffee Domain Attention
-   **Use Case**: Lightweight, conversational interactions
-   **Chemistry Mode**: Uses specialized embeddings + ChemBL training (Ultimate subscription)
-   **Note**: GNN+RNN architecture is active for ALL Tanka models, regardless of chemistry mode

### Villanelle (~60M parameters)

-   **Architecture**: Enhanced transformer with light MoE
-   **Features**: Balanced technical depth and efficiency
-   **Use Case**: Technical coffee discussions

### Ode (~90M parameters)

-   **Architecture**: Comprehensive transformer with full MoE
-   **Features**: Research-grade capabilities
-   **Use Case**: In-depth coffee research and analysis

## Chemistry Mode 🧪

**Available exclusively for Ultimate subscription users**

Chemistry Mode enhances Tanka with specialized molecular understanding:

-   **Chemistry Embeddings**: Atoms, bonds, molecular weight, logP values
-   **ChemBL Training Data**: Real molecular database from EMBL-EBI
-   **Molecular Analysis**: Structure, properties, bioactivity

**Important**: The GNN+RNN architecture is **ALWAYS enabled** for Tanka. Chemistry mode only changes the embeddings and training data source.

[Read full Chemistry Mode documentation](./CHEMISTRY_MODE.md)
[ChEMBL Data Download Guide](./CHEMBL_DOWNLOAD_GUIDE.md)

## Project Structure

```
python_ai/
├── app.py                      # Flask API server
├── models.py                   # Model architectures (GNN, RNN, Transformer)
├── inference.py                # Inference engine with chemistry mode
├── trainer.py                  # Training pipeline with ChemBL support
├── tokenizer.py                # Simple tokenizer
├── iot_db.py                   # IoT database helper
├── iot_db_sqlalchemy.py        # SQLAlchemy IoT wrapper
├── data/                       # Training data (moved from training_data/)
│   ├── capsule_volumes.json   # Coffee capsule data
│   ├── tanka-training.txt      # Tanka training data
│   ├── villanelle-training.txt # Villanelle training data
│   ├── ode-training.txt        # Ode training data
│   └── chembl-training.json    # ChemBL molecular data (Chemistry Mode)
├── models_checkpoint/          # Model checkpoints
│   ├── tanka_best.pt
│   ├── tanka_chemistry_best.pt # Chemistry mode checkpoint
│   ├── villanelle_best.pt
│   └── ode_best.pt
├── migrations/                 # Database migrations
└── requirements.txt            # Python dependencies
```

**Note**: Training data has been moved from `training_data/` to `data/` for better organization.

## Installation

### Local Development

1. Create virtual environment:

    ```powershell
    cd python_ai
    python -m venv .venv
    .\.venv\Scripts\Activate.ps1
    ```

2. Install dependencies:

    ```powershell
    pip install -r requirements.txt
    ```

3. Run the server:
    ```powershell
    python app.py
    ```

Server will start on `http://localhost:5000`

### Environment Variables

-   `PYTHON_AI_PORT`: Server port (default: 5000)
-   `FLASK_ENV`: Set to `development` for debug mode
-   `IOT_USE_SQLALCHEMY`: Use SQLAlchemy for IoT DB (0 or 1)
-   `PYTHON_AI_VOCAB_SIZE`: Tokenizer vocabulary size (default: 30000)

## API Endpoints

### Health Check

```bash
GET /api/health
```

### Generate Text

```bash
POST /api/generate
Content-Type: application/json

{
  "model": "tanka",
  "prompt": "What is the best brewing temperature?",
  "max_length": 256,
  "temperature": 0.7,
  "chemistry_mode": false,
  "subscription": "ultimate"
}
```

### Chat

```bash
POST /api/chat
Content-Type: application/json

{
  "model": "villanelle",
  "message": "How does water quality affect espresso?",
  "history": [],
  "subscription": "basic"
}
```

### Train Model

```bash
POST /api/train
Content-Type: application/json

{
  "model": "tanka",
  "texts": ["Coffee is...", "Espresso requires..."],
  "num_epochs": 3,
  "batch_size": 16,
  "chemistry_mode": false
}
```

### Train Chemistry Mode (Ultimate only)

```bash
POST /api/train
Content-Type: application/json

{
  "model": "tanka",
  "chemistry_mode": true,
  "subscription": "ultimate",
  "chembl_json_path": "./data/chembl-training.json",
  "num_epochs": 5
}
```

## IoT Commands API

### Create Command

```bash
POST /api/commands/create
Content-Type: application/json

{
  "machine_id": "esp32_001",
  "recipe": {
    "volume": 40,
    "temperature": 92,
    "pressure": 9
  },
  "execute_allowed": true
}
```

### Check Commands (Device Polling)

```bash
GET /api/commands/check/esp32_001
```

### Update Command Status

```bash
POST /api/commands/update/1
Content-Type: application/json

{
  "status": "complete",
  "meta": {"duration": 25}
}
```

## Subscription Tiers

| Feature            | Free | Basic | Plus | Pro | Max | **Ultimate** |
| ------------------ | ---- | ----- | ---- | --- | --- | ------------ |
| Tanka              | ✅   | ✅    | ✅   | ✅  | ✅  | ✅           |
| Villanelle         | ❌   | ✅    | ✅   | ✅  | ✅  | ✅           |
| Ode                | ❌   | ❌    | ❌   | ❌  | ✅  | ✅           |
| **Chemistry Mode** | ❌   | ❌    | ❌   | ❌  | ❌  | **✅**       |

## Architecture Details

### Tanka GNN+RNN Architecture

```
Input → Chemistry Embeddings → Positional Embeddings
                                       ↓
                                      GNN (Graph Neural Network)
                                       ↓
                                      RNN (Bidirectional LSTM)
                                       ↓
                              Transformer Layers (8x)
                                       ↓
                                    Output
```

### Chemistry Embeddings

-   Atom embeddings (C, N, O, etc.)
-   Bond embeddings (single, double, aromatic)
-   Molecular weight projection
-   LogP (lipophilicity) projection

## Development

### Create Models

```python
from models import create_tanka_model, create_villanelle_model, create_ode_model

# Regular Tanka
tanka, config = create_tanka_model(vocab_size=50000, chemistry_mode=False)

# Chemistry Tanka (Ultimate)
tanka_chem, config = create_tanka_model(vocab_size=50000, chemistry_mode=True)

# Other models
villanelle, config = create_villanelle_model(vocab_size=50000)
ode, config = create_ode_model(vocab_size=50000)
```

### Inference

```python
from inference import InferenceEngine

engine = InferenceEngine(model, tokenizer, device='cuda', chemistry_mode=True)

response = engine.generate(
    prompt="Explain caffeine structure",
    subscription_tier="ultimate"
)
```

## Database

The server uses SQLite by default for IoT commands. MariaDB is available via Docker:

```powershell
cd python_ai
docker-compose -f docker-compose.maria.yml up -d
```

Environment variables for MariaDB:

-   `MYSQL_ROOT_PASSWORD`
-   `MYSQL_DATABASE`
-   `MYSQL_USER`
-   `MYSQL_PASSWORD`

## Production Deployment

For production, use Waitress (Windows) or Gunicorn (Linux):

```powershell
# Install Waitress (already in requirements.txt)
pip install waitress

# Create runner script (waitress_runner.py)
# Then run:
python waitress_runner.py
```

## License

See main repository LICENSE file.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new features
5. Submit a pull request

## Support

For issues or questions:

-   Chemistry Mode: See [CHEMISTRY_MODE.md](./CHEMISTRY_MODE.md)
-   General API: Check this README
-   Bugs: Open an issue on GitHub

---

**Powered by PyTorch, Flask, and advanced transformer architectures**
