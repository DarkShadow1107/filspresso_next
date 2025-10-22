"""
Advanced Training Script: Resume, Retrain, and Continue Training
Support for multi-session training with checkpoints
- Resume from checkpoint (continue where you left off)
- Retrain on new datasets
- Accumulate training across multiple sessions
"""

import torch
import torch.nn as nn
import argparse
from pathlib import Path
from models import (
    create_haiku_model,
    create_tanka_model,
    create_villanelle_model,
    create_ode_model,
    create_sonnet_model,
    create_opus_model,
    format_parameter_count,
)
from tokenizer import SimpleTokenizer
from trainer import Trainer, TextDataset
from torch.utils.data import DataLoader
import logging
import glob
import json
from datetime import datetime

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
        # Directory with multiple files
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
                        lines = content.split('\n')
                        texts.extend([line.strip() for line in lines if line.strip()])
                except Exception as e:
                    logger.warning(f"⚠️  Error reading {file_path}: {e}")
        
        logger.info(f"✅ Loaded {len(texts)} total samples from directory {data_path}")
        return texts
    else:
        logger.error(f"❌ Path not found: {data_path}")
        return []


def list_available_checkpoints(checkpoint_dir: str = './checkpoints'):
    """List available checkpoints to resume from"""
    checkpoint_path = Path(checkpoint_dir)
    if not checkpoint_path.exists():
        logger.info("❌ No checkpoints directory found")
        return []
    
    best_checkpoints = sorted(checkpoint_path.glob('*_best.pt'))
    latest_checkpoints = sorted(checkpoint_path.glob('*_latest.pt'))
    
    if best_checkpoints:
        logger.info("\n📦 Available BEST checkpoints (completed training runs):")
        for i, cp in enumerate(best_checkpoints, 1):
            logger.info(f"   {i}. {cp.name}")
    
    if latest_checkpoints:
        logger.info("\n📦 Available LATEST checkpoints (recent runs):")
        for i, cp in enumerate(latest_checkpoints, 1):
            logger.info(f"   {i}. {cp.name}")
    
    return best_checkpoints + latest_checkpoints


def load_checkpoint_with_model(checkpoint_path: str, device: str = 'cuda'):
    """Load checkpoint and create matching model"""
    logger.info(f"\n🔄 Loading checkpoint: {checkpoint_path}")
    
    checkpoint = torch.load(checkpoint_path, map_location=device)
    config_dict = checkpoint['config']
    
    # Recreate config object
    from models import ModelConfig
    config = ModelConfig(**config_dict)
    
    logger.info(f"✅ Checkpoint config loaded:")
    logger.info(f"   - Vocab size: {config.vocab_size}")
    logger.info(f"   - Hidden size: {config.hidden_size}")
    logger.info(f"   - Layers: {config.num_layers}")
    logger.info(f"   - Heads: {config.num_heads}")
    
    # Determine model type from checkpoint path
    checkpoint_name = Path(checkpoint_path).stem
    if 'haiku' in checkpoint_name:
        model, _ = create_haiku_model(vocab_size=config.vocab_size)
        model_type = 'haiku'
    elif 'tanka' in checkpoint_name:
        model, _ = create_tanka_model(vocab_size=config.vocab_size)
        model_type = 'tanka'
    elif 'villanelle' in checkpoint_name:
        model, _ = create_villanelle_model(vocab_size=config.vocab_size)
        model_type = 'villanelle'
    elif 'ode' in checkpoint_name:
        model, _ = create_ode_model(vocab_size=config.vocab_size)
        model_type = 'ode'
    elif 'sonnet' in checkpoint_name:
        model, _ = create_sonnet_model(vocab_size=config.vocab_size)
        model_type = 'sonnet'
    elif 'opus' in checkpoint_name:
        model, _ = create_opus_model(vocab_size=config.vocab_size)
        model_type = 'opus'
    else:
        # Fallback to Haiku if unknown
        model, _ = create_haiku_model(vocab_size=config.vocab_size)
        model_type = 'haiku'
    
    # Load state
    model.load_state_dict(checkpoint['model_state_dict'])
    model.to(device)
    
    history = checkpoint.get('history', {'losses': [], 'val_losses': [], 'learning_rates': []})
    total_epochs_trained = len(history['losses'])
    
    logger.info(f"\n📊 Training history from checkpoint:")
    logger.info(f"   - Total epochs trained: {total_epochs_trained}")
    logger.info(f"   - Best loss: {min(history['losses']):.4f}" if history['losses'] else "   - No training yet")
    logger.info(f"   - Latest loss: {history['losses'][-1]:.4f}" if history['losses'] else "   - No training yet")
    
    return model, config, history, model_type, total_epochs_trained


def select_model_interactive():
    """Interactive model selection menu"""
    print("\n" + "="*60)
    print("🤖 SELECT MODEL TO TRAIN")
    print("="*60)
    print("1️⃣  HAIKU         (45-55M)  - Fast inference, good quality")
    print("2️⃣  TANKA (Kafelot) (≈30M)  - Lightweight, coffee-specialist")
    print("3️⃣  VILLANELLE (Kafelot) (≈60M) - Balanced small model")
    print("4️⃣  ODE (Kafelot)      (≈90M) - Mid-sized, higher reasoning")
    print("5️⃣  SONNET       (200M) - Balanced performance")
    print("6️⃣  OPUS         (520M) - Maximum capability")
    print("="*60)
    
    while True:
        choice = input("\nEnter model number (1-6) or press Enter for Haiku (1): ").strip()

        if choice == '' or choice == '1':
            return 'haiku'
        elif choice == '2':
            return 'tanka'
        elif choice == '3':
            return 'villanelle'
        elif choice == '4':
            return 'ode'
        elif choice == '5':
            return 'sonnet'
        elif choice == '6':
            return 'opus'
        else:
            print("❌ Invalid choice. Please enter 1-6.")


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


def train_or_resume(
    resume_checkpoint: str = None,
    model_name: str = 'haiku',
    data_path: str = None,
    num_epochs: int = 3,
    batch_size: int = None,
    learning_rate: float = 5e-5,
    save_path: str = './checkpoints',
):
    """Train new model or resume from checkpoint"""
    
    # Setup device
    if torch.cuda.is_available():
        device = 'cuda'
        logger.info(f"🚀 GPU Available: {torch.cuda.get_device_name(0)}")
        logger.info(f"💾 GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    else:
        device = 'cpu'
        logger.warning("⚠️ GPU not available, using CPU (training will be slow)")
    
    logger.info(f"📌 Using device: {device.upper()}")
    logger.info("")
    
    # Load or resume
    if resume_checkpoint:
        logger.info("="*60)
        logger.info("📂 RESUMING FROM CHECKPOINT")
        logger.info("="*60)
        
        model, config, history, model_name, total_epochs_trained = load_checkpoint_with_model(
            resume_checkpoint, device
        )
        
        # Build tokenizer from checkpoint (or load from training data)
        logger.info(f"\n🔤 Rebuilding tokenizer (vocab_size={config.vocab_size})...")
        tokenizer = SimpleTokenizer(vocab_size=config.vocab_size)
        
        # Need to load data to rebuild vocab
        if not data_path:
            data_path = './training_data'
        
        texts = load_training_data(data_path)
        if texts:
            tokenizer.build_vocab(texts)
            logger.info(f"✅ Tokenizer vocab size: {len(tokenizer.word2idx)}")
        else:
            logger.error("❌ No training data to rebuild tokenizer")
            return
        
        logger.info(f"\n📊 Resuming training on model with {total_epochs_trained} prior epochs")
        
    else:
        logger.info("="*60)
        logger.info("🆕 TRAINING NEW MODEL")
        logger.info("="*60)
        
        # Load data
        if not data_path:
            data_path = './training_data'
        
        texts = load_training_data(data_path)
        if not texts:
            logger.error("❌ No training data loaded")
            return
        
        # Initialize tokenizer
        logger.info(f"\n🔤 Building tokenizer vocabulary...")
        tokenizer = SimpleTokenizer(vocab_size=50000)
        tokenizer.build_vocab(texts)
        logger.info(f"✅ Tokenizer vocab size: {len(tokenizer.word2idx)}")
        
        # Create model
        logger.info(f"\n🏗️  Building {model_name.upper()} model architecture...")
        if model_name == 'haiku':
            model, config = create_haiku_model(vocab_size=len(tokenizer.word2idx))
            config.max_seq_length = 256
        elif model_name == 'sonnet':
            model, config = create_sonnet_model(vocab_size=len(tokenizer.word2idx))
            config.max_seq_length = 128
        elif model_name == 'opus':
            model, config = create_opus_model(vocab_size=len(tokenizer.word2idx))
            config.max_seq_length = 64
        else:
            logger.error(f"❌ Unknown model: {model_name}")
            return
        
        model.to(device)
        history = {'losses': [], 'val_losses': [], 'learning_rates': []}
        total_epochs_trained = 0
    
    # Set batch size
    if batch_size is None:
        if model_name == 'haiku':
            batch_size = 16
        elif model_name == 'sonnet':
            batch_size = 4
        elif model_name == 'opus':
            batch_size = 2
        else:
            batch_size = 8
    
    logger.info(f"\n📊 Model parameters:")
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    logger.info(f"   - Total: {total_params:,} ({format_parameter_count(total_params)})")
    logger.info(f"   - Trainable: {trainable_params:,} ({format_parameter_count(trainable_params)})")
    
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
    
    # Restore training history
    trainer.training_history = history
    
    # Train
    try:
        logger.info("\n" + "="*60)
        logger.info(f"🚀 STARTING TRAINING SESSION")
        logger.info("="*60)
        logger.info(f"  Model: {model_name.upper()}")
        logger.info(f"  New epochs to train: {num_epochs}")
        logger.info(f"  Total epochs (including prior): {total_epochs_trained + num_epochs}")
        logger.info(f"  Batch size: {batch_size}")
        logger.info(f"  Learning rate: {learning_rate}")
        logger.info(f"  Device: {device.upper()}")
        logger.info("="*60 + "\n")
        
        history = trainer.train(
            train_texts=texts,
            model_name=model_name,
        )
        
        logger.info("")
        logger.info("="*60)
        logger.info(f"✅ TRAINING SESSION COMPLETED")
        logger.info("="*60)
        logger.info(f"  Model: {model_name.upper()}")
        logger.info(f"  Epochs in this session: {num_epochs}")
        logger.info(f"  Total epochs trained: {total_epochs_trained + num_epochs}")
        logger.info(f"  Final loss: {history['losses'][-1]:.4f}")
        logger.info(f"  Best loss ever: {min(history['losses']):.4f}")
        logger.info(f"  Checkpoints saved to: {save_path}")
        logger.info("")
        logger.info("💾 Model persistence:")
        logger.info(f"  ✅ Best model: checkpoints/{model_name}_best.pt")
        logger.info(f"  ✅ Latest model: checkpoints/{model_name}_latest.pt")
        logger.info(f"  ✅ To resume: use --resume checkpoints/{model_name}_best.pt")
        logger.info("="*60)
        
    except RuntimeError as e:
        if "out of memory" in str(e):
            logger.error("")
            logger.error("="*60)
            logger.error("❌ OUT OF MEMORY (OOM)")
            logger.error("="*60)
            logger.error("Solutions:")
            logger.error("  1. Reduce --batch-size (try 4, 2, or 1)")
            logger.error("  2. Use smaller model (haiku instead of sonnet)")
            logger.error("  3. Reduce --epochs")
            logger.error("="*60)
        else:
            raise
    except KeyboardInterrupt:
        logger.info("")
        logger.info("="*60)
        logger.info("⏹️  TRAINING INTERRUPTED")
        logger.info("="*60)
        logger.info("✅ Checkpoints saved - training can be resumed")
        logger.info(f"📌 Resume command: python train_advanced.py --resume checkpoints/{model_name}_best.pt")
        logger.info("="*60)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Advanced Training: New Model or Resume from Checkpoint',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Train new Haiku model for 3 epochs
  python train_advanced.py --model haiku --epochs 3
  
  # Resume Haiku training for 5 more epochs
  python train_advanced.py --resume checkpoints/haiku_best.pt --epochs 5
  
  # Resume Sonnet training with new dataset for 10 epochs
  python train_advanced.py --resume checkpoints/sonnet_best.pt --data ./new_training_data --epochs 10
  
  # List available checkpoints
  python train_advanced.py --list-checkpoints
        """
    )
    
    parser.add_argument('--model', choices=['haiku', 'sonnet', 'opus'], default=None,
                        help='Model to train (for new training)')
    parser.add_argument('--resume', type=str, default=None,
                        help='Resume from checkpoint (e.g., checkpoints/haiku_best.pt)')
    parser.add_argument('--data', type=str, default=None,
                        help='Path to training data (file or directory). Default: ./training_data')
    parser.add_argument('--epochs', type=int, default=3,
                        help='Number of epochs to train (default: 3)')
    parser.add_argument('--batch-size', type=int, default=None,
                        help='Batch size (auto-selected by model if not specified)')
    parser.add_argument('--lr', type=float, default=5e-5,
                        help='Learning rate (default: 5e-5)')
    parser.add_argument('--save-path', default='./checkpoints',
                        help='Path to save checkpoints')
    parser.add_argument('--list-checkpoints', action='store_true',
                        help='List available checkpoints and exit')
    
    args = parser.parse_args()
    
    # List checkpoints and exit
    if args.list_checkpoints:
        logger.info("🔍 Available checkpoints:\n")
        list_available_checkpoints(args.save_path)
        exit(0)
    
    print("")
    display_gpu_info()
    print("")
    
    # Resume from checkpoint
    if args.resume:
        train_or_resume(
            resume_checkpoint=args.resume,
            data_path=args.data,
            num_epochs=args.epochs,
            batch_size=args.batch_size,
            learning_rate=args.lr,
            save_path=args.save_path,
        )
    else:
        # New training
        if args.model is None:
            model_name = select_model_interactive()
        else:
            model_name = args.model
        
        train_or_resume(
            model_name=model_name,
            data_path=args.data,
            num_epochs=args.epochs,
            batch_size=args.batch_size,
            learning_rate=args.lr,
            save_path=args.save_path,
        )
