"""
Training script for Advanced AI Models
Quick start for training on custom data
GPU-optimized for NVIDIA GPUs with fallback to CPU
"""

import torch
import argparse
from typing import Optional
from pathlib import Path
from models import (
    create_tanka_model,
    create_villanelle_model,
    create_ode_model,
    format_parameter_count,
)
from tokenizer import SimpleTokenizer
from trainer import Trainer
import logging
import glob
import sys

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_training_data(data_path: str):
    """Load training data from a file or directory"""
    
    if Path(data_path).is_file():
        # Single file
        with open(data_path, 'r', encoding='utf-8', errors='ignore') as f:
            texts = f.readlines()
        logger.info(f"✅ Loaded {len(texts)} samples from {data_path}")
        return texts
    
    elif Path(data_path).is_dir():
        # Directory with multiple files - now with .js support
        texts = []
        supported_extensions = ['*.cpp', '*.c', '*.html', '*.css', '*.scss', 
                               '*.mjs', '*.js', '*.ts', '*.tsx', '*.jsx', '*.svg', 
                               '*.php', '*.sql', '*.py', '*.go', '*.txt']
        
        logger.info(f"📁 Scanning directory: {data_path}")
        for ext in supported_extensions:
            files = glob.glob(str(Path(data_path) / '**' / ext), recursive=True)
            if files:
                logger.info(f"  Found {len(files)} {ext} files")
            
            for file_path in files:
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        # Split by lines
                        lines = content.split('\n')
                        texts.extend([line.strip() for line in lines if line.strip()])
                except Exception as e:
                    logger.warning(f"⚠️  Error reading {file_path}: {e}")
        
        logger.info(f"✅ Loaded {len(texts)} total samples from directory {data_path}")
        return texts
    else:
        logger.error(f"❌ Path not found: {data_path}")
        return []


def select_model_interactive():
    """Interactive model selection menu"""
    print("\n" + "="*60)
    print("🤖 SELECT KAFELOT COFFEE MODEL TO TRAIN")
    print("="*60)
    print("1️⃣  TANKA        (~30M)  - Lightweight, conversational")
    print("2️⃣  VILLANELLE   (~60M)  - Balanced, technical depth")
    print("3️⃣  ODE          (~90M)  - Comprehensive, research-grade")
    print("="*60)
    
    while True:
        choice = input("\nEnter model number (1-3) or press Enter for Tanka (1): ").strip()

        if choice == '' or choice == '1':
            return 'tanka'
        elif choice == '2':
            return 'villanelle'
        elif choice == '3':
            return 'ode'
        else:
            print("❌ Invalid choice. Please enter 1, 2, or 3.")


def display_gpu_info():
    """Display GPU information"""
    if torch.cuda.is_available():
        device_name = torch.cuda.get_device_name(0)
        memory_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
        print(f"✅ GPU DETECTED: {device_name} ({memory_gb:.2f} GB VRAM)")
        return 'cuda'
    else:
        print("⚠️  GPU NOT DETECTED - Using CPU (training will be slow)")
        return 'cpu'


def train_model(
    model_name: str = 'tanka',
    data_path: str = None,
    num_epochs: int = 3,
    batch_size: int = 8,
    learning_rate: float = 5e-5,
    save_path: str = './checkpoints',
    device_override: Optional[str] = None,
    resume_checkpoint: Optional[str] = None,
    vocab_size: Optional[int] = None,
):
    """Train a model with GPU support
    
    What happens during training:
    1. Model architecture is created in RAM (random weights initially)
    2. Training loop reads data and updates weights
    3. Best model is saved to disk as .pt file in checkpoints/
    4. If training stops, in-memory model is lost but .pt file remains
    5. You can reload saved .pt file anytime to resume training or use for inference
    """
    
    # Setup device - use override if provided; otherwise GPU if available
    if device_override is not None:
        device = device_override.lower()
        if device == 'cuda' and not torch.cuda.is_available():
            logger.warning("⚠️ --device=cuda requested but CUDA not available. Falling back to CPU.")
            device = 'cpu'
    else:
        device = 'cuda' if torch.cuda.is_available() else 'cpu'

    if device == 'cuda':
        logger.info(f"🚀 GPU Selected: {torch.cuda.get_device_name(0)}")
        logger.info(f"💾 GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
        # Enable memory efficient attention
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    else:
        logger.warning("⚠️ Using CPU for training (this will be slow)")
    
    logger.info(f"📌 Using device: {device.upper()}")
    logger.info("")
    
    # Load training data
    if not data_path:
        logger.error("❌ data_path is required")
        return
    
    texts = load_training_data(data_path)
    
    if not texts:
        logger.error("❌ No training data loaded")
        return
    
    logger.info(f"📊 Loaded {len(texts)} training samples")
    logger.info("")
    
    # Initialize tokenizer
    logger.info("🔤 Building tokenizer vocabulary...")
    # If a vocab_size is forced via CLI, pass it to the tokenizer so both tokenizer and
    # model embedding size remain consistent. Otherwise tokenizer uses its default.
    tokenizer_init_vocab = vocab_size if vocab_size is not None else 50000
    tokenizer = SimpleTokenizer(vocab_size=tokenizer_init_vocab)
    tokenizer.build_vocab(texts)
    # Determine the actual vocab size that will be used for the embedding matrix
    used_vocab_size = vocab_size if vocab_size is not None else len(tokenizer.word2idx)
    logger.info(f"✅ Tokenizer vocab size (used for model embedding): {used_vocab_size}")
    logger.info("")
    
    # Create model with memory-efficient settings
    logger.info("🏗️  Building model architecture...")
    if model_name == 'tanka':
        model, config = create_tanka_model(vocab_size=used_vocab_size)
        config.max_seq_length = 256
        logger.info("✨ Kafelot Tanka Model initialized in RAM")
    elif model_name == 'villanelle':
        model, config = create_villanelle_model(vocab_size=used_vocab_size)
        config.max_seq_length = 256
        logger.info("✨ Kafelot Villanelle Model initialized in RAM")
    elif model_name == 'ode':
        model, config = create_ode_model(vocab_size=used_vocab_size)
        config.max_seq_length = 512
        logger.info("✨ Kafelot Ode Model initialized in RAM")
    else:
        logger.error(f"❌ Unknown model: {model_name}")
        return

    # Resume from checkpoint if provided
    if resume_checkpoint is not None and Path(resume_checkpoint).is_file():
        try:
            logger.info(f"🔄 Loading checkpoint from {resume_checkpoint} ...")
            checkpoint = torch.load(resume_checkpoint, map_location=device)
            if 'model_state_dict' in checkpoint:
                model.load_state_dict(checkpoint['model_state_dict'])
            else:
                model.load_state_dict(checkpoint)
            logger.info("✅ Model weights loaded from checkpoint.")
        except Exception as e:
            logger.error(f"❌ Failed to load checkpoint: {e}")
            return
    else:
        if resume_checkpoint:
            logger.warning(f"⚠️ Checkpoint file not found: {resume_checkpoint}. Starting from scratch.")

    logger.info("")
    logger.info("📍 What just happened:")
    logger.info("  - Model architecture created in RAM (random weights or loaded from checkpoint)")
    logger.info("  - NOT saved to disk yet - only exists in memory")
    logger.info("  - During training, best weights will be saved to checkpoints/")
    logger.info("")

    # Move model to device
    model.to(device)
    logger.info(f"� Model loaded to {device.upper()}")

    # Count parameters
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    formatted_total = format_parameter_count(total_params)
    formatted_trainable = format_parameter_count(trainable_params)
    logger.info(f"📈 Total parameters: {total_params:,} ({formatted_total})")
    logger.info(f"🔧 Trainable parameters: {trainable_params:,} ({formatted_trainable})")
    logger.info("")
    
    # Create trainer
    trainer = Trainer(
        model=model,
        tokenizer=tokenizer,
        device=device,
        learning_rate=learning_rate,
        num_epochs=num_epochs,
        batch_size=batch_size,
        checkpoint_dir=save_path,
        gradient_accumulation_steps=1,
    )
    
    # Train
    try:
        logger.info("="*60)
        logger.info(f"🚀 STARTING TRAINING")
        logger.info("="*60)
        logger.info(f"  Device: {device.upper()}")
        logger.info(f"  Model: {model_name.upper()}")
        logger.info(f"  Epochs: {num_epochs}")
        logger.info(f"  Batch size: {batch_size}")
        logger.info(f"  Learning rate: {learning_rate}")
        logger.info(f"  Training samples: {len(texts)}")
        logger.info("="*60)
        logger.info("")
        
        history = trainer.train(
            train_texts=texts,
            model_name=model_name,
        )
        
        logger.info("")
        logger.info("="*60)
        logger.info(f"✅ TRAINING COMPLETED")
        logger.info("="*60)
        logger.info(f"  Model: {model_name.upper()}")
        logger.info(f"  Final loss: {history['losses'][-1]:.4f}")
        logger.info(f"  Checkpoints: {save_path}")
        logger.info("")
        logger.info("� Model persistence:")
        logger.info("  ✅ Best model saved to disk: checkpoints/{model}_best.pt")
        logger.info("  ✅ If training/server stops, saved .pt file remains")
        logger.info("  ✅ You can reload and resume training anytime")
        logger.info("="*60)
        
    except RuntimeError as e:
        if "out of memory" in str(e):
            logger.error("")
            logger.error("="*60)
            logger.error("❌ OUT OF MEMORY (OOM)")
            logger.error("="*60)
            logger.error("OOM = Your GPU/CPU ran out of RAM")
            logger.error("")
            logger.error("Solutions:")
            logger.error("  1. Reduce --batch-size (try 4, 2, or 1)")
            logger.error("  2. Use smaller model (tanka instead of ode)")
            logger.error("  3. Reduce --epochs")
            logger.error("  4. Close other GPU-using programs")
            logger.error("="*60)
        else:
            raise
    except KeyboardInterrupt:
        logger.info("")
        logger.info("="*60)
        logger.info("⏹️  TRAINING INTERRUPTED")
        logger.info("="*60)
        logger.info("✅ Best checkpoint saved to disk")
        logger.info("📌 In-memory model lost, but .pt file remains")
        logger.info("💡 Resume training: Run the same command again")
        logger.info("="*60)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Train Kafelot Coffee AI Models', add_help=True)
    parser.add_argument('--model', choices=['tanka', 'villanelle', 'ode'], default=None,
                        help='Model to train (tanka, villanelle, or ode). If not specified, interactive menu appears')
    parser.add_argument('--data', default=None,
                        help='Path to training data (file or directory). Default: ./training_data')
    parser.add_argument('--epochs', type=int, default=3, help='Number of epochs (default: 3)')
    parser.add_argument('--batch-size', type=int, default=None, help='Batch size (auto-selected by model if not specified)')
    parser.add_argument('--lr', type=float, default=5e-6, help='Learning rate (default: 5e-6)')
    parser.add_argument('--save-path', default='./checkpoints', help='Path to save checkpoints')
    parser.add_argument('--device', choices=['cuda', 'cpu'], default=None, help='Force device: cuda or cpu (default: auto-detect)')
    parser.add_argument('--resume', default=None, help='Path to checkpoint to resume training from')
    parser.add_argument('--vocab-size', type=int, default=None, help='Force vocabulary size for tokenizer and embedding (e.g., 30000)')

    args = parser.parse_args()

    # Set default data path to training_data folder
    data_path = args.data if args.data else './training_data'

    # Interactive model selection if not specified
    if args.model is None:
        model_name = select_model_interactive()
    else:
        model_name = args.model

    # Set model-specific batch size if not provided
    if args.batch_size is None:
        if model_name in ('tanka', 'villanelle'):
            batch_size = 16
        elif model_name == 'ode':
            batch_size = 8
        else:
            batch_size = 8   # Fallback
    else:
        batch_size = args.batch_size

    # Display GPU info
    print("")
    display_gpu_info()
    print("")

    train_model(
        model_name=model_name,
        data_path=data_path,
        num_epochs=args.epochs,
        batch_size=batch_size,
        learning_rate=args.lr,
        save_path=args.save_path,
        device_override=args.device,
        resume_checkpoint=args.resume,
        vocab_size=args.vocab_size,
    )
