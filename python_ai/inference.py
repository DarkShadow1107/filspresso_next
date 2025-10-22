"""
Inference engine for Advanced AI Models
Handles text generation and response generation
"""

import torch
import torch.nn.functional as F
from typing import List, Dict, Optional, Tuple
import numpy as np


class InferenceEngine:
    """Handles inference for Advanced AI Models"""
    
    def __init__(self, model, tokenizer, device: str = 'cpu'):
        self.model = model.to(device)
        self.tokenizer = tokenizer
        self.device = device
        self.model.eval()
    
    def generate(
        self,
        prompt: str,
        max_length: int = 256,
        temperature: float = 0.7,
        top_k: int = 50,
        top_p: float = 0.9,
        num_beams: int = 1,
    ) -> str:
        """
        Generate text from prompt
        
        Args:
            prompt: Input text prompt
            max_length: Maximum generation length
            temperature: Sampling temperature (higher = more random)
            top_k: Keep only top-k predictions
            top_p: Keep predictions with cumulative probability up to top_p
            num_beams: Number of beams for beam search
        
        Returns:
            Generated text
        """
        input_ids = torch.tensor(
            self.tokenizer.encode(prompt, max_length=512),
            dtype=torch.long,
            device=self.device
        ).unsqueeze(0)
        
        generated = input_ids.clone()
        
        with torch.no_grad():
            for _ in range(max_length):
                # Get logits
                logits = self.model(generated)
                next_logits = logits[0, -1, :]
                
                # Apply temperature
                next_logits = next_logits / temperature
                
                # Apply top-k filtering
                if top_k > 0:
                    indices_to_remove = next_logits < torch.topk(next_logits, top_k)[0][..., -1, None]
                    next_logits[indices_to_remove] = float('-inf')
                
                # Apply top-p (nucleus) filtering
                if top_p < 1.0:
                    sorted_logits, sorted_indices = torch.sort(next_logits, descending=True)
                    cumsum = torch.cumsum(F.softmax(sorted_logits, dim=-1), dim=-1)
                    sorted_indices_to_remove = cumsum > top_p
                    sorted_indices_to_remove[..., 1:] = sorted_indices_to_remove[..., :-1].clone()
                    sorted_indices_to_remove[..., 0] = 0
                    indices_to_remove = sorted_indices[sorted_indices_to_remove]
                    next_logits[indices_to_remove] = float('-inf')
                
                # Sample next token
                probs = F.softmax(next_logits, dim=-1)
                next_token = torch.multinomial(probs, num_samples=1)
                
                generated = torch.cat([generated, next_token.unsqueeze(0)], dim=1)
                
                # Stop if we generate end token
                if next_token.item() == self.tokenizer.word2idx.get('[END]', -1):
                    break
        
        # Decode
        generated_ids = generated[0].cpu().numpy().tolist()
        text = self.tokenizer.decode(generated_ids)
        
        # Remove prompt from output
        if text.startswith(prompt):
            text = text[len(prompt):].strip()
        
        return text
    
    def answer_question(
        self,
        question: str,
        context: Optional[str] = None,
        max_length: int = 256,
        temperature: float = 0.7,
    ) -> str:
        """
        Answer a question using the model
        
        Args:
            question: The question to answer
            context: Optional context information
            max_length: Maximum answer length
            temperature: Sampling temperature
        
        Returns:
            Answer text
        """
        if context:
            prompt = f"Context: {context}\nQuestion: {question}\nAnswer:"
        else:
            prompt = f"Question: {question}\nAnswer:"
        
        answer = self.generate(prompt, max_length, temperature)
        return answer.strip()
    
    def chat(
        self,
        message: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        max_length: int = 256,
        temperature: float = 0.7,
    ) -> str:
        """
        Generate a chat response
        
        Args:
            message: User message
            conversation_history: Previous conversation turns
            max_length: Maximum response length
            temperature: Sampling temperature
        
        Returns:
            Assistant response
        """
        prompt = "Chat:\n"
        
        if conversation_history:
            for turn in conversation_history[-5:]:  # Keep last 5 turns
                prompt += f"User: {turn['user']}\nAssistant: {turn['assistant']}\n"
        
        prompt += f"User: {message}\nAssistant:"
        
        response = self.generate(prompt, max_length, temperature)
        return response.strip()
    
    def summarize(
        self,
        text: str,
        max_length: int = 128,
        temperature: float = 0.5,
    ) -> str:
        """
        Summarize text
        
        Args:
            text: Text to summarize
            max_length: Maximum summary length
            temperature: Sampling temperature
        
        Returns:
            Summary text
        """
        prompt = f"Summarize: {text[:1000]}\nSummary:"
        summary = self.generate(prompt, max_length, temperature)
        return summary.strip()
    
    def classify(
        self,
        text: str,
        labels: List[str],
    ) -> Tuple[str, Dict[str, float]]:
        """
        Classify text into one of the provided labels
        
        Args:
            text: Text to classify
            labels: Possible classification labels
        
        Returns:
            Predicted label and confidence scores
        """
        prompt = f"Text: {text}\nClassify as one of: {', '.join(labels)}\nLabel:"
        
        input_ids = torch.tensor(
            self.tokenizer.encode(prompt, max_length=512),
            dtype=torch.long,
            device=self.device
        ).unsqueeze(0)
        
        with torch.no_grad():
            logits = self.model(input_ids)
            next_logits = logits[0, -1, :]
        
        # Get probabilities for label tokens
        scores = {}
        for label in labels:
            label_id = self.tokenizer.word2idx.get(label.lower(), self.tokenizer.word2idx['[UNK]'])
            scores[label] = float(F.softmax(next_logits, dim=-1)[label_id].cpu().numpy())
        
        # Normalize scores
        total = sum(scores.values())
        scores = {k: v/total for k, v in scores.items()}
        
        predicted_label = max(scores, key=scores.get)
        
        return predicted_label, scores
