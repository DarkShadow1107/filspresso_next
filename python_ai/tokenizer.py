"""
Tokenizer for Advanced AI Models
Simple word-piece tokenizer with vocabulary building
"""

import re
from collections import defaultdict, Counter
from typing import List, Dict, Tuple
import json
import os


class SimpleTokenizer:
    """Simple word-piece tokenizer"""
    
    def __init__(self, vocab_size: int = 50000):
        self.vocab_size = vocab_size
        self.word2idx = {}
        self.idx2word = {}
        self.vocab_count = defaultdict(int)
        
        # Initialize with special tokens
        self.special_tokens = {
            '[PAD]': 0,
            '[UNK]': 1,
            '[CLS]': 2,
            '[SEP]': 3,
            '[MASK]': 4,
            '[START]': 5,
            '[END]': 6,
        }
        
        self.word2idx.update(self.special_tokens)
        self.idx2word = {v: k for k, v in self.word2idx.items()}
        self.next_token_id = len(self.special_tokens)
    
    def _tokenize_word(self, word: str) -> List[str]:
        """Break word into subword tokens"""
        tokens = []
        start = 0
        while start < len(word):
            end = len(word)
            found = False
            while start < end:
                substr = word[start:end]
                if start > 0:
                    substr = "##" + substr
                if substr in self.word2idx:
                    tokens.append(substr)
                    found = True
                    break
                end -= 1
            if not found:
                tokens.append("[UNK]")
                start += 1
            else:
                start = end
        return tokens
    
    def build_vocab(self, texts: List[str]):
        """Build vocabulary from texts"""
        # Tokenize all texts and count word frequencies
        words = []
        for text in texts:
            words.extend(self._basic_tokenize(text))
        
        # Count words
        word_freq = Counter(words)
        
        # Build vocab from most common words
        for word, count in word_freq.most_common(self.vocab_size - len(self.special_tokens)):
            if word not in self.word2idx:
                self.word2idx[word] = self.next_token_id
                self.idx2word[self.next_token_id] = word
                self.next_token_id += 1
                self.vocab_count[word] = count
    
    def _basic_tokenize(self, text: str) -> List[str]:
        """Basic tokenization (split by whitespace and punctuation)"""
        text = text.lower()
        text = re.sub(r'([.!?,;:])', r' \1 ', text)
        tokens = text.split()
        return tokens
    
    def encode(self, text: str, max_length: int = 1024) -> List[int]:
        """Convert text to token IDs"""
        tokens = []
        words = self._basic_tokenize(text)
        
        for word in words:
            if word in self.word2idx:
                tokens.append(self.word2idx[word])
            else:
                tokens.append(self.word2idx['[UNK]'])
        
        # Pad or truncate
        if len(tokens) < max_length:
            tokens.extend([self.word2idx['[PAD]']] * (max_length - len(tokens)))
        else:
            tokens = tokens[:max_length]
        
        return tokens
    
    def decode(self, token_ids: List[int]) -> str:
        """Convert token IDs back to text"""
        tokens = [self.idx2word.get(id, '[UNK]') for id in token_ids]
        
        # Join tokens, handling subword pieces
        text = []
        for token in tokens:
            if token.startswith('##'):
                text.append(token[2:])
            else:
                if text:
                    text.append(' ')
                text.append(token)
        
        return ''.join(text).strip()
    
    def save(self, path: str):
        """Save tokenizer to file"""
        data = {
            'word2idx': self.word2idx,
            'idx2word': {str(k): v for k, v in self.idx2word.items()},
            'vocab_count': dict(self.vocab_count),
            'vocab_size': self.vocab_size,
        }
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            json.dump(data, f)
    
    def load(self, path: str):
        """Load tokenizer from file"""
        with open(path, 'r') as f:
            data = json.load(f)
        self.word2idx = data['word2idx']
        self.idx2word = {int(k): v for k, v in data['idx2word'].items()}
        self.vocab_count = data['vocab_count']
        self.vocab_size = data['vocab_size']
        self.next_token_id = len(self.word2idx)
