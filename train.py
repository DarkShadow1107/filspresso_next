"""
Training and Seeding Script for Filspresso AI

Usage:
  python train.py           # seed database only
  python train.py --train   # fine-tune MiniLM, then seed database
"""

import os
import sys
import json
import logging
import psycopg2
from pathlib import Path
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer, InputExample, losses
from torch.utils.data import DataLoader
from models.tanka import TankaModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

env_path = Path(__file__).parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).parent / ".env.local"
load_dotenv(dotenv_path=env_path)

DB_CONFIG = {
    "dbname": os.getenv("DB_NAME", "filspresso"),
    "user": os.getenv("DB_USER", "filspresso_user"),
    "password": os.getenv("DB_PASSWORD", "filspresso_secure_2024"),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
}

DATA_DIR = Path(__file__).parent / "data"
TRAINING_DIR = DATA_DIR / "training"


def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)


def fine_tune_model():
    """Fine-tune MiniLM on the local JSONL training data."""
    logger.info("Starting fine-tuning process...")

    model = SentenceTransformer("all-MiniLM-L6-v2")
    train_examples = []

    coffee_train_path = TRAINING_DIR / "coffee_train.jsonl"
    if coffee_train_path.exists():
        with open(coffee_train_path, "r", encoding="utf-8") as f:
            for line in f:
                data = json.loads(line)
                text = data.get("text", "")
                if "<|assistant|>" in text:
                    content = text.split("<|assistant|>")[1].replace("</s>", "").strip()
                    train_examples.append(InputExample(texts=[content, content]))

    mol_train_path = TRAINING_DIR / "molecules_train.jsonl"
    if mol_train_path.exists():
        with open(mol_train_path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                if i > 1000:
                    break
                data = json.loads(line)
                prompt = data.get("prompt", "")
                response = data.get("response", "")
                train_examples.append(InputExample(texts=[prompt, response]))

    if not train_examples:
        logger.warning("No training examples found. Skipping fine-tuning.")
        return

    train_dataloader = DataLoader(train_examples, shuffle=True, batch_size=16)
    train_loss = losses.MultipleNegativesRankingLoss(model=model)

    logger.info("Training on %d examples...", len(train_examples))
    model.fit(train_objectives=[(train_dataloader, train_loss)], epochs=1, warmup_steps=100)

    save_path = Path(__file__).parent / "models" / "fine_tuned_minilm"
    save_path.mkdir(parents=True, exist_ok=True)
    model.save(str(save_path))
    logger.info("Fine-tuned model saved to %s", save_path)


def seed_database():
    """Seed the PostgreSQL database with vectorized facts from training data."""
    logger.info("Seeding database with knowledge facts...")

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        cur.execute("DELETE FROM coffee_facts")

        tanka = TankaModel()
        facts_count = 0

        coffee_path = TRAINING_DIR / "coffee.jsonl"
        if coffee_path.exists():
            with open(coffee_path, "r", encoding="utf-8") as f:
                for line in f:
                    data = json.loads(line)
                    text = data.get("text", "")
                    if "<|assistant|>" in text:
                        content = text.split("<|assistant|>")[1].replace("</s>", "").strip()
                        for chunk in [content[i:i + 500] for i in range(0, len(content), 500)]:
                            embedding = tanka.encode(chunk)
                            cur.execute("INSERT INTO coffee_facts (fact, embedding) VALUES (%s, %s)", (chunk, embedding))
                            facts_count += 1

        mol_path = TRAINING_DIR / "molecules.jsonl"
        if mol_path.exists():
            with open(mol_path, "r", encoding="utf-8") as f:
                for i, line in enumerate(f):
                    if i >= 500:
                        break
                    data = json.loads(line)
                    fact = f"Q: {data.get('prompt')} A: {data.get('response')}"
                    embedding = tanka.encode(fact)
                    cur.execute("INSERT INTO coffee_facts (fact, embedding) VALUES (%s, %s)", (fact, embedding))
                    facts_count += 1

        conn.commit()
        cur.close()
        conn.close()
        logger.info("Seeding complete: %d facts stored.", facts_count)

    except Exception as exc:
        logger.error("Seeding failed: %s", exc)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--train":
        fine_tune_model()
    seed_database()
