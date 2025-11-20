"""
TinyLlama Model Management for Coffee AI
Handles loading and inference with fine-tuned TinyLlama models
"""

import torch
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

# Try to import transformers and peft
try:
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import PeftModel
    TINYLLAMA_AVAILABLE = True
except ImportError:
    TINYLLAMA_AVAILABLE = False
    logger.warning("⚠️ Transformers/PEFT not installed. Run: pip install transformers peft bitsandbytes")

class GemmaModelManager:
    """Manages TinyLlama coffee and chemistry models"""
    
    def __init__(self, models_dir: Path):
        self.models_dir = models_dir
        self.coffee_model = None
        self.chemistry_model = None
        self.tokenizer = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        if TINYLLAMA_AVAILABLE:
            self.load_models()
    
    def load_models(self):
        """Load both TinyLlama models"""
        # Load TinyLlama Coffee Model (tinyllama_v2)
        coffee_path = self.models_dir / "tinyllama_v2"
        if coffee_path.exists():
            try:
                logger.info(f"Loading TinyLlama Coffee model from {coffee_path}...")
                base_model = AutoModelForCausalLM.from_pretrained(
                    "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
                    device_map="auto",
                    torch_dtype=torch.float16,
                )
                self.coffee_model = PeftModel.from_pretrained(base_model, str(coffee_path))
                self.tokenizer = AutoTokenizer.from_pretrained(str(coffee_path))
                self.tokenizer.pad_token = self.tokenizer.eos_token
                logger.info("✅ TinyLlama Coffee model loaded")
            except Exception as e:
                logger.error(f"❌ Error loading TinyLlama Coffee model: {e}")
        else:
            logger.warning(f"⚠️ TinyLlama Coffee model not found at {coffee_path}")
            logger.info("   Run: python scripts/finetune_gemma_coffee.py")
        
        # Load TinyLlama Chemistry Model (tinyllama_chem)
        chem_path = self.models_dir / "tinyllama_chem"
        if chem_path.exists():
            try:
                logger.info(f"Loading TinyLlama Chemistry model from {chem_path}...")
                base_model = AutoModelForCausalLM.from_pretrained(
                    "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
                    device_map="auto",
                    torch_dtype=torch.float16,
                )
                self.chemistry_model = PeftModel.from_pretrained(base_model, str(chem_path))
                if not self.tokenizer:  # Use chemistry tokenizer if coffee not loaded
                    self.tokenizer = AutoTokenizer.from_pretrained(str(chem_path))
                    self.tokenizer.pad_token = self.tokenizer.eos_token
                logger.info("✅ TinyLlama Chemistry model loaded")
            except Exception as e:
                logger.error(f"❌ Error loading TinyLlama Chemistry model: {e}")
        else:
            logger.warning(f"⚠️ TinyLlama Chemistry model not found at {chem_path}")
            logger.info("   Run: python scripts/finetune_gemma_chemistry.py")
    
    def generate(self, prompt: str, chemistry_mode: bool = False, max_length: int = 512, temperature: float = 0.7):
        """
        Generate response using appropriate TinyLlama model
        
        Args:
            prompt: User prompt
            chemistry_mode: Use chemistry model if True, coffee model if False
            max_length: Maximum generation length
            temperature: Sampling temperature
        
        Returns:
            Generated text string
        """
        if not TINYLLAMA_AVAILABLE:
            return "Error: Transformers/PEFT not installed"
        
        # Select model
        model = self.chemistry_model if chemistry_mode else self.coffee_model
        
        if model is None:
            model_name = "chemistry" if chemistry_mode else "coffee"
            return f"Error: TinyLlama {model_name} model not loaded"
        
        if self.tokenizer is None:
            return "Error: Tokenizer not loaded"
        
        try:
            # Format prompt for TinyLlama chat format
            system_prompt = "You are a helpful chemistry assistant." if chemistry_mode else "You are a helpful coffee expert."
            formatted_prompt = f"<|system|>\n{system_prompt}</s>\n<|user|>\n{prompt}</s>\n<|assistant|>\n"
            
            # Tokenize
            inputs = self.tokenizer(formatted_prompt, return_tensors="pt").to(self.device)
            
            # Generate
            with torch.no_grad():
                outputs = model.generate(
                    **inputs,
                    max_length=max_length,
                    temperature=temperature,
                    do_sample=True,
                    top_p=0.9,
                    pad_token_id=self.tokenizer.eos_token_id,
                )
            
            # Decode
            generated_text = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
            
            # Extract model response (remove prompt)
            if "<start_of_turn>model" in generated_text:
                response = generated_text.split("<start_of_turn>model")[-1].strip()
            else:
                response = generated_text[len(prompt):].strip()
            
            return response
            
        except Exception as e:
            logger.error(f"Error during generation: {e}")
            return f"Error: {str(e)}"
    
    def is_ready(self):
        """Check if at least one model is loaded"""
        return self.coffee_model is not None or self.chemistry_model is not None
