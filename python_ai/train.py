"""
Training and Seeding Script for Filspresso AI
- Fine-tunes the SentenceTransformer (MiniLM) on local data
- Seeds the PostgreSQL pgvector database with knowledge facts
"""

import os
import json
import logging
import psycopg2
from pathlib import Path
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer, InputExample, losses
from torch.utils.data import DataLoader
from ai_models import CoffeeEmbeddingModel

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

DB_NAME = os.getenv("DB_NAME", "filspresso")
DB_USER = os.getenv("DB_USER", "filspresso_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "filspresso_secure_2024")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")

DATA_DIR = Path(__file__).parent / "data"
TRAINING_DIR = DATA_DIR / "training"
RAG_DIR = DATA_DIR / "rag"

def get_db_connection():
    return psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT
    )

def fine_tune_model():
    """Fine-tune the MiniLM model on the provided JSONL data"""
    logger.info("🚀 Starting fine-tuning process...")
    
    model = SentenceTransformer('all-MiniLM-L6-v2')
    train_examples = []
    
    # Load coffee training data
    coffee_train_path = TRAINING_DIR / "coffee_train.jsonl"
    if coffee_train_path.exists():
        with open(coffee_train_path, 'r', encoding='utf-8') as f:
            for line in f:
                data = json.loads(line)
                # Extract text from the <|assistant|> section
                text = data.get('text', '')
                if "Assistant" in text or "<|assistant|>" in text:
                    parts = text.split("<|assistant|>")
                    if len(parts) > 1:
                        content = parts[1].replace("</s>", "").strip()
                        # For unsupervised/self-supervised fine-tuning, we can use the same text twice
                        # or use MultipleNegativesRankingLoss if we had pairs.
                        # Here we'll just use a simple approach for demonstration.
                        train_examples.append(InputExample(texts=[content, content]))

    # Load molecule training data
    mol_train_path = TRAINING_DIR / "molecules_train.jsonl"
    if mol_train_path.exists():
        with open(mol_train_path, 'r', encoding='utf-8') as f:
            for i, line in enumerate(f):
                if i > 1000: break # Limit for demo
                data = json.loads(line)
                prompt = data.get('prompt', '')
                response = data.get('response', '')
                train_examples.append(InputExample(texts=[prompt, response]))

    if not train_examples:
        logger.warning("⚠️ No training examples found. Skipping fine-tuning.")
        return

    train_dataloader = DataLoader(train_examples, shuffle=True, batch_size=16)
    train_loss = losses.MultipleNegativesRankingLoss(model=model)

    logger.info(f"📊 Training on {len(train_examples)} examples...")
    model.fit(train_objectives=[(train_dataloader, train_loss)], epochs=1, warmup_steps=100)
    
    # Save the fine-tuned model locally
    model_save_path = Path(__file__).parent / "models" / "fine_tuned_minilm"
    model_save_path.mkdir(parents=True, exist_ok=True)
    model.save(str(model_save_path))
    logger.info(f"✅ Model saved to {model_save_path}")

def seed_database():
    """Seed the PostgreSQL database with facts from the training data"""
    logger.info("🌱 Seeding database with knowledge facts...")
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Ensure vector extension is enabled
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        
        # Clear existing facts (optional, or just append)
        cur.execute("DELETE FROM coffee_facts")
        
        model = CoffeeEmbeddingModel()
        
        # 1. Seed from coffee.jsonl
        coffee_path = TRAINING_DIR / "coffee.jsonl"
        facts_count = 0
        
        if coffee_path.exists():
            with open(coffee_path, 'r', encoding='utf-8') as f:
                for line in f:
                    data = json.loads(line)
                    text = data.get('text', '')
                    if "<|assistant|>" in text:
                        content = text.split("<|assistant|>")[1].replace("</s>", "").strip()
                        # Split into smaller chunks if too long
                        chunks = [content[i:i+500] for i in range(0, len(content), 500)]
                        for chunk in chunks:
                            embedding = model.encode(chunk)
                            cur.execute("INSERT INTO coffee_facts (fact, embedding) VALUES (%s, %s)", (chunk, embedding))
                            facts_count += 1
        
        # 2. Seed from molecules.jsonl (first 500 for RAG)
        mol_path = TRAINING_DIR / "molecules.jsonl"
        if mol_path.exists():
            with open(mol_path, 'r', encoding='utf-8') as f:
                for i, line in enumerate(f):
                    if i >= 500: break
                    data = json.loads(line)
                    fact = f"Q: {data.get('prompt')} A: {data.get('response')}"
                    embedding = model.encode(fact)
                    cur.execute("INSERT INTO coffee_facts (fact, embedding) VALUES (%s, %s)", (fact, embedding))
                    facts_count += 1

        conn.commit()
        cur.close()
        conn.close()
        logger.info(f"✅ Seeding complete! {facts_count} facts vectorized and stored in PostgreSQL.")
        
    except Exception as e:
        logger.error(f"❌ Seeding failed: {e}")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--train":
        fine_tune_model()
    
    seed_database()
