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
import urllib.parse
# bcrypt removed as requested

# TinyLlama model manager
try:
    from tinyllama_models import TinyLlamaModelManager
    TINYLLAMA_AVAILABLE = True
except ImportError:
    TINYLLAMA_AVAILABLE = False

# RAG retriever
try:
    from rag_retriever import CoffeeRAGRetriever
    RAG_AVAILABLE = True
except ImportError:
    RAG_AVAILABLE = False

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

# Add static route for icons stored in public/images/icons/
repo_root = Path(__file__).parent.parent
public_path = repo_root / 'public'
if public_path.exists():
    app.static_folder = str(public_path)
    app.static_url_path = ''

# Import IoT DB helper (in-memory stub for coffee machine commands)
try:
    from iot_db import init_db, create_command, get_pending_command, update_command_status
    logger.info("Using IoT DB helper (in-memory stub)")
except Exception as e:
    logger.error(f"Failed to import IoT DB helper: {e}")
    # Create dummy functions if import fails
    def init_db(): pass
    def create_command(*args, **kwargs): return 0
    def get_pending_command(*args, **kwargs): return None
    def update_command_status(*args, **kwargs): return False

# Configuration
MODEL_DIR = Path(__file__).parent / "checkpoints"
TOKENIZER_PATH = Path(__file__).parent / "tokenizer.json"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
VOCAB_SIZE = int(os.getenv('PYTHON_AI_VOCAB_SIZE', '30000'))

# Global state
models = {}
tokenizer = None
inference_engines = {}
tinyllama_manager = None  # New: TinyLlama model manager
rag_retriever = None  # New: RAG retriever for coffee knowledge
device_info = {
    "device": DEVICE,
    "cuda_available": torch.cuda.is_available(),
    "cuda_device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
}

logger.info(f"Using device: {DEVICE}")
logger.info(f"Torch version: {torch.__version__}")
if not TINYLLAMA_AVAILABLE:
    logger.warning("⚠️ TinyLlama models not available - install: pip install transformers peft bitsandbytes")
if not RAG_AVAILABLE:
    logger.info("RAG retriever module not found (expected initially)")


def init_models():
    """Initialize TinyLlama coffee models"""
    global models, tokenizer, inference_engines, tinyllama_manager, rag_retriever
    
    logger.info("Initializing coffee AI models...")
    
    # Initialize TinyLlama models (preferred)
    if TINYLLAMA_AVAILABLE:
        models_path = MODEL_DIR.parent / "models"
        models_path.mkdir(parents=True, exist_ok=True)
        tinyllama_manager = TinyLlamaModelManager(models_path)
        
        if tinyllama_manager.is_ready():
            logger.info("✅ TinyLlama models initialized")
        else:
            logger.warning("⚠️ No TinyLlama models loaded - run training scripts")
    else:
        logger.error("❌ TinyLlama not available. Install dependencies:")
        logger.error("   pip install transformers peft bitsandbytes accelerate")
    
    # Initialize RAG retriever
    if RAG_AVAILABLE:
        try:
            rag_data_path = MODEL_DIR.parent / "rag_data"
            if (rag_data_path / "coffee_chunks.json").exists():
                rag_retriever = CoffeeRAGRetriever(rag_data_path)
                logger.info("✅ RAG retriever initialized")
            else:
                logger.warning(f"⚠️ RAG data not found - run: python scripts/build_coffee_rag.py")
        except Exception as e:
            logger.error(f"❌ RAG retriever error: {e}")
    else:
        logger.warning("⚠️ RAG not available. Install: pip install sentence-transformers faiss-cpu PyPDF2")
    
    logger.info("Model initialization complete")


# =====================================================================
# HELPER FUNCTIONS
# =====================================================================

def create_system_prompt(chemistry_mode: bool, model_name: str) -> str:
    """Create system prompt that limits model output based on chemistry mode"""
    base_prompt = """You are Kafelot, a friendly and knowledgeable coffee expert AI assistant.
Your main expertise and passion is coffee - its varieties, brewing methods, flavors, and culture.
Be warm, engaging, and share your enthusiasm for quality coffee.
When discussing coffee, feel free to mention capsules, machines, and the Kafelot ecosystem."""
    
    if chemistry_mode and model_name in ['tanka', 'tanka_chemistry']:
        # Allow full knowledge including chemistry
        chemistry_extension = """

CHEMISTRY MODE ENABLED: You have access to advanced molecular and chemical knowledge.
When discussing coffee and the user shows interest in the science:
- You can discuss caffeine, chlorogenic acid, and other compounds in coffee
- You can explain the chemistry of brewing extraction
- You can reference molecular structures and chemical interactions
- If asked about specific molecules or chemistry, provide detailed scientific explanations
- You can discuss molecular properties and their effects on flavor"""
        return base_prompt + chemistry_extension
    else:
        # Restrict to coffee-only topics
        restriction = """

COFFEE-ONLY MODE: Keep discussion focused on coffee expertise.
IMPORTANT RESTRICTIONS:
- Do NOT discuss molecular structures, atoms, or chemical formulas
- Do NOT mention specific chemical compounds like "caffeine molecule" - say "caffeine" instead
- Do NOT explain chemistry or molecular properties
- If users ask about the science of coffee, explain in simple, non-technical terms
- If they ask about molecules or chemistry specifically, politely redirect: "I'm best at discussing coffee! Let me tell you about flavors and brewing instead..."
- Avoid technical chemistry terminology (SMILES, LogP, TPSA, etc.)"""
        return base_prompt + restriction


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
    models_status = {
        'tinyllama_coffee': tinyllama_manager.coffee_model is not None if tinyllama_manager else False,
        'tinyllama_chemistry': tinyllama_manager.chemistry_model is not None if tinyllama_manager else False,
        'rag_retriever': rag_retriever is not None,
    }
    
    # Include old Tanka models if loaded
    if models:
        models_status.update({k: True for k in models.keys()})
    
    return jsonify({
        'status': 'ok',
        'device': device_info,
        'models_loaded': models_status,
        'tinyllama_available': TINYLLAMA_AVAILABLE,
        'rag_available': RAG_AVAILABLE,
    })


@app.route('/api/models', methods=['GET'])
def get_models_info():
    """Get information about available models"""
    models_info = {}
    
    # Add TinyLlama models
    if tinyllama_manager:
        if tinyllama_manager.coffee_model:
            models_info['tinyllama_coffee'] = {
                'name': 'TinyLlama Coffee',
                'type': 'fine-tuned-tinyllama-1b',
                'description': 'Coffee expertise with RAG knowledge base',
                'parameters': '1B (LoRA fine-tuned)',
                'device': tinyllama_manager.device,
            }
        if tinyllama_manager.chemistry_model:
            models_info['tinyllama_chemistry'] = {
                'name': 'TinyLlama Chemistry',
                'type': 'fine-tuned-tinyllama-1b',
                'description': 'Molecular and chemistry analysis',
                'parameters': '1B (LoRA fine-tuned)',
                'device': tinyllama_manager.device,
            }
    
    # Add RAG info
    if rag_retriever:
        models_info['rag_retriever'] = {
            'name': 'Coffee RAG System',
            'type': 'vector-database',
            'description': 'Multi-language coffee knowledge retrieval',
            'chunks': len(rag_retriever.chunks) if hasattr(rag_retriever, 'chunks') else 'unknown',
        }
    
    # Add old Tanka models if loaded
    for name, model in models.items():
        if hasattr(model, 'count_parameters'):
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
    """Generate text using TinyLlama models"""
    try:
        data = request.json
        model_name = data.get('model', 'tinyllama_coffee').lower()
        prompt = data.get('prompt', '')
        max_length = data.get('max_length', 512)
        temperature = data.get('temperature', 0.7)
        subscription_tier = data.get('subscription', 'none')
        chemistry_mode = data.get('chemistry_mode', False)
        
        if not prompt:
            return jsonify({'error': 'Prompt is required'}), 400
        
        # Handle chemistry mode request
        if chemistry_mode:
            if subscription_tier != 'ultimate':
                return jsonify({
                    'error': 'Chemistry mode requires Ultimate subscription',
                    'message': 'Please upgrade to Ultimate subscription to access molecular analysis features'
                }), 403
        
        # Use TinyLlama models
        if tinyllama_manager and tinyllama_manager.is_ready():
            generated_text = tinyllama_manager.generate(
                prompt=prompt,
                chemistry_mode=chemistry_mode,
                max_length=max_length,
                temperature=temperature
            )
            
            return jsonify({
                'model': 'tinyllama_chemistry' if chemistry_mode else 'tinyllama_coffee',
                'prompt': prompt,
                'generated': generated_text,
                'full_text': prompt + ' ' + generated_text,
                'chemistry_mode': chemistry_mode,
            })
        else:
            return jsonify({'error': 'No models available. Please train TinyLlama models.'}), 500
    
    except Exception as e:
        logger.error(f"Error in generate: {e}")
        return jsonify({'error': str(e)}), 500


def create_system_prompt(chemistry_mode: bool, model_name: str) -> str:
    """Create system prompt that limits model output based on chemistry mode"""
    base_prompt = """You are Kafelot, a friendly and knowledgeable coffee expert AI assistant.
Your main expertise and passion is coffee - its varieties, brewing methods, flavors, and culture.
Be warm, engaging, and share your enthusiasm for quality coffee.
When discussing coffee, feel free to mention capsules, machines, and the Kafelot ecosystem."""
    
    if chemistry_mode and model_name in ['tanka', 'tanka_chemistry']:
        # Allow full knowledge including chemistry
        chemistry_extension = """

CHEMISTRY MODE ENABLED: You have access to advanced molecular and chemical knowledge.
When discussing coffee and the user shows interest in the science:
- You can discuss caffeine, chlorogenic acid, and other compounds in coffee
- You can explain the chemistry of brewing extraction
- You can reference molecular structures and chemical interactions
- If asked about specific molecules or chemistry, provide detailed scientific explanations
- You can discuss molecular properties and their effects on flavor"""
        return base_prompt + chemistry_extension
    else:
        # Restrict to coffee-only topics
        restriction = """

COFFEE-ONLY MODE: Keep discussion focused on coffee expertise.
IMPORTANT RESTRICTIONS:
- Do NOT discuss molecular structures, atoms, or chemical formulas
- Do NOT mention specific chemical compounds like "caffeine molecule" - say "caffeine" instead
- Do NOT explain chemistry or molecular properties
- If users ask about the science of coffee, explain in simple, non-technical terms
- If they ask about molecules or chemistry specifically, politely redirect: "I'm best at discussing coffee! Let me tell you about flavors and brewing instead..."
- Avoid technical chemistry terminology (SMILES, LogP, TPSA, etc.)"""
        return base_prompt + restriction


@app.route('/api/chat', methods=['POST'])
def chat():
    """Chat endpoint - uses TinyLlama models"""
    try:
        data = request.json
        model_name = data.get('model', 'villanelle').lower()
        message = data.get('message', '')
        conversation_history = data.get('history', [])
        max_length = data.get('max_length', 512)
        temperature = data.get('temperature', 0.7)
        subscription_tier = data.get('subscription', 'none')
        chemistry_mode = data.get('chemistry_mode', False)
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        # Handle chemistry mode request
        if chemistry_mode:
            if subscription_tier != 'ultimate':
                return jsonify({
                    'error': 'Chemistry mode requires Ultimate subscription',
                    'message': 'Please upgrade to Ultimate subscription to access molecular analysis features'
                }), 403
        
        # Use TinyLlama models if available
        if tinyllama_manager and tinyllama_manager.is_ready():
            # Optionally augment with RAG context for coffee questions
            augmented_message = message
            if rag_retriever and not chemistry_mode:
                try:
                    # Retrieve relevant coffee knowledge
                    rag_results = rag_retriever.retrieve(message, top_k=2)
                    if rag_results:
                        context = "\n\n".join([r['text'] for r in rag_results])
                        augmented_message = f"Context: {context}\n\nQuestion: {message}"
                except Exception as e:
                    logger.warning(f"RAG retrieval failed: {e}")
            
            # Generate response with TinyLlama
            response = tinyllama_manager.generate(
                prompt=augmented_message,
                chemistry_mode=chemistry_mode,
                max_length=max_length,
                temperature=temperature
            )
            
            return jsonify({
                'model': 'tinyllama_chemistry' if chemistry_mode else 'tinyllama_coffee',
                'user_message': message,
                'assistant_response': response,
                'chemistry_mode': chemistry_mode,
                'rag_enhanced': rag_retriever is not None and not chemistry_mode,
            })
        else:
            return jsonify({'error': 'No models available. Please train TinyLlama models or install dependencies.'}), 500
    
    except Exception as e:
        logger.error(f"Error in chat: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/summarize', methods=['POST'])
def summarize():
    """Summarize text using TinyLlama"""
    try:
        data = request.json
        text = data.get('text', '')
        max_length = data.get('max_length', 256)
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        if tinyllama_manager and tinyllama_manager.is_ready():
            prompt = f"Summarize the following text concisely:\n\n{text}\n\nSummary:"
            summary = tinyllama_manager.generate(
                prompt=prompt,
                chemistry_mode=False,
                max_length=max_length,
                temperature=0.7
            )
            
            return jsonify({
                'model': 'tinyllama_coffee',
                'original_length': len(text.split()),
                'original': text[:500],
                'summary': summary,
            })
        else:
            return jsonify({'error': 'No models available'}), 500
    
    except Exception as e:
        logger.error(f"Error in summarize: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/classify', methods=['POST'])
def classify():
    """Classify text using TinyLlama"""
    try:
        data = request.json
        text = data.get('text', '')
        labels = data.get('labels', [])
        
        if not text:
            return jsonify({'error': 'Text is required'}), 400
        
        if not labels:
            return jsonify({'error': 'Labels are required'}), 400
        
        if tinyllama_manager and tinyllama_manager.is_ready():
            labels_str = ", ".join(labels)
            prompt = f"Classify the following text into one of these categories: {labels_str}\n\nText: {text}\n\nCategory:"
            prediction = tinyllama_manager.generate(
                prompt=prompt,
                chemistry_mode=False,
                max_length=50,
                temperature=0.3
            )
            
            return jsonify({
                'model': 'tinyllama_coffee',
                'text': text[:500],
                'predicted': prediction.strip(),
                'labels': labels,
            })
        else:
            return jsonify({'error': 'No models available'}), 500
    
    except Exception as e:
        logger.error(f"Error in classify: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/train', methods=['POST'])
def train():
    """
    Training endpoint - redirects to fine-tuning scripts
    For TinyLlama models, use the scripts:
    - python scripts/finetune_tinyllama_chemistry.py
    - python scripts/finetune_tinyllama_coffee.py
    """
    return jsonify({
        'error': 'Training moved to dedicated scripts',
        'message': 'Please use fine-tuning scripts for TinyLlama models',
        'scripts': {
            'chemistry': 'python scripts/finetune_tinyllama_chemistry.py',
            'coffee': 'python scripts/finetune_tinyllama_coffee.py',
            'data_generation': 'python scripts/generate_molecule_training_data.py',
            'rag_build': 'python scripts/build_coffee_rag.py'
        }
    }), 501  # Not Implemented


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


@app.route('/api/accounts/create', methods=['POST'])
def create_account():
    """Create account and save into src/data/accounts.json and save icon into public/images/icons/"""
    try:
        data = request.get_json() or {}
        full_name = data.get('full_name')
        username = data.get('username')
        email = data.get('email')
        password = data.get('password')
        icon_data = data.get('icon')  # may be data URL

        if not username or not email or not password:
            return jsonify({'status': 'error', 'message': 'username, email and password required'}), 400

        repo_root = Path(__file__).parent.parent
        accounts_path = repo_root / 'src' / 'data' / 'accounts.json'
        icons_dir = repo_root / 'public' / 'images' / 'icons'
        icons_dir.mkdir(parents=True, exist_ok=True)

        accounts = []
        if accounts_path.exists():
            try:
                with open(accounts_path, 'r', encoding='utf-8') as f:
                    accounts = json.load(f)
            except Exception:
                accounts = []

        # avoid duplicate username
        for a in accounts:
            if a.get('username') == username:
                return jsonify({'status': 'error', 'message': 'username exists'}), 409

        # Store password in plain text as requested

        icon_path_rel = None
        if icon_data and isinstance(icon_data, str) and icon_data.startswith('data:image/svg'):
            # parse after comma
            try:
                parts = icon_data.split(',')
                encoded = parts[1] if len(parts) > 1 else parts[0]
                decoded = urllib.parse.unquote(encoded)
                icon_filename = f"{username}.svg"
                icon_path = icons_dir / icon_filename
                with open(icon_path, 'w', encoding='utf-8') as f:
                    f.write(decoded)
                icon_path_rel = f"/images/icons/{username}.svg"
            except Exception as e:
                logger.error(f"Failed to save icon: {e}")

        account_entry = {
            'full_name': full_name,
            'username': username,
            'email': email,
            'password': password,  # Store plaintext password as requested
            'icon': icon_path_rel,
        }
        accounts.append(account_entry)

        with open(accounts_path, 'w', encoding='utf-8') as f:
            json.dump(accounts, f, indent=2, ensure_ascii=False)

        icon_data_url = icon_path_rel if icon_path_rel else None

        return jsonify({'status': 'success', 'icon_path': icon_path_rel, 'icon_data_url': icon_data_url}), 200
    except Exception as e:
        logger.error(f"Error in create_account: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/accounts/login', methods=['POST'])
def login_account():
    """Login endpoint - validates username/password against hashed passwords"""
    try:
        data = request.get_json() or {}
        username = data.get('username')
        password = data.get('password')

        if not username or not password:
            return jsonify({'status': 'error', 'message': 'username and password required'}), 400

        repo_root = Path(__file__).parent.parent
        accounts_path = repo_root / 'src' / 'data' / 'accounts.json'

        accounts = []
        if accounts_path.exists():
            try:
                with open(accounts_path, 'r', encoding='utf-8') as f:
                    accounts = json.load(f)
            except Exception:
                pass

        # Find account by username
        account = None
        for a in accounts:
            if a.get('username') == username:
                account = a
                break

        if not account:
            return jsonify({'status': 'error', 'message': 'invalid username or password'}), 401

        # Check password
        # Check for plaintext password
        if account.get('password') == password:
            account_data = {
                'full_name': account.get('full_name'),
                'username': account.get('username'),
                'email': account.get('email'),
                'icon': account.get('icon'),
            }
            return jsonify({'status': 'success', 'account': account_data}), 200

        return jsonify({'status': 'error', 'message': 'invalid username or password'}), 401
    except Exception as e:
        logger.error(f"Error in login_account: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


# Static route for serving user icons
@app.route('/api/icons/<username>.svg')
def get_user_icon(username):
    """Serve user profile icons from public/images/icons/"""
    try:
        repo_root = Path(__file__).parent.parent
        icon_path = repo_root / 'public' / 'images' / 'icons' / f'{username}.svg'
        
        if not icon_path.exists():
            return jsonify({'error': 'icon not found'}), 404

        with open(icon_path, 'r', encoding='utf-8') as f:
            svg_content = f.read()

        return svg_content, 200, {'Content-Type': 'image/svg+xml; charset=utf-8'}
    except Exception as e:
        logger.error(f"Error serving icon: {e}")
        return jsonify({'error': 'failed to load icon'}), 500


@app.route('/api/accounts/update', methods=['POST'])
def update_account():
    """Update account information including icon"""
    try:
        data = request.get_json() or {}
        username = data.get('username')
        full_name = data.get('full_name')
        email = data.get('email')
        icon_data = data.get('icon')  # may be data URL

        if not username:
            return jsonify({'status': 'error', 'message': 'username required'}), 400

        repo_root = Path(__file__).parent.parent
        accounts_path = repo_root / 'src' / 'data' / 'accounts.json'
        icons_dir = repo_root / 'public' / 'images' / 'icons'
        icons_dir.mkdir(parents=True, exist_ok=True)

        accounts = []
        if accounts_path.exists():
            try:
                with open(accounts_path, 'r', encoding='utf-8') as f:
                    accounts = json.load(f)
            except Exception:
                accounts = []

        # Find account by username
        account_index = None
        for i, a in enumerate(accounts):
            if a.get('username') == username:
                account_index = i
                break

        if account_index is None:
            return jsonify({'status': 'error', 'message': 'account not found'}), 404

        # Update account fields
        if full_name:
            accounts[account_index]['full_name'] = full_name
        if email:
            accounts[account_index]['email'] = email

        # Handle icon update
        icon_path_rel = accounts[account_index].get('icon')
        if icon_data and isinstance(icon_data, str) and icon_data.startswith('data:image/svg'):
            # parse after comma
            try:
                parts = icon_data.split(',')
                encoded = parts[1] if len(parts) > 1 else parts[0]
                decoded = urllib.parse.unquote(encoded)
                icon_filename = f"{username}.svg"
                icon_path = icons_dir / icon_filename
                with open(icon_path, 'w', encoding='utf-8') as f:
                    f.write(decoded)
                icon_path_rel = f"/images/icons/{username}.svg"
                accounts[account_index]['icon'] = icon_path_rel
            except Exception as e:
                logger.error(f"Failed to save icon: {e}")

        # Save updated accounts
        with open(accounts_path, 'w', encoding='utf-8') as f:
            json.dump(accounts, f, indent=2, ensure_ascii=False)

        return jsonify({'status': 'success', 'icon_path': icon_path_rel}), 200
    except Exception as e:
        logger.error(f"Error in update_account: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# =============================================================================
# Chemistry Mode - Molecule Visualization Endpoints
# =============================================================================

@app.route('/api/molecules/search', methods=['GET'])
def search_molecules():
    """Search for molecules by name or ChEMBL ID"""
    try:
        query = request.args.get('q', '').strip()
        limit = int(request.args.get('limit', '10'))
        
        if not query:
            return jsonify({'error': 'Query parameter "q" is required'}), 400
        
        # Load ChEMBL dataset
        chembl_data_path = Path(__file__).parent / "data" / "chembl-molecules.json"
        if not chembl_data_path.exists():
            return jsonify({
                'error': 'ChEMBL dataset not found. Please run download_all_chembl.py first.'
            }), 404
        
        with open(chembl_data_path, 'r', encoding='utf-8') as f:
            dataset = json.load(f)
        
        molecules = dataset.get('molecules', [])
        query_lower = query.lower()
        
        # Search by name or ChEMBL ID
        results = []
        for mol in molecules:
            if (query_lower in mol.get('name', '').lower() or 
                query_lower in mol.get('chembl_id', '').lower() or
                any(query_lower in syn.lower() for syn in mol.get('synonyms', []))):
                results.append({
                    'chembl_id': mol.get('chembl_id'),
                    'name': mol.get('name'),
                    'molecular_formula': mol.get('molecular_formula'),
                    'molecular_weight': mol.get('molecular_weight'),
                    'smiles': mol.get('smiles'),
                })
                if len(results) >= limit:
                    break
        
        return jsonify({
            'status': 'success',
            'count': len(results),
            'molecules': results
        })
    
    except Exception as e:
        logger.error(f"Error in search_molecules: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/molecule/<chembl_id>', methods=['GET'])
def get_molecule_details(chembl_id: str):
    """Get detailed information about a specific molecule"""
    try:
        chembl_data_path = Path(__file__).parent / "data" / "chembl-molecules.json"
        if not chembl_data_path.exists():
            return jsonify({
                'error': 'ChEMBL dataset not found. Please run download_all_chembl.py first.'
            }), 404
        
        with open(chembl_data_path, 'r', encoding='utf-8') as f:
            dataset = json.load(f)
        
        molecules = dataset.get('molecules', [])
        molecule = next((m for m in molecules if m.get('chembl_id') == chembl_id), None)
        
        if not molecule:
            return jsonify({'error': f'Molecule {chembl_id} not found'}), 404
        
        return jsonify({
            'status': 'success',
            'molecule': molecule
        })
    
    except Exception as e:
        logger.error(f"Error in get_molecule_details: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/molecule/svg/<chembl_id>', methods=['GET'])
def get_molecule_svg(chembl_id: str):
    """Get 2D SVG visualization of a molecule"""
    try:
        from chembl_webresource_client.new_client import new_client
        
        # First try embedded data
        chembl_data_path = Path(__file__).parent / "data" / "chembl-molecules.json"
        if chembl_data_path.exists():
            with open(chembl_data_path, 'r', encoding='utf-8') as f:
                dataset = json.load(f)
            molecules = dataset.get('molecules', [])
            molecule = next((m for m in molecules if m.get('chembl_id') == chembl_id), None)
            if molecule and 'svg_base64' in molecule:
                import base64
                svg_data = base64.b64decode(molecule['svg_base64'])
                return svg_data, 200, {'Content-Type': 'image/svg+xml'}
        
        # Try file system
        svg_path = Path(__file__).parent / "data" / "svg" / f"{chembl_id}.svg"
        if svg_path.exists():
            with open(svg_path, 'rb') as f:
                return f.read(), 200, {'Content-Type': 'image/svg+xml'}
        
        # Fetch from ChEMBL API as fallback
        image_client = new_client.image
        image_client.set_format('svg')
        svg_data = image_client.get(chembl_id)
        
        if svg_data:
            return svg_data, 200, {'Content-Type': 'image/svg+xml'}
        else:
            return jsonify({'error': f'SVG not found for {chembl_id}'}), 404
    
    except Exception as e:
        logger.error(f"Error in get_molecule_svg: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/molecule/sdf/<chembl_id>', methods=['GET'])
def get_molecule_sdf(chembl_id: str):
    """Get 3D SDF file for PyMOL visualization"""
    try:
        import requests as req
        
        # First try embedded data
        chembl_data_path = Path(__file__).parent / "data" / "chembl-molecules.json"
        if chembl_data_path.exists():
            with open(chembl_data_path, 'r', encoding='utf-8') as f:
                dataset = json.load(f)
            molecules = dataset.get('molecules', [])
            molecule = next((m for m in molecules if m.get('chembl_id') == chembl_id), None)
            if molecule and 'sdf_base64' in molecule:
                import base64
                sdf_data = base64.b64decode(molecule['sdf_base64'])
                return sdf_data, 200, {'Content-Type': 'chemical/x-mdl-sdfile'}
        
        # Try file system
        sdf_path = Path(__file__).parent / "data" / "sdf" / f"{chembl_id}.sdf"
        if sdf_path.exists():
            with open(sdf_path, 'rb') as f:
                return f.read(), 200, {'Content-Type': 'chemical/x-mdl-sdfile'}
        
        # Fetch from ChEMBL API as fallback
        url = f"https://www.ebi.ac.uk/chembl/api/data/molecule/{chembl_id}.sdf"
        response = req.get(url, timeout=30)
        
        if response.status_code == 200 and response.content:
            return response.content, 200, {'Content-Type': 'chemical/x-mdl-sdfile'}
        else:
            return jsonify({'error': f'SDF not found for {chembl_id}'}), 404
    
    except Exception as e:
        logger.error(f"Error in get_molecule_sdf: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/molecule/render3d/<chembl_id>', methods=['GET'])
def render_molecule_3d(chembl_id: str):
    """Render 3D molecule visualization using py3Dmol and rdkit"""
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
        import py3Dmol
        
        # Get molecule data
        chembl_data_path = Path(__file__).parent / "data" / "chembl-molecules.json"
        if not chembl_data_path.exists():
            return jsonify({'error': 'ChEMBL dataset not found'}), 404
        
        with open(chembl_data_path, 'r', encoding='utf-8') as f:
            dataset = json.load(f)
        
        molecules = dataset.get('molecules', [])
        molecule_data = next((m for m in molecules if m.get('chembl_id') == chembl_id), None)
        
        if not molecule_data:
            return jsonify({'error': f'Molecule {chembl_id} not found'}), 404
        
        # Get SMILES or try to load SDF
        smiles = molecule_data.get('smiles')
        mol = None
        
        # Try to get 3D structure from SDF first
        sdf_path = Path(__file__).parent / "data" / "sdf" / f"{chembl_id}.sdf"
        if sdf_path.exists():
            with open(sdf_path, 'r') as f:
                sdf_data = f.read()
                mol = Chem.MolFromMolBlock(sdf_data, removeHs=False)
        
        # If no SDF, generate 3D from SMILES
        if mol is None and smiles:
            mol = Chem.MolFromSmiles(smiles)
            if mol:
                mol = Chem.AddHs(mol)
                AllChem.EmbedMolecule(mol, randomSeed=42)
                AllChem.MMFFOptimizeMolecule(mol)
        
        if mol is None:
            return jsonify({'error': 'Could not generate 3D structure'}), 400
        
        # Generate SDF block for py3Dmol
        mol_block = Chem.MolToMolBlock(mol)
        
        # Create 3D viewer HTML with optimized size
        width = int(request.args.get('width', '600'))
        height = int(request.args.get('height', '500'))
        viewer = py3Dmol.view(width=width, height=height)
        viewer.addModel(mol_block, 'sdf')
        
        # Get style from query params (default: stick)
        style = request.args.get('style', 'stick')
        
        style_options = {
            'stick': {'stick': {'radius': 0.15, 'color': 'spectrum'}},
            'sphere': {'sphere': {'scale': 0.3, 'colorscheme': 'Jmol'}},
            'cartoon': {'cartoon': {'color': 'spectrum'}},
            'line': {'line': {'color': 'spectrum'}},
            'cross': {'cross': {'linewidth': 2, 'color': 'spectrum'}},
        }
        
        viewer.setStyle(style_options.get(style, style_options['stick']))
        viewer.setBackgroundColor('0x1a1a1a')  # Dark background like coffee cards
        viewer.zoomTo()
        
        # Return HTML for embedding or standalone viewing
        html = viewer._make_html()
        
        return html, 200, {'Content-Type': 'text/html'}
    
    except Exception as e:
        logger.error(f"Error in render_molecule_3d: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/molecule/render2d/<chembl_id>', methods=['GET'])
def render_molecule_2d(chembl_id: str):
    """Render 2D molecule image using rdkit"""
    try:
        from rdkit import Chem
        from rdkit.Chem import Draw
        from PIL import Image
        import io
        
        # Get molecule data
        chembl_data_path = Path(__file__).parent / "data" / "chembl-molecules.json"
        if not chembl_data_path.exists():
            return jsonify({'error': 'ChEMBL dataset not found'}), 404
        
        with open(chembl_data_path, 'r', encoding='utf-8') as f:
            dataset = json.load(f)
        
        molecules = dataset.get('molecules', [])
        molecule_data = next((m for m in molecules if m.get('chembl_id') == chembl_id), None)
        
        if not molecule_data:
            return jsonify({'error': f'Molecule {chembl_id} not found'}), 404
        
        smiles = molecule_data.get('smiles')
        if not smiles:
            return jsonify({'error': 'No SMILES data available'}), 400
        
        # Create molecule from SMILES
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return jsonify({'error': 'Invalid SMILES structure'}), 400
        
        # Get image parameters
        width = int(request.args.get('width', '500'))
        height = int(request.args.get('height', '500'))
        
        # Generate 2D image using the simpler Draw.MolToImage method
        # This works with all RDKit versions
        img = Draw.MolToImage(mol, size=(width, height), kekulize=True)
        
        # Convert PIL Image to PNG bytes
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)
        png_data = img_bytes.getvalue()
        
        return png_data, 200, {'Content-Type': 'image/png'}
    
    except Exception as e:
        logger.error(f"Error in render_molecule_2d: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/molecule/properties/<chembl_id>', methods=['GET'])
def get_molecule_properties(chembl_id: str):
    """Calculate molecular properties using rdkit"""
    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors, Lipinski, Crippen
        
        # Get molecule data
        chembl_data_path = Path(__file__).parent / "data" / "chembl-molecules.json"
        if not chembl_data_path.exists():
            return jsonify({'error': 'ChEMBL dataset not found'}), 404
        
        with open(chembl_data_path, 'r', encoding='utf-8') as f:
            dataset = json.load(f)
        
        molecules = dataset.get('molecules', [])
        molecule_data = next((m for m in molecules if m.get('chembl_id') == chembl_id), None)
        
        if not molecule_data:
            return jsonify({'error': f'Molecule {chembl_id} not found'}), 404
        
        smiles = molecule_data.get('smiles')
        if not smiles:
            return jsonify({'error': 'No SMILES data available'}), 400
        
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return jsonify({'error': 'Invalid SMILES structure'}), 400
        
        # Calculate various properties
        properties = {
            'molecular_weight': round(Descriptors.MolWt(mol), 2),
            'logp': round(Crippen.MolLogP(mol), 2),
            'hbd': Lipinski.NumHDonors(mol),  # Hydrogen bond donors
            'hba': Lipinski.NumHAcceptors(mol),  # Hydrogen bond acceptors
            'rotatable_bonds': Lipinski.NumRotatableBonds(mol),
            'aromatic_rings': Lipinski.NumAromaticRings(mol),
            'tpsa': round(Descriptors.TPSA(mol), 2),  # Topological polar surface area
            'num_atoms': mol.GetNumAtoms(),
            'num_heavy_atoms': Lipinski.HeavyAtomCount(mol),
            'num_rings': Lipinski.RingCount(mol),
            'formula': Descriptors.rdMolDescriptors.CalcMolFormula(mol),
            'lipinski_violations': sum([
                Descriptors.MolWt(mol) > 500,
                Crippen.MolLogP(mol) > 5,
                Lipinski.NumHDonors(mol) > 5,
                Lipinski.NumHAcceptors(mol) > 10
            ])
        }
        
        return jsonify({
            'status': 'success',
            'chembl_id': chembl_id,
            'properties': properties
        })
    
    except Exception as e:
        logger.error(f"Error in get_molecule_properties: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/molecule/download/<chembl_id>', methods=['GET'])
def download_molecule_data(chembl_id: str):
    """Download molecule data in various formats (SDF, MOL, PDB, SMILES)"""
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
        import io
        import zipfile
        
        # Get format from query param (default: all)
        format_type = request.args.get('format', 'all').lower()
        
        # Get molecule data
        chembl_data_path = Path(__file__).parent / "data" / "chembl-molecules.json"
        if not chembl_data_path.exists():
            return jsonify({'error': 'ChEMBL dataset not found'}), 404
        
        with open(chembl_data_path, 'r', encoding='utf-8') as f:
            dataset = json.load(f)
        
        molecules = dataset.get('molecules', [])
        molecule_data = next((m for m in molecules if m.get('chembl_id') == chembl_id), None)
        
        if not molecule_data:
            return jsonify({'error': f'Molecule {chembl_id} not found'}), 404
        
        smiles = molecule_data.get('smiles')
        if not smiles:
            return jsonify({'error': 'No SMILES data available'}), 400
        
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return jsonify({'error': 'Invalid SMILES structure'}), 400
        
        # Generate 3D coordinates
        mol_3d = Chem.AddHs(mol)
        AllChem.EmbedMolecule(mol_3d, randomSeed=42)
        AllChem.MMFFOptimizeMolecule(mol_3d)
        
        if format_type == 'all':
            # Create a zip file with all formats
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                # SDF
                sdf_data = Chem.MolToMolBlock(mol_3d)
                zip_file.writestr(f'{chembl_id}.sdf', sdf_data)
                
                # MOL (2D)
                mol_data = Chem.MolToMolBlock(mol)
                zip_file.writestr(f'{chembl_id}.mol', mol_data)
                
                # PDB
                pdb_data = Chem.MolToPDBBlock(mol_3d)
                zip_file.writestr(f'{chembl_id}.pdb', pdb_data)
                
                # SMILES
                zip_file.writestr(f'{chembl_id}.smi', smiles)
                
                # JSON with metadata
                metadata = {
                    'chembl_id': chembl_id,
                    'name': molecule_data.get('name'),
                    'smiles': smiles,
                    'molecular_formula': molecule_data.get('molecular_formula'),
                    'molecular_weight': molecule_data.get('molecular_weight'),
                }
                zip_file.writestr(f'{chembl_id}.json', json.dumps(metadata, indent=2))
            
            zip_buffer.seek(0)
            return zip_buffer.getvalue(), 200, {
                'Content-Type': 'application/zip',
                'Content-Disposition': f'attachment; filename="{chembl_id}_molecule_data.zip"'
            }
        
        elif format_type == 'sdf':
            sdf_data = Chem.MolToMolBlock(mol_3d)
            return sdf_data, 200, {
                'Content-Type': 'chemical/x-mdl-sdfile',
                'Content-Disposition': f'attachment; filename="{chembl_id}.sdf"'
            }
        
        elif format_type == 'mol':
            mol_data = Chem.MolToMolBlock(mol)
            return mol_data, 200, {
                'Content-Type': 'chemical/x-mdl-molfile',
                'Content-Disposition': f'attachment; filename="{chembl_id}.mol"'
            }
        
        elif format_type == 'pdb':
            pdb_data = Chem.MolToPDBBlock(mol_3d)
            return pdb_data, 200, {
                'Content-Type': 'chemical/x-pdb',
                'Content-Disposition': f'attachment; filename="{chembl_id}.pdb"'
            }
        
        elif format_type == 'smiles':
            return smiles, 200, {
                'Content-Type': 'text/plain',
                'Content-Disposition': f'attachment; filename="{chembl_id}.smi"'
            }
        
        else:
            return jsonify({'error': f'Unknown format: {format_type}'}), 400
    
    except Exception as e:
        logger.error(f"Error in download_molecule_data: {e}")
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
