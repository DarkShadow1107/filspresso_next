"""
RAG (Retrieval-Augmented Generation) system for coffee PDF
Chunks PDF, creates embeddings, stores in vector database (FAISS)
"""

import json
from pathlib import Path
from typing import List, Tuple
import numpy as np

# PDF processing
try:
    from PyPDF2 import PdfReader
except ImportError:
    print("Installing PyPDF2...")
    import subprocess
    subprocess.check_call(["pip", "install", "PyPDF2"])
    from PyPDF2 import PdfReader

# Embeddings
try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("Installing sentence-transformers...")
    import subprocess
    subprocess.check_call(["pip", "install", "sentence-transformers"])
    from sentence_transformers import SentenceTransformer

# Vector database
try:
    import faiss
except ImportError:
    print("Installing faiss-cpu...")
    import subprocess
    subprocess.check_call(["pip", "install", "faiss-cpu"])
    import faiss

print("☕ Coffee PDF RAG System (Multi-language)")
print("=" * 60)

# Configuration
DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_DIR = Path(__file__).parent.parent / "rag_data"
CHUNK_SIZE = 500  # Characters per chunk
OVERLAP = 100  # Overlap between chunks

# Multiple PDF files for different languages
PDF_FILES = [
    "coffee_english.pdf",
    "coffee_chinese.pdf",
    "coffee_deutch.pdf",
    "coffee_french.pdf",
    "coffee_japanese.pdf",
    "coffee_spanish.pdf"
]

# Check which PDFs exist
AVAILABLE_PDFS = [(DATA_DIR / pdf) for pdf in PDF_FILES if (DATA_DIR / pdf).exists()]

if not AVAILABLE_PDFS:
    print(f"❌ Error: No coffee PDFs found in {DATA_DIR}")
    print(f"   Expected files: {', '.join(PDF_FILES)}")
    exit(1)

print(f"\n📚 Found {len(AVAILABLE_PDFS)} coffee PDF(s):")
for pdf_path in AVAILABLE_PDFS:
    print(f"   - {pdf_path.name}")

OUTPUT_DIR.mkdir(exist_ok=True)

def extract_text_from_pdf(pdf_path: Path) -> str:
    """Extract all text from PDF"""
    print(f"\n📄 Reading PDF: {pdf_path.name}")
    reader = PdfReader(pdf_path)
    text = ""
    for i, page in enumerate(reader.pages):
        text += page.extract_text()
        if (i + 1) % 10 == 0:
            print(f"   Processed {i + 1}/{len(reader.pages)} pages...")
    print(f"✅ Extracted {len(text)} characters from {len(reader.pages)} pages")
    return text

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = OVERLAP) -> List[str]:
    """Split text into overlapping chunks"""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        
        # Try to break at sentence boundary
        if end < len(text):
            last_period = chunk.rfind('.')
            last_newline = chunk.rfind('\n')
            break_point = max(last_period, last_newline)
            if break_point > chunk_size * 0.5:  # Only break if not too early
                chunk = chunk[:break_point + 1]
                end = start + break_point + 1
        
        chunks.append(chunk.strip())
        start = end - overlap
    
    print(f"📝 Created {len(chunks)} chunks (size: {chunk_size}, overlap: {overlap})")
    return chunks

def create_embeddings(chunks: List[str]) -> np.ndarray:
    """Create embeddings using sentence-transformers"""
    print("\n🧠 Loading embedding model (all-MiniLM-L6-v2)...")
    model = SentenceTransformer('all-MiniLM-L6-v2')
    
    print(f"⚙️ Creating embeddings for {len(chunks)} chunks...")
    embeddings = model.encode(chunks, show_progress_bar=True)
    
    print(f"✅ Created embeddings: shape {embeddings.shape}")
    return embeddings

def build_faiss_index(embeddings: np.ndarray):
    """Build FAISS index for fast similarity search"""
    print("\n🗂️ Building FAISS index...")
    dimension = embeddings.shape[1]
    index = faiss.IndexFlatL2(dimension)  # L2 distance
    index.add(embeddings.astype('float32'))
    print(f"✅ FAISS index built: {index.ntotal} vectors")
    return index

def save_rag_data(chunks: List[str], embeddings: np.ndarray, index):
    """Save chunks, embeddings, and FAISS index"""
    print(f"\n💾 Saving RAG data to {OUTPUT_DIR}...")
    
    # Save chunks as JSON
    chunks_path = OUTPUT_DIR / "coffee_chunks.json"
    with open(chunks_path, 'w', encoding='utf-8') as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)
    print(f"   ✅ Chunks saved: {chunks_path}")
    
    # Save embeddings as numpy array
    embeddings_path = OUTPUT_DIR / "coffee_embeddings.npy"
    np.save(embeddings_path, embeddings)
    print(f"   ✅ Embeddings saved: {embeddings_path}")
    
    # Save FAISS index
    index_path = OUTPUT_DIR / "coffee_faiss.index"
    faiss.write_index(index, str(index_path))
    print(f"   ✅ FAISS index saved: {index_path}")

# Main processing pipeline
print("\n🚀 Starting RAG pipeline...")
print("=" * 60)

# Process all PDFs
all_chunks = []
for pdf_path in AVAILABLE_PDFS:
    language = pdf_path.stem.replace("coffee_", "")
    print(f"\n📖 Processing {pdf_path.name} ({language})...")
    
    # Step 1: Extract text
    pdf_text = extract_text_from_pdf(pdf_path)
    print(f"   Extracted {len(pdf_text)} characters")
    
    # Step 2: Chunk text
    chunks = chunk_text(pdf_text)
    print(f"   Created {len(chunks)} chunks")
    
    # Tag chunks with language
    tagged_chunks = [f"[Language: {language}] {chunk}" for chunk in chunks]
    all_chunks.extend(tagged_chunks)

print(f"\n✅ Total chunks from all PDFs: {len(all_chunks)}")

# Step 3: Create embeddings
embeddings = create_embeddings(all_chunks)

# Step 4: Build FAISS index
index = build_faiss_index(embeddings)

# Step 5: Save everything
save_rag_data(all_chunks, embeddings, index)

print("\n" + "=" * 60)
print("✅ RAG system ready!")
print(f"📊 Statistics:")
print(f"   PDFs processed: {len(AVAILABLE_PDFS)}")
print(f"   Total pages: {sum([len(PdfReader(pdf).pages) for pdf in AVAILABLE_PDFS])}")
print(f"   Total chunks: {len(all_chunks)}")
print(f"   Embedding dimension: {embeddings.shape[1]}")
print("\n💡 Use rag_retriever.py to search this knowledge base!")
