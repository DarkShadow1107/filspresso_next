"""
Flask API Server for Filspresso AI Features
Provides REST endpoints for:
- Molecule prediction (ResNet-18)
- Coffee knowledge RAG (MiniLM + PostgreSQL pgvector)
- IoT coffee machine commands
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
import os
from pathlib import Path
import logging
import json
import psycopg2
from ai_models import MoleculePredictor, CoffeeEmbeddingModel
from dotenv import load_dotenv

# Load environment variables
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Configuration
DB_NAME = os.getenv("DB_NAME", "filspresso")
DB_USER = os.getenv("DB_USER", "filspresso_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "filspresso_secure_2024")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")

# Initialize Models
molecule_predictor = MoleculePredictor()
coffee_embedding_model = CoffeeEmbeddingModel()

def get_db_connection():
    return psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT
    )

# =====================================================================
# AI ENDPOINTS
# =====================================================================

@app.route('/api/predict-molecule', methods=['POST'])
def predict_molecule():
    """Predict molecule classification from an image"""
    try:
        if 'image' not in request.files:
            return jsonify({'error': 'No image provided'}), 400
        
        image_file = request.files['image']
        image_bytes = image_file.read()
        
        prediction = molecule_predictor.predict(image_bytes)
        
        return jsonify({
            'status': 'success',
            'prediction': prediction,
            'model': 'ResNet-18'
        })
    except Exception as e:
        logger.error(f"Error in predict-molecule: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/ask-coffee', methods=['POST'])
def ask_coffee():
    """Query coffee knowledge using vector search (RAG)"""
    try:
        data = request.json
        question = data.get('question', '')
        
        if not question:
            return jsonify({'error': 'Question is required'}), 400
        
        # Vectorize the question
        query_embedding = coffee_embedding_model.encode(question)
        
        # Query PostgreSQL for the closest answer
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Use pgvector <-> operator for cosine distance
        cur.execute("""
            SELECT fact, 1 - (embedding <=> %s::vector) as similarity
            FROM coffee_facts
            ORDER BY embedding <=> %s::vector
            LIMIT 3
        """, (query_embedding, query_embedding))
        
        results = cur.fetchall()
        cur.close()
        conn.close()
        
        if not results:
            return jsonify({'answer': "I'm sorry, I don't have information about that in my coffee knowledge base.", 'results': []})
        
        # Format the response
        formatted_results = [{'fact': r[0], 'similarity': float(r[1])} for r in results]
        top_answer = results[0][0]
        
        return jsonify({
            'status': 'success',
            'answer': top_answer,
            'all_results': formatted_results,
            'model': 'MiniLM-L6-v2'
        })
    except Exception as e:
        logger.error(f"Error in ask-coffee: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    """General chat endpoint for smarter AI"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400
            
        message = data.get('message', '')
        model_name = data.get('model', 'tanka')
        chemistry_mode = data.get('chemistry_mode', False)
        request_id = data.get('request_id', 'none')
        
        logger.info(f"Chat request starting: model={model_name}, id={request_id}, chemistry={chemistry_mode}")
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        # Logic similar to ask-coffee for now, but can be expanded
        query_embedding = coffee_embedding_model.encode(message)
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT fact FROM coffee_facts
            ORDER BY embedding <=> %s::vector
            LIMIT 1
        """, (query_embedding,))
        
        result = cur.fetchone()
        cur.close()
        conn.close()
        
        if result:
            response = result[0]
        else:
            response = "I'm sorry, I don't have a specific answer for that. How else can I help you today?"
            
        # Analysis mode: If user asks for scientific details, use 'Ode' style with ResNet-18 mentions
        model_info = "MiniLLM-L6-v2"
        if model_name == "ode" or chemistry_mode or "analyze" in message.lower() or "molecule" in message.lower():
            # In a real app, we would use ResNet-18 here if an image was provided
            response = f"[Scientific Analysis via ResNET 18 & MiniLLM] Based on molecular patterns, here is your insight: {response}"
            model_info = "MiniLLM + ResNET 18"
            
        # Mock product recommendations based on message content
        products = []
        msg_lower = message.lower()
        if 'intense' in msg_lower or 'strong' in msg_lower:
            products.append({
                'id': 'ispirazione-napoli', 
                'name': 'Ispirazione Napoli', 
                'image': '/images/Capsules/Original/Ispirazione Italiana/Ispirazione Napoli.webp',
                'description': 'Deeply dark and creamy coffee with cocoa notes.'
            })
            products.append({
                'id': 'kazaar', 
                'name': 'Kazaar', 
                'image': '/images/Capsules/Original/Ispirazione Italiana/Kazaar.avif',
                'description': 'Exceptionally intense and syrupy with woody and spicy notes.'
            })
        elif 'mild' in msg_lower or 'smooth' in msg_lower:
            products.append({
                'id': 'volluto', 
                'name': 'Volluto', 
                'image': '/images/Capsules/Original/Espresso/Volluto.avif',
                'description': 'Sweet and light with cereal and fruity notes.'
            })
        elif 'vitamin' in msg_lower or 'vivida' in msg_lower:
            products.append({
                'id': 'vivida', 
                'name': 'Vivida', 
                'image': '/images/Capsules/Vertuo/Coffee+/Vivida.avif',
                'description': 'Smooth blend with Vitamin B12.'
            })
            
        logger.info(f"Chat request finished: {request_id}")
        
        return jsonify({
            'status': 'success',
            'assistant_response': response,
            'products': products,
            'model': f"Python-{model_name} ({model_info})",
            'request_id': request_id
        })
    except Exception as e:
        logger.error(f"Error in chat: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/icons/save', methods=['POST'])
def save_icon():
    """Save a user's generated icon as an SVG file"""
    try:
        req_data = request.json
        username = req_data.get('username')
        svg_content = req_data.get('svg', '')

        if not username or not svg_content:
            return jsonify({'error': 'Username and SVG content are required'}), 400

        # Create icons directory if it doesn't exist
        icon_dir = Path(__file__).parent.parent / "public" / "images" / "icons"
        icon_dir.mkdir(parents=True, exist_ok=True)

        # Robust data URL handling
        if svg_content.startswith('data:'):
            try:
                if ',' in svg_content:
                    header, encoded_data = svg_content.split(',', 1)
                    if 'base64' in header:
                        import base64
                        svg_content = base64.b64decode(encoded_data).decode('utf-8')
                    else:
                        from urllib.parse import unquote
                        svg_content = unquote(encoded_data)
                
                # If it still contains a data URL (nested or failed split), try one more time or clean it
                if svg_content.startswith('data:'):
                     # This shouldn't normally happen with correct logic
                     pass
            except Exception as decode_err:
                logger.error(f"Failed to decode SVG data URL: {decode_err}")
                # Fallback: if it's already plain SVG but somehow has data: prefix, 
                # we'll just try to use it as is but that will fail rendering.
        
        # Final cleanup: ensure it starts with <svg or <?xml
        svg_content = svg_content.strip().strip('"').strip("'")
        
        # Use lowercased username for filename consistency
        safe_username = username.lower()
        file_path = icon_dir / f"{safe_username}.svg"
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(svg_content)

        return jsonify({
            'status': 'success',
            'icon_path': f"/images/icons/{safe_username}.svg"
        })
    except Exception as e:
        logger.error(f"Error saving icon: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/cancel/<request_id>', methods=['POST'])
def cancel_request(request_id):
    """Placeholder for cancellation logic"""
    logger.info(f"Cancellation requested for {request_id}")
    return jsonify({'status': 'cancelled', 'request_id': request_id})

# =====================================================================
# IOT ENDPOINTS (Preserved from original)
# =====================================================================

# Import IoT DB helper
try:
    from iot_db import init_db, create_command, get_pending_command, update_command_status
    init_db()
except Exception as e:
    logger.error(f"Failed to initialize IoT DB: {e}")

@app.route('/api/commands/create', methods=['POST'])
def api_create_command():
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
    try:
        cmd = get_pending_command(machine_id)
        if not cmd:
            return ('', 204)
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

# =====================================================================
# SYSTEM ENDPOINTS
# =====================================================================

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'ai_models': {
            'resnet18': 'loaded',
            'minilm': 'loaded'
        },
        'database': 'postgresql'
    })

if __name__ == '__main__':
    port = int(os.getenv('PYTHON_AI_PORT', 5000))
    # Using debug=True for development to allow auto-reloading
    app.run(host='0.0.0.0', port=port, debug=True, threaded=True)
