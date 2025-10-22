"""
Flask API Server for Advanced AI Models
Provides REST endpoints for inference and training
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
import os
from pathlib import Path
import logging
from typing import Dict, List
import json

from models import (
    create_tanka_model,
    create_villanelle_model,
    create_ode_model,
)
from tokenizer import SimpleTokenizer
from inference import InferenceEngine
from trainer import Trainer, TextDataset

# Load capsule volumes
CAPSULE_VOLUMES_PATH = Path(__file__).parent / "data" / "capsule_volumes.json"
if CAPSULE_VOLUMES_PATH.exists():
    with open(CAPSULE_VOLUMES_PATH, 'r', encoding='utf-8') as f:
        CAPSULE_VOLUMES = json.load(f)
else:
    CAPSULE_VOLUMES = {}

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Select which IoT DB helper to use: SQLAlchemy wrapper (pooled) or lightweight helper
USE_SQLALCHEMY = os.getenv('IOT_USE_SQLALCHEMY', '0') in ('1', 'true', 'True')

if USE_SQLALCHEMY:
    try:
        from iot_db_sqlalchemy import init_db, create_command, get_pending_command, update_command_status
        logger.info("Using SQLAlchemy IoT DB wrapper (IOT_USE_SQLALCHEMY=1)")
    except Exception as e:
        logger.error(f"Failed to import SQLAlchemy IoT DB wrapper: {e}; falling back to lightweight iot_db")
        from iot_db import init_db, create_command, get_pending_command, update_command_status
else:
    from iot_db import init_db, create_command, get_pending_command, update_command_status

# Configuration
MODEL_DIR = Path(__file__).parent / "models_checkpoint"
TOKENIZER_PATH = Path(__file__).parent / "tokenizer.json"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
VOCAB_SIZE = int(os.getenv('PYTHON_AI_VOCAB_SIZE', '30000'))

# Global state
models = {}
tokenizer = None
inference_engines = {}
device_info = {
    "device": DEVICE,
    "cuda_available": torch.cuda.is_available(),
    "cuda_device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
}

logger.info(f"Using device: {DEVICE}")
logger.info(f"Torch version: {torch.__version__}")


def init_models():
    """Initialize all Kafelot coffee models"""
    global models, tokenizer, inference_engines
    
    logger.info("Initializing Kafelot coffee models...")
    
    # Initialize tokenizer
    tokenizer = SimpleTokenizer(vocab_size=VOCAB_SIZE)
    
    # Load or create models
    MODEL_DIR.mkdir(exist_ok=True)
    
    # Tanka model (lightweight, conversational)
    try:
        tanka_path = MODEL_DIR / "tanka_best.pt"
        if tanka_path.exists():
            tanka_model, _ = create_tanka_model(VOCAB_SIZE)
            checkpoint = torch.load(tanka_path, map_location=DEVICE)
            tanka_model.load_state_dict(checkpoint['model_state_dict'])
            logger.info(f"✅ Tanka model loaded from {tanka_path}")
        else:
            tanka_model, _ = create_tanka_model(VOCAB_SIZE)
            logger.info("✨ New Tanka model created")
    except Exception as e:
        logger.error(f"Error loading Tanka model: {e}")
        tanka_model, _ = create_tanka_model(VOCAB_SIZE)
    
    # Villanelle model (balanced, technical)
    try:
        vill_path = MODEL_DIR / "villanelle_best.pt"
        if vill_path.exists():
            vill_model, _ = create_villanelle_model(VOCAB_SIZE)
            checkpoint = torch.load(vill_path, map_location=DEVICE)
            vill_model.load_state_dict(checkpoint['model_state_dict'])
            logger.info(f"✅ Villanelle model loaded from {vill_path}")
        else:
            vill_model, _ = create_villanelle_model(VOCAB_SIZE)
            logger.info("✨ New Villanelle model created")
    except Exception as e:
        logger.error(f"Error loading Villanelle model: {e}")
        vill_model, _ = create_villanelle_model(VOCAB_SIZE)

    # Ode model (comprehensive, research-grade)
    try:
        ode_path = MODEL_DIR / "ode_best.pt"
        if ode_path.exists():
            ode_model, _ = create_ode_model(VOCAB_SIZE)
            checkpoint = torch.load(ode_path, map_location=DEVICE)
            ode_model.load_state_dict(checkpoint['model_state_dict'])
            logger.info(f"✅ Ode model loaded from {ode_path}")
        else:
            ode_model, _ = create_ode_model(VOCAB_SIZE)
            logger.info("✨ New Ode model created")
    except Exception as e:
        logger.error(f"Error loading Ode model: {e}")
        ode_model, _ = create_ode_model(VOCAB_SIZE)

    models = {
        'tanka': tanka_model.to(DEVICE),
        'villanelle': vill_model.to(DEVICE),
        'ode': ode_model.to(DEVICE),
    }

    inference_engines = {
        'tanka': InferenceEngine(models['tanka'], tokenizer, DEVICE),
        'villanelle': InferenceEngine(models['villanelle'], tokenizer, DEVICE),
        'ode': InferenceEngine(models['ode'], tokenizer, DEVICE),
    }
    
    logger.info("✅ All Kafelot coffee models initialized successfully!")
    logger.info(f"   - Tanka (~30M params): Lightweight, conversational")
    logger.info(f"   - Villanelle (~60M params): Balanced, technical depth")
    logger.info(f"   - Ode (~90M params): Comprehensive, research-grade")


# Initialize IoT DB (sqlite fallback)
init_db()


### IoT Endpoints: commands lifecycle
@app.route('/api/commands/create', methods=['POST'])
def api_create_command():
    """Create a command for a machine. Body: {machine_id, recipe_json, execute_allowed (optional)}"""
    try:
        data = request.json
        machine_id = data.get('machine_id')
        recipe = data.get('recipe')
        execute_allowed = data.get('execute_allowed', True)
        meta = data.get('meta', {})

        if not machine_id or not recipe:
            return jsonify({'error': 'machine_id and recipe are required'}), 400

        command_id = create_command(machine_id, recipe, execute_allowed=bool(execute_allowed), meta=meta)
        return jsonify({'status': 'created', 'command_id': command_id}), 201
    except Exception as e:
        logger.error(f"Error creating command: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/commands/check/<machine_id>', methods=['GET'])
def api_check_commands(machine_id: str):
    """Used by device to poll for pending commands. Returns one pending command or 204."""
    try:
        cmd = get_pending_command(machine_id)
        if not cmd:
            return ('', 204)
        # Only return recipe if execute_allowed true
        response = {
            'command_id': cmd['command_id'],
            'recipe': cmd['recipe'] if cmd['execute_allowed'] else {},
            'execute_allowed': cmd['execute_allowed'],
            'meta': cmd['meta'],
            'created_at': cmd['created_at'],
        }
        return jsonify(response)
    except Exception as e:
        logger.error(f"Error checking commands for {machine_id}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/commands/update/<int:command_id>', methods=['POST'])
def api_update_command(command_id: int):
    """Device posts status updates: {status: 'brewing'|'complete'|'failed', meta: {...}}"""
    try:
        data = request.json
        status = data.get('status')
        meta = data.get('meta')
        if not status:
            return jsonify({'error': 'status is required'}), 400
        ok = update_command_status(command_id, status, meta=meta)
        if not ok:
            return jsonify({'error': 'command not found or not updated'}), 404
        return jsonify({'status': 'updated', 'command_id': command_id})
    except Exception as e:
        logger.error(f"Error updating command {command_id}: {e}")
        return jsonify({'error': str(e)}), 500



# API Routes

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'device': device_info,
        'models_loaded': list(models.keys()),
    })


@app.route('/api/models', methods=['GET'])
def get_models_info():
    """Get information about available models"""
    models_info = {}
    for name, model in models.items():
        param_count = model.count_parameters()
        models_info[name] = {
            'name': name.upper(),
            'parameters': param_count,
            'parameters_formatted': f"{param_count / 1e6:.1f}M",
            'device': str(next(model.parameters()).device),
        }
    return jsonify(models_info)


@app.route('/api/generate', methods=['POST'])
def generate():
    """Generate text using specified model"""
    try:
        data = request.json
        model_name = data.get('model', 'tanka').lower()
        prompt = data.get('prompt', '')
        max_length = data.get('max_length', 256)
        temperature = data.get('temperature', 0.7)
        top_k = data.get('top_k', 50)
        top_p = data.get('top_p', 0.9)
        
        if model_name not in inference_engines:
            return jsonify({'error': f'Unknown model: {model_name}'}), 400
        
        if not prompt:
            return jsonify({'error': 'Prompt is required'}), 400
        
        engine = inference_engines[model_name]
        generated_text = engine.generate(
            prompt=prompt,
            max_length=max_length,
            temperature=temperature,
            top_k=top_k,
            top_p=top_p,
        )
        
        return jsonify({
            'model': model_name,
            'prompt': prompt,
            'generated': generated_text,
            'full_text': prompt + ' ' + generated_text,
        })
    
    except Exception as e:
        logger.error(f"Error in generate: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/chat', methods=['POST'])
def chat():
    """Chat endpoint"""
    try:
        data = request.json
        model_name = data.get('model', 'villanelle').lower()
        message = data.get('message', '')
        conversation_history = data.get('history', [])
        max_length = data.get('max_length', 256)
        temperature = data.get('temperature', 0.7)
        
        if model_name not in inference_engines:
            return jsonify({'error': f'Unknown model: {model_name}'}), 400
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        engine = inference_engines[model_name]
        response = engine.chat(
            message=message,
            conversation_history=conversation_history,
            max_length=max_length,
            temperature=temperature,
        )
        
        return jsonify({
            'model': model_name,
            'user_message': message,
            'assistant_response': response,
        })
    
    except Exception as e:
        logger.error(f"Error in chat: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/summarize', methods=['POST'])
def summarize():
    """Summarize text"""
    try:
        data = request.json
        model_name = data.get('model', 'villanelle').lower()
        text = data.get('text', '')
        max_length = data.get('max_length', 128)
        
        if model_name not in inference_engines:
            return jsonify({'error': f'Unknown model: {model_name}'}), 400
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        engine = inference_engines[model_name]
        summary = engine.summarize(text, max_length)
        
        return jsonify({
            'model': model_name,
            'original_length': len(text.split()),
            'original': text[:500],
            'summary': summary,
        })
    
    except Exception as e:
        logger.error(f"Error in summarize: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/classify', methods=['POST'])
def classify():
    """Classify text"""
    try:
        data = request.json
        model_name = data.get('model', 'tanka').lower()
        text = data.get('text', '')
        labels = data.get('labels', [])
        
        if model_name not in inference_engines:
            return jsonify({'error': f'Unknown model: {model_name}'}), 400
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        if not labels:
            return jsonify({'error': 'Labels are required'}), 400
        
        engine = inference_engines[model_name]
        predicted_label, scores = engine.classify(text, labels)
        
        return jsonify({
            'model': model_name,
            'text': text[:500],
            'predicted': predicted_label,
            'confidence': scores,
        })
    
    except Exception as e:
        logger.error(f"Error in classify: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/train', methods=['POST'])
def train():
    """Train a model on provided data"""
    try:
        data = request.json
        model_name = data.get('model', 'tanka').lower()
        texts = data.get('texts', [])
        num_epochs = data.get('num_epochs', 1)
        batch_size = data.get('batch_size', 16)
        learning_rate = data.get('learning_rate', 1e-4)
        
        if model_name not in models:
            return jsonify({'error': f'Unknown model: {model_name}'}), 400
        
        if not texts or len(texts) == 0:
            return jsonify({'error': 'Training texts are required'}), 400
        
        logger.info(f"Starting training for {model_name} model with {len(texts)} samples")
        
        # Create trainer
        trainer = Trainer(
            model=models[model_name],
            tokenizer=tokenizer,
            device=DEVICE,
            learning_rate=learning_rate,
            num_epochs=num_epochs,
            batch_size=batch_size,
            checkpoint_dir=str(MODEL_DIR),
        )
        
        # Train
        history = trainer.train(
            train_texts=texts,
            val_texts=None,
            model_name=model_name,
        )
        
        return jsonify({
            'status': 'success',
            'model': model_name,
            'epochs': num_epochs,
            'samples': len(texts),
            'history': history,
        })
    
    except Exception as e:
        logger.error(f"Error in train: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/save-model', methods=['POST'])
def save_model():
    """Save model checkpoint"""
    try:
        data = request.json
        model_name = data.get('model', 'tanka').lower()
        
        if model_name not in models:
            return jsonify({'error': f'Unknown model: {model_name}'}), 400
        
        MODEL_DIR.mkdir(exist_ok=True)
        filepath = MODEL_DIR / f"{model_name}_manual.pt"
        
        checkpoint = {
            'model_state_dict': models[model_name].state_dict(),
            'config': models[model_name].config.__dict__,
        }
        
        torch.save(checkpoint, filepath)
        
        return jsonify({
            'status': 'success',
            'model': model_name,
            'filepath': str(filepath),
        })
    
    except Exception as e:
        logger.error(f"Error in save_model: {e}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Initialize models before starting server
    init_models()
    
    # Start server
    port = int(os.getenv('PYTHON_AI_PORT', 5000))
    debug = os.getenv('FLASK_ENV', 'production') == 'development'
    
    logger.info(f"🚀 Starting Flask server on port {port}")
    logger.info(f"Debug mode: {debug}")
    
    app.run(host='0.0.0.0', port=port, debug=debug, threaded=True)
