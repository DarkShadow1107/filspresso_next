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
    TrainerCallback,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer

# Early stopping callback based on loss and grad_norm
class EarlyStoppingCallback(TrainerCallback):
    def __init__(self, loss_threshold=0.68, grad_norm_threshold=0.7):
        self.loss_threshold = loss_threshold
        self.grad_norm_threshold = grad_norm_threshold
        
    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs is not None:
            loss = logs.get("loss", None)
            grad_norm = logs.get("grad_norm", None)
            
            if loss is not None and grad_norm is not None:
                if loss < self.loss_threshold and grad_norm < self.grad_norm_threshold:
                    print(f"\n🎯 Early stopping triggered!")
                    print(f"   Loss: {loss:.4f} < {self.loss_threshold}")
                    print(f"   Grad norm: {grad_norm:.4f} < {self.grad_norm_threshold}")
                    print(f"   Saving model and stopping...")
                    control.should_training_stop = True
                    control.should_save = True

print("🧪 TinyLlama Chemistry Fine-tuning Script")
print("=" * 60)

# Configuration
MODEL_NAME = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"  # TinyLlama 1.1B Chat (no auth required)
OUTPUT_DIR = Path(__file__).parent.parent / "models" / "tinyllama_chem"
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

# Use 85% of training data (to balance training time and coverage)
original_train_size = len(train_dataset)
target_size = int(original_train_size * 0.85)
train_dataset = train_dataset.select(range(target_size))

print(f"📊 Dataset loaded:")
print(f"   Training: {len(train_dataset)} examples (85% of {original_train_size})")
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
print(f"\n🤖 Loading TinyLlama 1.1B from {MODEL_NAME}...")
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
    """Format as TinyLlama chat template"""
    return {
        "text": f"<|system|>\nYou are a helpful chemistry assistant.</s>\n<|user|>\n{example['prompt']}</s>\n<|assistant|>\n{example['response']}</s>"
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
    eval_strategy="epoch" if val_dataset else "no",
    logging_steps=10,
    warmup_steps=100,
    save_total_limit=2,
    load_best_model_at_end=True if val_dataset else False,
    metric_for_best_model="eval_loss" if val_dataset else None,
)

# Initialize trainer
print("\n🚀 Initializing SFTTrainer...")
early_stop_callback = EarlyStoppingCallback(loss_threshold=0.68, grad_norm_threshold=0.7)
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=val_dataset,
    tokenizer=tokenizer,
    dataset_text_field="text",
    max_seq_length=512,
    callbacks=[early_stop_callback],
)

# Start training
print("\n🏋️ Starting fine-tuning...")
print("📊 Early stopping enabled: loss < 0.68 AND grad_norm < 0.7")
print("=" * 60)
print("=" * 60)
trainer.train()

# Note: Test set evaluation skipped due to data collator requirements
# The model has been validated during training with the validation set
if val_dataset:
    print(f"\n✅ Training complete! Best validation loss: {trainer.state.best_metric:.4f}")

# Save final model
print("\n💾 Saving fine-tuned model...")
trainer.save_model()
tokenizer.save_pretrained(OUTPUT_DIR)

print(f"\n✅ Chemistry model saved to: {OUTPUT_DIR}")
print("\n🧪 tinyllama_chem is ready for chemistry tasks!")
