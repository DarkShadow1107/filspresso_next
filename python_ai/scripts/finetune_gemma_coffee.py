"""
Fine-tune Gemma 2B for coffee knowledge using RAG-augmented examples
"""

import json
import torch
from pathlib import Path
from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    BitsAndBytesConfig,
    TrainingArguments
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer
import sys

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))
from rag_retriever import CoffeeRAGRetriever

def generate_coffee_training_data(rag_dir: Path, output_file: Path):
    """
    Generate training examples from RAG chunks
    """
    # Load RAG retriever
    retriever = CoffeeRAGRetriever(rag_dir)
    
    # Define coffee-related topics and questions
    TOPICS = [
        # Basics
        "What is coffee?",
        "How is coffee made?",
        "What are coffee beans?",
        "Where does coffee come from?",
        
        # Brewing
        "How do you brew coffee?",
        "What are different brewing methods?",
        "What is espresso?",
        "How do you make espresso?",
        "What is pour over coffee?",
        "What is French press?",
        
        # Flavor
        "What affects coffee flavor?",
        "What is coffee acidity?",
        "What is coffee body?",
        "What makes coffee bitter?",
        "What makes coffee sweet?",
        
        # Types
        "What is Arabica coffee?",
        "What is Robusta coffee?",
        "What are coffee varieties?",
        "What is single origin coffee?",
        "What is a coffee blend?",
        
        # Processing
        "How is coffee processed?",
        "What is washed coffee?",
        "What is natural processed coffee?",
        "What is honey processed coffee?",
        
        # Roasting
        "What is coffee roasting?",
        "What is light roast coffee?",
        "What is dark roast coffee?",
        "What is medium roast coffee?",
        
        # Regions
        "Where is coffee grown?",
        "What is Ethiopian coffee?",
        "What is Colombian coffee?",
        "What is Brazilian coffee?",
        
        # Other
        "What is caffeine?",
        "How much caffeine is in coffee?",
        "What is decaf coffee?",
        "What is specialty coffee?",
    ]
    
    examples = []
    
    # For each topic, retrieve relevant context and create Q&A
    for topic in TOPICS:
        results = retriever.retrieve(topic, top_k=2)
        
        # Combine retrieved chunks
        context = "\n\n".join([r['text'] for r in results])
        
        # Create training example
        example = {
            'text': f"<start_of_turn>user\n{topic}<end_of_turn>\n<start_of_turn>model\n{context}<end_of_turn>"
        }
        examples.append(example)
    
    # Add general conversational examples
    CONVERSATIONAL = [
        {
            'question': "Hi! Can you help me with coffee?",
            'answer': "Hello! I'd be happy to help you with coffee. I'm knowledgeable about coffee varieties, brewing methods, flavor profiles, and more. What would you like to know?"
        },
        {
            'question': "I'm new to coffee. Where should I start?",
            'answer': "Welcome to the world of coffee! I'd recommend starting with a medium roast from a well-known origin like Colombia or Brazil. Try brewing it with a simple method like drip coffee or French press. Pay attention to the flavors you taste - do you like it sweet, acidic, or bold? This will help guide your coffee journey."
        },
        {
            'question': "What's the difference between light and dark roast?",
            'answer': "Light roast coffee is roasted for a shorter time, preserving more of the bean's original flavors - often fruity, floral, or tea-like notes with higher acidity. Dark roast is roasted longer, developing deeper, more roasted flavors like chocolate, caramel, and smoke, with lower acidity but more body. Neither is 'better' - it's about personal preference!"
        },
    ]
    
    for conv in CONVERSATIONAL:
        example = {
            'text': f"<start_of_turn>user\n{conv['question']}<end_of_turn>\n<start_of_turn>model\n{conv['answer']}<end_of_turn>"
        }
        examples.append(example)
    
    # Save to JSONL
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        for example in examples:
            f.write(json.dumps(example) + '\n')
    
    # Create train/val/test splits (80/10/10)
    import random
    random.seed(42)  # For reproducibility
    random.shuffle(examples)
    
    n = len(examples)
    train_size = int(n * 0.8)
    val_size = int(n * 0.1)
    
    train_data = examples[:train_size]
    val_data = examples[train_size:train_size + val_size]
    test_data = examples[train_size + val_size:]
    
    # Save splits
    train_file = output_file.parent / "coffee_train.jsonl"
    val_file = output_file.parent / "coffee_val.jsonl"
    test_file = output_file.parent / "coffee_test.jsonl"
    
    with open(train_file, 'w', encoding='utf-8') as f:
        for ex in train_data:
            f.write(json.dumps(ex) + '\n')
    
    with open(val_file, 'w', encoding='utf-8') as f:
        for ex in val_data:
            f.write(json.dumps(ex) + '\n')
    
    with open(test_file, 'w', encoding='utf-8') as f:
        for ex in test_data:
            f.write(json.dumps(ex) + '\n')
    
    print(f"✅ Generated {len(examples)} coffee training examples")
    print(f"   Saved all data to: {output_file}")
    print(f"   Training (80%): {len(train_data)} examples → {train_file}")
    print(f"   Validation (10%): {len(val_data)} examples → {val_file}")
    print(f"   Test (10%): {len(test_data)} examples → {test_file}")
    
    return examples

def main():
    # Paths
    base_dir = Path(__file__).parent.parent
    rag_dir = base_dir / "rag_data"
    training_file = base_dir / "training_data" / "coffee.jsonl"
    output_dir = base_dir / "models" / "gemma_v2"
    
    # Check if RAG data exists
    if not (rag_dir / "coffee_chunks.json").exists():
        print("❌ RAG data not found!")
        print("   Please run build_coffee_rag.py first")
        return
    
    # Generate training data
    print("Generating coffee training data from RAG chunks...")
    examples = generate_coffee_training_data(rag_dir, training_file)
    
    # Load training and validation data
    train_file = base_dir / "training_data" / "coffee_train.jsonl"
    val_file = base_dir / "training_data" / "coffee_val.jsonl"
    test_file = base_dir / "training_data" / "coffee_test.jsonl"
    
    with open(train_file, 'r', encoding='utf-8') as f:
        train_data = [json.loads(line) for line in f]
    
    with open(val_file, 'r', encoding='utf-8') as f:
        val_data = [json.loads(line) for line in f]
    
    # Create datasets
    train_dataset = Dataset.from_list(train_data)
    val_dataset = Dataset.from_list(val_data)
    
    print(f"\n📊 Datasets loaded:")
    print(f"   Training: {len(train_dataset)} examples")
    print(f"   Validation: {len(val_dataset)} examples")
    
    # Quantization config (4-bit)
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )
    
    # Load model
    print("\n🔧 Loading Gemma 2B model...")
    model = AutoModelForCausalLM.from_pretrained(
        "google/gemma-2b-it",
        quantization_config=bnb_config,
        device_map="auto",
    )
    
    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained("google/gemma-2b-it")
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    
    # Prepare model for k-bit training
    model = prepare_model_for_kbit_training(model)
    
    # LoRA config
    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    
    # Apply LoRA
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    
    # Training arguments
    training_args = TrainingArguments(
        output_dir=str(output_dir),
        num_train_epochs=3,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        fp16=True,
        save_strategy="epoch",
        evaluation_strategy="epoch",
        logging_steps=10,
        warmup_steps=50,
        optim="paged_adamw_8bit",
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        save_total_limit=2,
    )
    
    # Create trainer
    trainer = SFTTrainer(
        model=model,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        args=training_args,
        tokenizer=tokenizer,
        dataset_text_field="text",
        max_seq_length=512,
    )
    
    # Train
    print("\n🚀 Starting training...")
    trainer.train()
    
    # Evaluate on test set
    print("\n🧪 Evaluating on test set...")
    with open(test_file, 'r', encoding='utf-8') as f:
        test_data = [json.loads(line) for line in f]
    test_dataset = Dataset.from_list(test_data)
    test_results = trainer.evaluate(test_dataset)
    print(f"\n📊 Test Set Results:")
    print(f"   Test Loss: {test_results['eval_loss']:.4f}")
    print(f"   Test Samples: {len(test_dataset)}")
    
    # Save
    print("\n💾 Saving model...")
    trainer.save_model()
    tokenizer.save_pretrained(output_dir)
    
    print(f"\n✅ Training complete!")
    print(f"   Model saved to: {output_dir}")
    print("\n📝 Next steps:")
    print("   1. Update app.py to load gemma_v2 model")
    print("   2. Test coffee queries with RAG retrieval")

if __name__ == "__main__":
    main()
