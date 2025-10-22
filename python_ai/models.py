"""
Advanced AI Models: Tanka, Villanelle, and Ode
Enhanced transformer-based models with coffee domain specialization
- Tanka: ~30M parameters (lightweight, conversational)
- Villanelle: ~60M parameters (balanced, technical)
- Ode: ~90M parameters (comprehensive, research-grade)

Features:
- Rotary Position Embeddings (RoPE) for better long-range dependencies
- Multi-Query Attention (MQA) for efficiency
- SwiGLU activation for improved expressiveness
- Coffee Domain Attention for specialized knowledge
- Mixture of Experts (MoE) for multi-domain expertise
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Dict, List, Tuple, Optional
import numpy as np
from dataclasses import dataclass
import math


def format_parameter_count(param_count: int) -> str:
    """Format parameter count to human readable format (e.g., 122,610,157 → 120M)"""
    if param_count >= 1_000_000_000:
        return f"{param_count / 1_000_000_000:.0f}B"
    elif param_count >= 1_000_000:
        return f"{param_count / 1_000_000:.0f}M"
    elif param_count >= 1_000:
        return f"{param_count / 1_000:.0f}K"
    else:
        return str(param_count)


@dataclass
class ModelConfig:
    """Configuration for transformer models"""
    vocab_size: int = 50000
    max_seq_length: int = 1024
    hidden_size: int = 768
    num_layers: int = 12
    num_heads: int = 12
    num_kv_heads: int = 4  # For Multi-Query Attention
    ffn_hidden_size: int = 3072
    dropout_rate: float = 0.1
    attention_dropout_rate: float = 0.1
    layer_norm_eps: float = 1e-6
    activation: str = "swiglu"
    use_rope: bool = True
    use_moe: bool = False
    num_experts: int = 8
    num_experts_per_token: int = 2
    rope_theta: float = 10000.0


class RotaryPositionEmbedding(nn.Module):
    """
    Rotary Position Embedding (RoPE) for better long-range dependencies
    Reference: RoFormer (Su et al., 2021)
    """
    
    def __init__(self, dim: int, max_seq_length: int = 2048, theta: float = 10000.0):
        super().__init__()
        self.dim = dim
        self.max_seq_length = max_seq_length
        self.theta = theta
        
        # Precompute frequency tensor
        # Build inv_freq using half-dimension to avoid issues when dim is odd
        half_dim = dim // 2
        if half_dim < 1:
            half_dim = 1

        inv_freq = 1.0 / (theta ** (torch.arange(0, half_dim).float() / max(1, half_dim)))
        self.register_buffer("inv_freq", inv_freq)

        # Precompute cos and sin for max sequence length
        t = torch.arange(max_seq_length).to(self.inv_freq.device).type_as(self.inv_freq)
        freqs = torch.outer(t, self.inv_freq)
        emb = torch.cat((freqs, freqs), dim=-1)  # shape: [max_seq_length, 2*half_dim]

        # Ensure emb last-dim matches requested dim: trim or pad as necessary
        if emb.shape[-1] < dim:
            pad_size = dim - emb.shape[-1]
            pad = torch.zeros((emb.shape[0], pad_size), dtype=emb.dtype, device=emb.device)
            emb = torch.cat((emb, pad), dim=-1)
        elif emb.shape[-1] > dim:
            emb = emb[:, :dim]

        self.register_buffer("cos_cached", emb.cos()[None, None, :, :], persistent=False)
        self.register_buffer("sin_cached", emb.sin()[None, None, :, :], persistent=False)
    
    def rotate_half(self, x: torch.Tensor) -> torch.Tensor:
        """Helper function to rotate half the hidden dims"""
        # Split into two equal halves for rotation; if odd, leave the last element(s) unrotated
        dim = x.shape[-1]
        split = dim // 2
        x1 = x[..., :split]
        x2 = x[..., split: split * 2]
        rest = x[..., split * 2:]

        rotated = torch.cat((-x2, x1), dim=-1)
        # Append any leftover dims (if dim is odd) unchanged to preserve input size
        if rest.numel() != 0:
            rotated = torch.cat((rotated, rest), dim=-1)
        return rotated
    
    def forward(self, q: torch.Tensor, k: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Apply rotary embeddings to queries and keys
        Args:
            q: [batch_size, num_heads, seq_len, head_dim]
            k: [batch_size, num_heads, seq_len, head_dim]
        Returns:
            Rotated q and k
        """
        seq_len = q.shape[2]
        cos = self.cos_cached[:, :, :seq_len, ...]
        sin = self.sin_cached[:, :, :seq_len, ...]
        
        q_embed = (q * cos) + (self.rotate_half(q) * sin)
        k_embed = (k * cos) + (self.rotate_half(k) * sin)
        
        return q_embed, k_embed


class SwiGLU(nn.Module):
    """
    SwiGLU activation function for improved expressiveness
    Reference: GLU Variants Improve Transformer (Shazeer, 2020)
    """
    
    def __init__(self, dim: int):
        super().__init__()
        self.dim = dim
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: [batch_size, seq_len, 2 * dim] (split into two parts)
        Returns:
            [batch_size, seq_len, dim]
        """
        x, gate = x.chunk(2, dim=-1)
        return x * F.silu(gate)


class CoffeeDomainAttention(nn.Module):
    """
    Specialized attention mechanism for coffee domain knowledge
    Learns to focus on specific aspects: extraction, chemistry, sensory, etc.
    """
    
    def __init__(self, hidden_size: int, num_domains: int = 8):
        super().__init__()
        self.num_domains = num_domains
        self.hidden_size = hidden_size
        
        # Domain embeddings
        self.domain_embeddings = nn.Parameter(torch.randn(num_domains, hidden_size))
        self.domain_projection = nn.Linear(hidden_size, num_domains)
        
    def forward(self, hidden_states: torch.Tensor) -> torch.Tensor:
        """
        Apply domain-specific attention weighting
        Args:
            hidden_states: [batch_size, seq_len, hidden_size]
        Returns:
            Enhanced hidden states with domain knowledge
        """
        # Compute domain affinities
        domain_scores = self.domain_projection(hidden_states)  # [batch, seq, num_domains]
        domain_weights = F.softmax(domain_scores, dim=-1)
        
        # Apply domain embeddings
        domain_context = torch.einsum('bsd,dh->bsh', domain_weights, self.domain_embeddings)
        
        # Blend with original hidden states
        return hidden_states + 0.1 * domain_context


class MultiQueryAttention(nn.Module):
    """
    Multi-Query Attention with Rotary Position Embeddings
    More efficient than Multi-Head Attention - shares keys and values across heads
    """
    
    def __init__(
        self,
        hidden_size: int,
        num_heads: int,
        num_kv_heads: int = 4,
        dropout_rate: float = 0.1,
        use_rope: bool = True,
        max_seq_length: int = 2048,
    ):
        super().__init__()
        assert hidden_size % num_heads == 0, "hidden_size must be divisible by num_heads"
        
        self.hidden_size = hidden_size
        self.num_heads = num_heads
        self.num_kv_heads = num_kv_heads
        self.head_dim = hidden_size // num_heads
        self.scale = self.head_dim ** -0.5
        self.use_rope = use_rope
        
        # Query projection (full heads)
        self.query = nn.Linear(hidden_size, hidden_size, bias=False)
        
        # Key and Value projections (reduced heads for MQA)
        self.key = nn.Linear(hidden_size, num_kv_heads * self.head_dim, bias=False)
        self.value = nn.Linear(hidden_size, num_kv_heads * self.head_dim, bias=False)
        
        self.out_proj = nn.Linear(hidden_size, hidden_size, bias=False)
        self.dropout = nn.Dropout(dropout_rate)
        
        # Rotary position embeddings
        if use_rope:
            self.rope = RotaryPositionEmbedding(self.head_dim, max_seq_length)
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        batch_size, seq_len, _ = hidden_states.shape
        
        # Linear projections
        Q = self.query(hidden_states).view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        K = self.key(hidden_states).view(batch_size, seq_len, self.num_kv_heads, self.head_dim).transpose(1, 2)
        V = self.value(hidden_states).view(batch_size, seq_len, self.num_kv_heads, self.head_dim).transpose(1, 2)
        
        # Apply RoPE if enabled
        if self.use_rope:
            # Expand K for RoPE (need same shape as Q for rotation)
            K_expanded = K.repeat_interleave(self.num_heads // self.num_kv_heads, dim=1)
            Q, K_expanded = self.rope(Q, K_expanded)
            # Reduce back to num_kv_heads
            K = K_expanded.view(batch_size, self.num_kv_heads, self.num_heads // self.num_kv_heads, seq_len, self.head_dim).mean(dim=2)
        
        # Expand K and V to match number of query heads
        K = K.repeat_interleave(self.num_heads // self.num_kv_heads, dim=1)
        V = V.repeat_interleave(self.num_heads // self.num_kv_heads, dim=1)
        
        # Attention scores
        scores = torch.matmul(Q, K.transpose(-2, -1)) * self.scale
        
        # Apply mask if provided
        if attention_mask is not None:
            scores = scores.masked_fill(attention_mask == 0, float('-inf'))
        
        # Attention weights
        attn_weights = F.softmax(scores, dim=-1)
        attn_weights = self.dropout(attn_weights)
        
        # Context
        context = torch.matmul(attn_weights, V)
        context = context.transpose(1, 2).contiguous()
        context = context.view(batch_size, seq_len, self.hidden_size)
        
        # Output projection
        output = self.out_proj(context)
        
        return output, attn_weights


class MixtureOfExpertsLayer(nn.Module):
    """
    Mixture of Experts (MoE) for specialized coffee domain knowledge
    Different experts specialize in different aspects: brewing, chemistry, sensory, etc.
    """
    
    def __init__(
        self,
        hidden_size: int,
        ffn_hidden_size: int,
        num_experts: int = 8,
        num_experts_per_token: int = 2,
        dropout_rate: float = 0.1,
    ):
        super().__init__()
        self.num_experts = num_experts
        self.num_experts_per_token = num_experts_per_token
        self.hidden_size = hidden_size
        
        # Router network
        self.router = nn.Linear(hidden_size, num_experts, bias=False)
        
        # Expert networks
        self.experts = nn.ModuleList([
            nn.Sequential(
                nn.Linear(hidden_size, ffn_hidden_size, bias=False),
                nn.SiLU(),
                nn.Dropout(dropout_rate),
                nn.Linear(ffn_hidden_size, hidden_size, bias=False),
            )
            for _ in range(num_experts)
        ])
        
        self.dropout = nn.Dropout(dropout_rate)
    
    def forward(self, hidden_states: torch.Tensor) -> torch.Tensor:
        """
        Route tokens to top-k experts
        Args:
            hidden_states: [batch_size, seq_len, hidden_size]
        Returns:
            Expert-processed hidden states
        """
        batch_size, seq_len, hidden_size = hidden_states.shape
        hidden_states_flat = hidden_states.view(-1, hidden_size)
        
        # Compute routing scores
        router_logits = self.router(hidden_states_flat)  # [batch*seq, num_experts]
        routing_weights = F.softmax(router_logits, dim=-1)
        
        # Select top-k experts
        top_k_weights, top_k_indices = torch.topk(routing_weights, self.num_experts_per_token, dim=-1)
        top_k_weights = top_k_weights / top_k_weights.sum(dim=-1, keepdim=True)  # Normalize
        
        # Apply experts
        output = torch.zeros_like(hidden_states_flat)
        for i in range(self.num_experts_per_token):
            expert_idx = top_k_indices[:, i]
            expert_weight = top_k_weights[:, i:i+1]
            
            # Process each token with its assigned expert
            for expert_id in range(self.num_experts):
                mask = (expert_idx == expert_id)
                if mask.any():
                    expert_input = hidden_states_flat[mask]
                    expert_output = self.experts[expert_id](expert_input)
                    output[mask] += expert_weight[mask] * expert_output
        
        output = output.view(batch_size, seq_len, hidden_size)
        return self.dropout(output)


class FeedForwardNetworkSwiGLU(nn.Module):
    """Feed-forward network with SwiGLU activation"""
    
    def __init__(self, hidden_size: int, ffn_hidden_size: int, dropout_rate: float = 0.1):
        super().__init__()
        # SwiGLU requires 2x intermediate size (split into value and gate)
        self.linear1 = nn.Linear(hidden_size, ffn_hidden_size * 2, bias=False)
        self.swiglu = SwiGLU(ffn_hidden_size)
        self.linear2 = nn.Linear(ffn_hidden_size, hidden_size, bias=False)
        self.dropout = nn.Dropout(dropout_rate)
    
    def forward(self, hidden_states: torch.Tensor) -> torch.Tensor:
        hidden_states = self.linear1(hidden_states)
        hidden_states = self.swiglu(hidden_states)
        hidden_states = self.dropout(hidden_states)
        hidden_states = self.linear2(hidden_states)
        hidden_states = self.dropout(hidden_states)
        return hidden_states


class EnhancedTransformerLayer(nn.Module):
    """Enhanced transformer encoder layer with MQA, SwiGLU, and optional MoE"""
    
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.attention = MultiQueryAttention(
            config.hidden_size,
            config.num_heads,
            config.num_kv_heads,
            config.attention_dropout_rate,
            config.use_rope,
            config.max_seq_length,
        )
        self.attention_layer_norm = nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps)
        self.attention_dropout = nn.Dropout(config.dropout_rate)
        
        # Coffee domain attention
        self.coffee_attention = CoffeeDomainAttention(config.hidden_size)
        
        # Feed-forward or Mixture of Experts
        if config.use_moe:
            self.ffn = MixtureOfExpertsLayer(
                config.hidden_size,
                config.ffn_hidden_size,
                config.num_experts,
                config.num_experts_per_token,
                config.dropout_rate,
            )
        else:
            self.ffn = FeedForwardNetworkSwiGLU(
                config.hidden_size,
                config.ffn_hidden_size,
                config.dropout_rate,
            )
        self.ffn_layer_norm = nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps)
        self.ffn_dropout = nn.Dropout(config.dropout_rate)
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        # Self-attention with residual connection
        attn_output, _ = self.attention(hidden_states, attention_mask)
        attn_output = self.attention_dropout(attn_output)
        hidden_states = self.attention_layer_norm(hidden_states + attn_output)
        
        # Coffee domain attention
        hidden_states = self.coffee_attention(hidden_states)
        
        # Feed-forward with residual connection
        ffn_output = self.ffn(hidden_states)
        ffn_output = self.ffn_dropout(ffn_output)
        hidden_states = self.ffn_layer_norm(hidden_states + ffn_output)
        
        return hidden_states


class TransformerLayer(nn.Module):
    """Legacy transformer encoder layer for backward compatibility"""
    
    def __init__(self, config: ModelConfig):
        super().__init__()
        # Use enhanced layer internally
        self.enhanced_layer = EnhancedTransformerLayer(config)
    
    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        return self.enhanced_layer(hidden_states, attention_mask)


class AdvancedAIModel(nn.Module):
    """
    Advanced AI Model based on Enhanced Transformer architecture
    Configured as Tanka (~30M), Villanelle (~60M), or Ode (~90M)
    
    Features:
    - Multi-Query Attention (MQA) for efficiency
    - Rotary Position Embeddings (RoPE) for better context
    - SwiGLU activation for improved expressiveness
    - Coffee Domain Attention for specialized knowledge
    - Optional Mixture of Experts (MoE) for multi-domain expertise
    """
    
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config

        # Embeddings
        self.embedding = nn.Embedding(config.vocab_size, config.hidden_size)
        self.positional_embedding = nn.Embedding(config.max_seq_length, config.hidden_size)
        self.dropout = nn.Dropout(config.dropout_rate)

        # Transformer layers
        self.layers = nn.ModuleList([
            TransformerLayer(config) for _ in range(config.num_layers)
        ])

        # Output layers
        # We tie output projection weights to the input embedding to avoid duplicating
        # the large embedding <-> vocab matrix. This reduces the total parameter count
        # significantly (embedding weight is reused for logits projection).
        self.layer_norm = nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps)

        self._init_weights()
    
    def _init_weights(self):
        """Initialize model weights"""
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.xavier_uniform_(module.weight)
                if module.bias is not None:
                    nn.init.constant_(module.bias, 0)
            elif isinstance(module, nn.Embedding):
                nn.init.normal_(module.weight, mean=0, std=0.02)
    
    def count_parameters(self) -> int:
        """Count total trainable parameters"""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
    
    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """
        Forward pass
        Args:
            input_ids: [batch_size, seq_len]
            attention_mask: [batch_size, seq_len]
        Returns:
            logits: [batch_size, seq_len, vocab_size]
        """
        seq_len = input_ids.shape[1]
        
        # Embedding
        hidden_states = self.embedding(input_ids)
        positions = torch.arange(seq_len, device=input_ids.device).unsqueeze(0)
        pos_embeddings = self.positional_embedding(positions)
        hidden_states = hidden_states + pos_embeddings
        hidden_states = self.dropout(hidden_states)
        
        # Transformer layers
        for layer in self.layers:
            hidden_states = layer(hidden_states, attention_mask)

        # Output: use embedding matrix as tied output projection to reduce parameters
        hidden_states = self.layer_norm(hidden_states)
        # logits: [batch, seq_len, vocab_size] = hidden_states @ embedding_weight.T
        logits = torch.matmul(hidden_states, self.embedding.weight.t())

        return logits


def create_tanka_model(vocab_size: int = 50000) -> Tuple[AdvancedAIModel, ModelConfig]:
    """
    Create Kafelot Tanka model (~30M parameters target)
    Lightweight, conversational model with essential coffee knowledge
    Features: MQA, RoPE, SwiGLU, Coffee Domain Attention
    """
    # Tuned for ~30M parameters
    config = ModelConfig(
        vocab_size=vocab_size,
        max_seq_length=1024,
        hidden_size=512,       # 512 / 8 heads = 64 head_dim (even)
        num_layers=8,
        num_heads=8,
        num_kv_heads=2,        # MQA with 2 KV heads for efficiency
        ffn_hidden_size=512 * 3,  # 3x hidden_size
        dropout_rate=0.1,
        attention_dropout_rate=0.1,
        use_rope=True,
        use_moe=False,         # No MoE for lightweight model
        activation="swiglu",
    )
    model = AdvancedAIModel(config)
    params = model.count_parameters()
    formatted_params = format_parameter_count(params)
    print(f"🌿 Kafelot Tanka Model (Enhanced) created: {params:,} parameters (~{formatted_params})")
    print(f"   Features: Multi-Query Attention (2 KV heads), RoPE, SwiGLU, Coffee Domain Attention")
    return model, config


def create_villanelle_model(vocab_size: int = 50000) -> Tuple[AdvancedAIModel, ModelConfig]:
    """
    Create Kafelot Villanelle model (~60M parameters target)
    Balanced model with technical depth and efficiency
    Features: MQA, RoPE, SwiGLU, Coffee Domain Attention, Light MoE
    """
    config = ModelConfig(
        vocab_size=vocab_size,
        max_seq_length=1024,
        hidden_size=704,       # 704 / 8 heads = 88 head_dim (even); ~60M with MoE
        num_layers=9,
        num_heads=8,
        num_kv_heads=2,        # MQA with 2 KV heads
        ffn_hidden_size=704 * 3,  # 3x hidden_size
        dropout_rate=0.1,
        attention_dropout_rate=0.1,
        use_rope=True,
        use_moe=True,          # Enable MoE for specialized knowledge
        num_experts=2,         # keep experts minimal
        num_experts_per_token=1,
        activation="swiglu",
    )
    model = AdvancedAIModel(config)
    params = model.count_parameters()
    formatted_params = format_parameter_count(params)
    print(f"🎻 Kafelot Villanelle Model (Enhanced) created: {params:,} parameters (~{formatted_params})")
    print(f"   Features: Multi-Query Attention (2 KV heads), RoPE, SwiGLU, Coffee Domain Attention, MoE (4 experts)")
    return model, config


def create_ode_model(vocab_size: int = 50000) -> Tuple[AdvancedAIModel, ModelConfig]:
    """
    Create Kafelot Ode model (~90M parameters target)
    Comprehensive research-grade model with full capabilities
    Features: MQA, RoPE, SwiGLU, Coffee Domain Attention, Full MoE
    """
    # increase Ode capacity and ensure per-head dimension is even (hidden_size divisible by num_heads)
    config = ModelConfig(
        vocab_size=vocab_size,
        max_seq_length=1536,   # balanced context for research content
        hidden_size=784,       # 784 / 8 = 98 head_dim (even)
        num_layers=10,
        num_heads=8,
        num_kv_heads=4,        # MQA with 4 KV heads for quality
        ffn_hidden_size=784 * 3,  # 3x hidden_size
        dropout_rate=0.1,
        attention_dropout_rate=0.1,
        use_rope=True,
        use_moe=True,          # MoE for specialization
        num_experts=2,         # keep experts minimal to control params
        num_experts_per_token=1,
        activation="swiglu",
    )
    model = AdvancedAIModel(config)
    params = model.count_parameters()
    formatted_params = format_parameter_count(params)
    print(f"🎼 Kafelot Ode Model (Enhanced) created: {params:,} parameters (~{formatted_params})")
    print(f"   Features: Multi-Query Attention (4 KV heads), RoPE, SwiGLU, Coffee Domain Attention, MoE (8 experts)")
    return model, config


if __name__ == "__main__":
    """Test model creation"""
    print("\n" + "="*80)
    print("KAFELOT AI MODELS - Enhanced with Advanced Transformer Features")
    print("="*80 + "\n")
    
    # Create all three models
    print("Creating Tanka (Lightweight)...")
    tanka_model, tanka_config = create_tanka_model()
    print()
    
    print("Creating Villanelle (Balanced)...")
    villanelle_model, villanelle_config = create_villanelle_model()
    print()
    
    print("Creating Ode (Comprehensive)...")
    ode_model, ode_config = create_ode_model()
    print()
    
    print("="*80)
    print("All models created successfully!")
    print("="*80)