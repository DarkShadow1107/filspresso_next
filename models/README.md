# Models Folder

This folder contains model-related assets and optional local experimentation dependencies.

## 1. Directory Purpose

- `conf/`: model/runtime configuration files
- `data/`: model-related data artifacts
- `model/`: model files and runtime assets
- `tanka.py`: model integration helper
- `requirements.txt`: optional legacy chemistry/image stack dependencies

## 2. Runtime Relationship In This Repository

Current production-oriented AI path:

- main runtime requests flow through `app.py`
- primary model serving uses llama.cpp containers from compose

This folder is therefore used for:

- model-adjacent utilities
- optional experiments and compatibility work
- data/config artifacts that support local AI workflows

## 3. Requirements File Intent

`models/requirements.txt` is documented as optional and oriented to local experiments.
The main Docker AI runtime path is centered on llama.cpp model serving rather than these legacy dependencies.

## 4. Usage Patterns

Typical usage in this repository:

- runtime AI requests flow through the Python AI service (`app.py`) and llama.cpp containers
- this folder remains available for local model experimentation and compatibility workflows

## 5. Good Practices

- keep large binary model blobs out of Git
- track only reproducible metadata/config and small helper code
- validate optional dependencies in isolated virtual environments

## 6. Example Local Workflow

```bash
python -m venv .venv
.venv\\Scripts\\activate
pip install -r models/requirements.txt
```

Use this only when running experiment paths that require these packages.

## 7. Related Docs

- root `README.md`
- `docs/README.md`
- `security/README.md`
