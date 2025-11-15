"""
Generate molecules.jsonl training dataset from ChEMBL data
Creates diverse instruction-following examples for fine-tuning Gemma
"""

import json
import random
from pathlib import Path

# Load ChEMBL molecules
chembl_path = Path(__file__).parent.parent / "data" / "chembl-molecules.json"
with open(chembl_path, 'r', encoding='utf-8') as f:
    data = json.load(f)
    molecules = data.get('molecules', [])

print(f"Loaded {len(molecules)} molecules from ChEMBL")

# Prompt templates for variety
PROMPT_TEMPLATES = {
    'smiles': [
        "What is the SMILES string for {name}?",
        "Get the SMILES notation for {name}",
        "Find the SMILES for {name}",
        "Tell me the SMILES representation of {name}",
        "Show me the SMILES for molecule {name}",
        "What's the chemical structure (SMILES) of {name}?",
    ],
    'formula': [
        "What is the molecular formula of {name}?",
        "Get the chemical formula for {name}",
        "Find the molecular formula of {name}",
        "Tell me the formula of {name}",
        "What's the molecular formula for {name}?",
    ],
    'weight': [
        "What is the molecular weight of {name}?",
        "Get the molecular weight for {name}",
        "How much does {name} weigh (molecular weight)?",
        "Tell me the molecular weight of {name}",
        "What's the MW of {name}?",
    ],
    'properties': [
        "Get molecule data for {name}",
        "Tell me about molecule {name}",
        "Show me the properties of {name}",
        "What are the characteristics of {name}?",
        "Give me information about molecule {name}",
        "Describe molecule {name}",
    ],
    'inchi': [
        "What is the InChIKey for {name}?",
        "Get the InChIKey of {name}",
        "Find the InChIKey for molecule {name}",
        "Tell me the InChIKey of {name}",
    ],
    'chembl_id': [
        "What is the ChEMBL ID for {name}?",
        "Find molecule {name} ChEMBL ID",
        "Get the ChEMBL identifier for {name}",
        "Tell me the ChEMBL ID of {name}",
    ],
    'logp': [
        "What is the LogP of {name}?",
        "Get the lipophilicity (LogP) for {name}",
        "Tell me the LogP value of {name}",
        "How lipophilic is {name}?",
    ],
    'tpsa': [
        "What is the TPSA of {name}?",
        "Get the polar surface area for {name}",
        "Tell me the TPSA value of {name}",
        "What's the topological polar surface area of {name}?",
    ],
}

def generate_training_examples():
    """Generate diverse training examples"""
    examples = []
    
    for mol in molecules:
        name = mol.get('name', mol.get('chembl_id'))
        if not name:
            continue
        
        # SMILES examples
        if mol.get('smiles'):
            template = random.choice(PROMPT_TEMPLATES['smiles'])
            examples.append({
                "prompt": template.format(name=name),
                "response": f"The SMILES for {name} is {mol['smiles']}"
            })
        
        # Formula examples
        if mol.get('molecular_formula'):
            template = random.choice(PROMPT_TEMPLATES['formula'])
            examples.append({
                "prompt": template.format(name=name),
                "response": f"The molecular formula of {name} is {mol['molecular_formula']}"
            })
        
        # Weight examples
        if mol.get('molecular_weight'):
            template = random.choice(PROMPT_TEMPLATES['weight'])
            examples.append({
                "prompt": template.format(name=name),
                "response": f"The molecular weight of {name} is {mol['molecular_weight']:.2f} g/mol"
            })
        
        # Full properties example
        template = random.choice(PROMPT_TEMPLATES['properties'])
        props = {
            "chembl_id": mol.get('chembl_id'),
            "name": name,
            "molecular_formula": mol.get('molecular_formula'),
            "molecular_weight": mol.get('molecular_weight'),
            "smiles": mol.get('smiles'),
            "alogp": mol.get('alogp'),
            "polar_surface_area": mol.get('polar_surface_area'),
            "hba": mol.get('hba'),
            "hbd": mol.get('hbd'),
        }
        examples.append({
            "prompt": template.format(name=name),
            "response": json.dumps(props, indent=2)
        })
        
        # ChEMBL ID examples
        if mol.get('chembl_id'):
            template = random.choice(PROMPT_TEMPLATES['chembl_id'])
            examples.append({
                "prompt": template.format(name=name),
                "response": f"The ChEMBL ID for {name} is {mol['chembl_id']}"
            })
        
        # LogP examples
        if mol.get('alogp') is not None:
            template = random.choice(PROMPT_TEMPLATES['logp'])
            examples.append({
                "prompt": template.format(name=name),
                "response": f"The LogP (lipophilicity) of {name} is {mol['alogp']:.2f}"
            })
        
        # TPSA examples
        if mol.get('polar_surface_area') is not None:
            template = random.choice(PROMPT_TEMPLATES['tpsa'])
            examples.append({
                "prompt": template.format(name=name),
                "response": f"The TPSA (polar surface area) of {name} is {mol['polar_surface_area']:.2f} Ų"
            })
    
    # Add general chemistry questions
    general_examples = [
        {
            "prompt": "What is a SMILES string?",
            "response": "SMILES (Simplified Molecular Input Line Entry System) is a text notation for representing chemical structures using ASCII characters."
        },
        {
            "prompt": "What does LogP measure?",
            "response": "LogP measures lipophilicity, the partition coefficient between octanol and water. Higher values indicate more lipophilic (fat-soluble) molecules."
        },
        {
            "prompt": "What is TPSA?",
            "response": "TPSA (Topological Polar Surface Area) is the surface area of polar atoms in a molecule. It's used to predict drug absorption and membrane permeability."
        },
        {
            "prompt": "What are H-bond donors and acceptors?",
            "response": "H-bond donors (HBD) are atoms with hydrogen that can donate in hydrogen bonding. H-bond acceptors (HBA) are atoms that can accept hydrogen bonds. These affect drug-likeness."
        },
    ]
    
    examples.extend(general_examples)
    
    return examples

# Generate examples
examples = generate_training_examples()

# Shuffle
random.shuffle(examples)

print(f"Generated {len(examples)} training examples")

# Save to JSONL
output_path = Path(__file__).parent.parent / "training_data" / "molecules.jsonl"
output_path.parent.mkdir(exist_ok=True)

with open(output_path, 'w', encoding='utf-8') as f:
    for example in examples:
        f.write(json.dumps(example, ensure_ascii=False) + '\n')

print(f"✅ Saved all examples to {output_path}")

# Split into train/val/test and save separately
n = len(examples)
train_size = int(n * 0.8)
val_size = int(n * 0.1)

train_data = examples[:train_size]
val_data = examples[train_size:train_size + val_size]
test_data = examples[train_size + val_size:]

# Save splits
train_path = Path(__file__).parent.parent / "training_data" / "molecules_train.jsonl"
val_path = Path(__file__).parent.parent / "training_data" / "molecules_val.jsonl"
test_path = Path(__file__).parent.parent / "training_data" / "molecules_test.jsonl"

with open(train_path, 'w', encoding='utf-8') as f:
    for example in train_data:
        f.write(json.dumps(example, ensure_ascii=False) + '\n')

with open(val_path, 'w', encoding='utf-8') as f:
    for example in val_data:
        f.write(json.dumps(example, ensure_ascii=False) + '\n')

with open(test_path, 'w', encoding='utf-8') as f:
    for example in test_data:
        f.write(json.dumps(example, ensure_ascii=False) + '\n')

print(f"✅ Saved train split to {train_path} ({len(train_data)} examples)")
print(f"✅ Saved validation split to {val_path} ({len(val_data)} examples)")
print(f"✅ Saved test split to {test_path} ({len(test_data)} examples)")

# Print stats
print(f"\nDataset Statistics:")
print(f"  Total examples: {len(examples)}")
print(f"  Training (80%): {len(train_data)}")
print(f"  Validation (10%): {len(val_data)}")
print(f"  Test (10%): {len(test_data)}")

# Show sample
print(f"\n📋 Sample examples:")
for i, ex in enumerate(random.sample(examples, 3)):
    print(f"\nExample {i+1}:")
    print(f"  Prompt: {ex['prompt']}")
    print(f"  Response: {ex['response'][:100]}...")
