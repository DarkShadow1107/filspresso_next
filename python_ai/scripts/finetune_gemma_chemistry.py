"""
Fine-tune Gemma 2B for chemistry/molecule tasks using LoRA
Uses PEFT, bitsandbytes for quantization, and TRL's SFTTrainer
"""

import json
import torch
from pathlib import Path
from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    BitsAndBytesConfig,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer

print("🧪 Gemma Chemistry Fine-tuning Script")
print("=" * 60)

# Configuration
MODEL_NAME = "google/gemma-2b-it"  # Gemma 2B Instruction-tuned
OUTPUT_DIR = Path(__file__).parent.parent / "models" / "gemma_chem"
TRAIN_PATH = Path(__file__).parent.parent / "training_data" / "molecules_train.jsonl"
VAL_PATH = Path(__file__).parent.parent / "training_data" / "molecules_val.jsonl"
TEST_PATH = Path(__file__).parent.parent / "training_data" / "molecules_test.jsonl"

# Check if data exists
if not TRAIN_PATH.exists():
    print(f"❌ Error: Training data not found at {TRAIN_PATH}")
    print("   Run generate_molecule_training_data.py first!")
    exit(1)

print(f"📁 Loading training data from: {TRAIN_PATH}")
print(f"📁 Loading validation data from: {VAL_PATH}")

# Load and prepare dataset
def load_jsonl(path):
    """Load JSONL file into Dataset"""
    examples = []
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            examples.append(json.loads(line))
    return Dataset.from_list(examples)

train_dataset = load_jsonl(TRAIN_PATH)
val_dataset = load_jsonl(VAL_PATH) if VAL_PATH.exists() else None

print(f"📊 Dataset loaded:")
print(f"   Training: {len(train_dataset)} examples")
if val_dataset:
    print(f"   Validation: {len(val_dataset)} examples")

# Quantization config (4-bit for lower memory)
print("\n⚙️ Setting up 4-bit quantization...")
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_use_double_quant=True,
)

# Load model and tokenizer
print(f"\n🤖 Loading Gemma 2B from {MODEL_NAME}...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(
    MODEL_NAME,
    quantization_config=bnb_config,
    device_map="auto",
    trust_remote_code=True,
)

# Prepare model for training
model = prepare_model_for_kbit_training(model)

# LoRA configuration
print("\n🔧 Applying LoRA adapters...")
lora_config = LoraConfig(
    r=16,  # LoRA rank
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)

model = get_peft_model(model, lora_config)
print(f"✅ Trainable parameters: {model.print_trainable_parameters()}")

# Format dataset for instruction tuning
def format_instruction(example):
    """Format as Gemma instruction template"""
    return {
        "text": f"<start_of_turn>user\n{example['prompt']}<end_of_turn>\n<start_of_turn>model\n{example['response']}<end_of_turn>"
    }

train_dataset = train_dataset.map(format_instruction)
val_dataset = val_dataset.map(format_instruction)

# Training arguments
print("\n📝 Setting up training configuration...")
training_args = TrainingArguments(
    output_dir=str(OUTPUT_DIR),
    num_train_epochs=3,
    per_device_train_batch_size=2,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    fp16=True,
    save_strategy="epoch",
    evaluation_strategy="epoch",
    logging_steps=10,
    warmup_steps=100,
    save_total_limit=2,
    load_best_model_at_end=True,
)

# Initialize trainer
print("\n🚀 Initializing SFTTrainer...")
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=val_dataset,
    tokenizer=tokenizer,
    dataset_text_field="text",
    max_seq_length=512,
)

# Start training
print("\n🏋️ Starting fine-tuning...")
print("=" * 60)
trainer.train()

# Evaluate on test set if available
if TEST_PATH.exists():
    print("\n🧪 Evaluating on test set...")
    test_dataset = load_jsonl(TEST_PATH)
    test_dataset = test_dataset.map(format_instruction)
    test_results = trainer.evaluate(test_dataset)
    print(f"\n📊 Test Set Results:")
    print(f"   Test Loss: {test_results['eval_loss']:.4f}")
    print(f"   Test Samples: {len(test_dataset)}")

# Save final model
print("\n💾 Saving fine-tuned model...")
trainer.save_model()
tokenizer.save_pretrained(OUTPUT_DIR)

print(f"\n✅ Chemistry model saved to: {OUTPUT_DIR}")
print("\n🧪 gemma_chem is ready for chemistry tasks!")
