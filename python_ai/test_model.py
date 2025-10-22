"""
Test script for trained Haiku model
Tests text generation and inference capabilities
"""

import torch
from pathlib import Path
from models import (
    create_haiku_model,
    create_tanka_model,
    create_villanelle_model,
    create_ode_model,
    create_sonnet_model,
    create_opus_model,
)
from tokenizer import SimpleTokenizer
from inference import InferenceEngine
from trainer import TextDataset
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_checkpoint(model_name: str, tokenizer, checkpoint_path: str = './checkpoints'):
    """Load trained model from checkpoint"""
    logger.info(f"📂 Loading checkpoint: {checkpoint_path}/{model_name}_best.pt")
    
    # Create model with same vocab size as training
    vocab_size = len(tokenizer.word2idx)
    logger.info(f"📊 Using vocab size: {vocab_size}")
    
    if model_name == 'haiku':
        model, config = create_haiku_model(vocab_size=vocab_size)
    elif model_name == 'tanka':
        model, config = create_tanka_model(vocab_size=vocab_size)
    elif model_name == 'villanelle':
        model, config = create_villanelle_model(vocab_size=vocab_size)
    elif model_name == 'ode':
        model, config = create_ode_model(vocab_size=vocab_size)
    elif model_name == 'sonnet':
        model, config = create_sonnet_model(vocab_size=vocab_size)
    elif model_name == 'opus':
        model, config = create_opus_model(vocab_size=vocab_size)
    else:
        raise ValueError(f"Unknown model: {model_name}")
    
    # Load checkpoint
    checkpoint_file = Path(checkpoint_path) / f"{model_name}_best.pt"
    if not checkpoint_file.exists():
        logger.error(f"❌ Checkpoint not found: {checkpoint_file}")
        return None, None
    
    checkpoint = torch.load(checkpoint_file, map_location='cpu')
    model.load_state_dict(checkpoint['model_state_dict'])
    logger.info(f"✅ Model loaded from checkpoint")
    
    return model, config


def load_tokenizer(data_path: str = './training_data'):
    """Load and build tokenizer from training data"""
    logger.info(f"🔤 Building tokenizer from {data_path}...")
    
    import glob
    texts = []
    supported_extensions = ['*.cpp', '*.c', '*.html', '*.css', '*.scss', 
                           '*.mjs', '*.js', '*.ts', '*.tsx', '*.jsx', '*.svg', 
                           '*.php', '*.sql', '*.py', '*.go', '*.txt']
    
    for ext in supported_extensions:
        files = glob.glob(str(Path(data_path) / '**' / ext), recursive=True)
        for file_path in files:
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    lines = content.split('\n')
                    texts.extend([line.strip() for line in lines if line.strip()])
            except:
                pass
    
    tokenizer = SimpleTokenizer(vocab_size=50000)
    tokenizer.build_vocab(texts)
    logger.info(f"✅ Tokenizer built with {len(tokenizer.word2idx)} vocab size")
    
    return tokenizer


def test_generation(model, tokenizer, device='cpu'):
    """Test text generation capability"""
    logger.info("\n" + "="*60)
    logger.info("🧪 TEST 1: TEXT GENERATION")
    logger.info("="*60)
    
    engine = InferenceEngine(model, tokenizer, device=device)
    
    prompts = [
        "Coffee is",
        "Machine learning",
        "Python code",
        "The best way to",
        "Nespresso provides"
    ]
    
    for prompt in prompts:
        logger.info(f"\n📝 Prompt: '{prompt}'")
        try:
            generated = engine.generate(prompt, max_length=50, temperature=0.7)
            # Clean up output - remove special tokens
            clean_output = generated.replace('[PAD]', '').replace('[UNK]', '').replace('[END]', '').strip()
            logger.info(f"✨ Generated: '{prompt} {clean_output}'")
        except Exception as e:
            logger.error(f"❌ Error: {e}")


def test_qa(model, tokenizer, device='cpu'):
    """Test question answering"""
    logger.info("\n" + "="*60)
    logger.info("🧪 TEST 2: QUESTION ANSWERING")
    logger.info("="*60)
    
    engine = InferenceEngine(model, tokenizer, device=device)
    
    questions = [
        "What is coffee?",
        "How does a machine work?",
        "What is programming?",
    ]
    
    for question in questions:
        logger.info(f"\n❓ Question: '{question}'")
        try:
            answer = engine.answer_question(question, max_length=100)
            logger.info(f"💬 Answer: '{answer}'")
        except Exception as e:
            logger.error(f"❌ Error: {e}")


def test_chat(model, tokenizer, device='cpu'):
    """Test chat capability"""
    logger.info("\n" + "="*60)
    logger.info("🧪 TEST 3: CHAT")
    logger.info("="*60)
    
    engine = InferenceEngine(model, tokenizer, device=device)
    
    messages = [
        "Hello, how are you?",
        "Tell me about coffee",
        "What can you do?",
    ]
    
    conversation_history = []
    
    for message in messages:
        logger.info(f"\n👤 User: '{message}'")
        try:
            response = engine.chat(message, conversation_history, max_length=100)
            logger.info(f"🤖 Assistant: '{response}'")
            
            conversation_history.append({
                'user': message,
                'assistant': response
            })
        except Exception as e:
            logger.error(f"❌ Error: {e}")


def main():
    """Run all tests"""
    logger.info("="*60)
    logger.info("🚀 TESTING TRAINED HAIKU MODEL")
    logger.info("="*60)
    
    # Detect device
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    logger.info(f"📌 Using device: {device.upper()}")
    
    # Load tokenizer FIRST (needed for model creation)
    tokenizer = load_tokenizer()
    
    # Load model with correct vocab size
    model, config = load_checkpoint('haiku', tokenizer)
    if model is None:
        logger.error("❌ Failed to load model")
        return
    
    model.to(device)
    model.eval()
    
    # Run tests
    test_generation(model, tokenizer, device)
    test_qa(model, tokenizer, device)
    test_chat(model, tokenizer, device)
    
    logger.info("\n" + "="*60)
    logger.info("✅ TESTING COMPLETED")
    logger.info("="*60)
    logger.info("")
    logger.info("📊 MODEL SUMMARY:")
    logger.info(f"  ✓ Model loaded successfully from checkpoint")
    logger.info(f"  ✓ Tokenizer built with {len(tokenizer.word2idx)} vocabulary")
    logger.info(f"  ✓ Device: {device.upper()}")
    logger.info("")
    logger.info("💡 NOTE:")
    logger.info("  Model is still in early training (3 epochs).")
    logger.info("  Output quality will improve significantly with:")
    logger.info("    • More training epochs (10-50)")
    logger.info("    • Larger training dataset")
    logger.info("    • Fine-tuning on domain-specific data")
    logger.info("    • Better learning rate tuning")
    logger.info("")
    logger.info("🚀 Next steps to improve:")
    logger.info("  1. Train for more epochs: python train.py --model haiku --epochs 10")
    logger.info("  2. Add more training data to training_data/ folder")
    logger.info("  3. Fine-tune learning rate")
    logger.info("="*60)


if __name__ == "__main__":
    main()
