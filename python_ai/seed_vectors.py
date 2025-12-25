import psycopg2
from ai_models import CoffeeEmbeddingModel
import os
from dotenv import load_dotenv
from pathlib import Path

# Load .env from root
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

DB_NAME = os.getenv("DB_NAME", "filspresso")
DB_USER = os.getenv("DB_USER", "filspresso_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "filspresso_secure_2024")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")

COFFEE_FACTS = [
    "Light roast coffee has a light brown color and no oil on the surface of the beans. It has the highest acidity and preserves the most original flavor of the bean.",
    "Medium roast coffee is medium brown in color with a bit more body than a light roast. It has a balanced flavor, aroma, and acidity.",
    "Dark roast coffee is dark brown, sometimes almost black, with a shiny, oily surface. It has a low acidity and a heavy body with smoky or bitter notes.",
    "The roasting process transforms green coffee beans into the aromatic brown beans we know through the Maillard reaction.",
    "Espresso is typically made with a dark roast to provide a strong, bold flavor that can cut through milk in lattes and cappuccinos.",
    "Arabica beans are generally considered higher quality and have a sweeter, softer taste with tones of sugar, fruit, and berries.",
    "Robusta beans have a stronger, harsher taste with twice as much caffeine as Arabica. They are often used in espresso blends for better crema.",
    "Coffee roasting involves heating the beans to temperatures between 370 and 540 degrees Fahrenheit (188 to 282 degrees Celsius).",
    "The 'first crack' in roasting occurs around 385°F (196°C) when the beans expand and moisture evaporates, sounding like popcorn popping.",
    "The 'second crack' occurs around 435°F (224°C), indicating a darker roast as the bean's internal structure begins to break down and oils migrate to the surface."
]

def seed():
    try:
        conn = psycopg2.connect(
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT
        )
        cur = conn.cursor()
        
        # Ensure vector extension is enabled
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        
        # Create table if not exists
        cur.execute("DROP TABLE IF EXISTS coffee_facts")
        cur.execute("""
            CREATE TABLE coffee_facts (
                id SERIAL PRIMARY KEY,
                fact TEXT NOT NULL,
                embedding vector(384)
            )
        """)
        
        model = CoffeeEmbeddingModel()
        
        print("Vectorizing facts...")
        for fact in COFFEE_FACTS:
            embedding = model.encode(fact)
            cur.execute("INSERT INTO coffee_facts (fact, embedding) VALUES (%s, %s)", (fact, embedding))
        
        conn.commit()
        cur.close()
        conn.close()
        print("✅ Seeding complete! 10 coffee facts vectorized and stored.")
    except Exception as e:
        print(f"❌ Seeding failed: {e}")

if __name__ == "__main__":
    seed()
