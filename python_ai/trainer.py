"""
Training pipeline for Advanced AI Models
Includes data loading, training loop, evaluation, and checkpointing
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from typing import List, Tuple, Dict, Optional
import os
from pathlib import Path
import json
from datetime import datetime
from tqdm import tqdm


class TextDataset(Dataset):
    """Dataset for training on text data"""
    
    def __init__(self, texts: List[str], tokenizer, max_length: int = 512):
        self.texts = texts
        self.tokenizer = tokenizer
        self.max_length = max_length
    
    def __len__(self) -> int:
        return len(self.texts)
    
    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        text = self.texts[idx]
        
        # Encode text
        input_ids = torch.tensor(
            self.tokenizer.encode(text, max_length=self.max_length),
            dtype=torch.long
        )
        
        # Create labels (shifted input for language modeling)
        labels = input_ids.clone()
        labels[:-1] = input_ids[1:]
        labels[-1] = self.tokenizer.word2idx['[END]']
        
        return {
            'input_ids': input_ids,
            'labels': labels,
        }


class Trainer:
    """Training manager for Advanced AI Models"""
    
    def __init__(
        self,
        model: nn.Module,
        tokenizer,
        device: str = 'cpu',
        learning_rate: float = 1e-4,
        num_epochs: int = 3,
        batch_size: int = 32,
        checkpoint_dir: str = './checkpoints',
        gradient_accumulation_steps: int = 1,
    ):
        self.model = model.to(device)
        self.tokenizer = tokenizer
        self.device = device
        self.learning_rate = learning_rate
        self.num_epochs = num_epochs
        self.batch_size = batch_size
        self.gradient_accumulation_steps = gradient_accumulation_steps
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(exist_ok=True)
        
        self.optimizer = optim.Adam(model.parameters(), lr=learning_rate)
        self.scheduler = optim.lr_scheduler.CosineAnnealingLR(self.optimizer, T_max=num_epochs)
        self.criterion = nn.CrossEntropyLoss(ignore_index=self.tokenizer.word2idx['[PAD]'])
        
        self.training_history = {
            'losses': [],
            'val_losses': [],
            'learning_rates': [],
        }
    
    def train_epoch(self, train_loader: DataLoader) -> float:
        """Train for one epoch"""
        self.model.train()
        total_loss = 0.0
        
        pbar = tqdm(train_loader, desc='Training', leave=False)
        for batch in pbar:
            input_ids = batch['input_ids'].to(self.device)
            labels = batch['labels'].to(self.device)
            
            # Forward pass
            self.optimizer.zero_grad()
            logits = self.model(input_ids)
            
            # Compute loss
            loss = self.criterion(
                logits.view(-1, logits.shape[-1]),
                labels.view(-1)
            )
            
            # Backward pass
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            self.optimizer.step()
            
            total_loss += loss.item()
            pbar.update(1)
        
        avg_loss = total_loss / len(train_loader)
        return avg_loss
    
    def validate(self, val_loader: DataLoader) -> float:
        """Validate model"""
        self.model.eval()
        total_loss = 0.0
        
        with torch.no_grad():
            for batch in tqdm(val_loader, desc='Validating', leave=False):
                input_ids = batch['input_ids'].to(self.device)
                labels = batch['labels'].to(self.device)
                
                logits = self.model(input_ids)
                loss = self.criterion(
                    logits.view(-1, logits.shape[-1]),
                    labels.view(-1)
                )
                
                total_loss += loss.item()
        
        avg_loss = total_loss / len(val_loader)
        return avg_loss
    
    def train(
        self,
        train_texts: List[str],
        val_texts: Optional[List[str]] = None,
        model_name: str = 'advanced_ai',
    ):
        """Full training pipeline"""
        # Create datasets
        train_dataset = TextDataset(train_texts, self.tokenizer, max_length=512)
        train_loader = DataLoader(train_dataset, batch_size=self.batch_size, shuffle=True)
        
        val_loader = None
        if val_texts:
            val_dataset = TextDataset(val_texts, self.tokenizer, max_length=512)
            val_loader = DataLoader(val_dataset, batch_size=self.batch_size, shuffle=False)
        
        best_val_loss = float('inf')
        
        print(f"\n🚀 Starting training: {model_name}")
        print(f"   Device: {self.device}")
        print(f"   Epochs: {self.num_epochs}")
        print(f"   Batch size: {self.batch_size}")
        print(f"   Train samples: {len(train_texts)}")
        if val_texts:
            print(f"   Val samples: {len(val_texts)}")
        print()
        
        for epoch in range(self.num_epochs):
            print(f"Epoch {epoch + 1}/{self.num_epochs}")
            
            # Train
            train_loss = self.train_epoch(train_loader)
            self.training_history['losses'].append(train_loss)
            self.training_history['learning_rates'].append(self.optimizer.param_groups[0]['lr'])
            
            print(f"  Train loss: {train_loss:.4f}")
            
            # Validate
            if val_loader:
                val_loss = self.validate(val_loader)
                self.training_history['val_losses'].append(val_loss)
                print(f"  Val loss: {val_loss:.4f}")
                
                # Save best model
                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    self.save_checkpoint(model_name, is_best=True)
                    print(f"  ✅ Best model saved!")
            else:
                # Save checkpoint at end of each epoch even without validation
                self.save_checkpoint(model_name, is_best=(epoch == self.num_epochs - 1))
                print(f"  ✅ Checkpoint saved!")
            
            self.scheduler.step()
        
        print(f"\n✨ Training completed!")
        print(f"   Final train loss: {train_loss:.4f}")
        if val_loader:
            print(f"   Best val loss: {best_val_loss:.4f}")
        
        return self.training_history
    
    def save_checkpoint(self, model_name: str = 'advanced_ai', is_best: bool = False):
        """Save model checkpoint"""
        checkpoint = {
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'scheduler_state_dict': self.scheduler.state_dict(),
            'config': self.model.config.__dict__,
            'history': self.training_history,
            'timestamp': datetime.now().isoformat(),
        }
        
        filename = f"{model_name}_best.pt" if is_best else f"{model_name}_latest.pt"
        filepath = self.checkpoint_dir / filename
        
        torch.save(checkpoint, filepath)
        print(f"  Checkpoint saved: {filepath}")
    
    def load_checkpoint(self, filepath: str):
        """Load model from checkpoint"""
        checkpoint = torch.load(filepath, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.scheduler.load_state_dict(checkpoint['scheduler_state_dict'])
        self.training_history = checkpoint['history']
        print(f"✅ Checkpoint loaded from: {filepath}")
