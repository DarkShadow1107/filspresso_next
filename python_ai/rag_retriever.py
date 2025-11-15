"""
RAG Retriever - Search coffee knowledge base and return relevant chunks
"""

import json
import numpy as np
from pathlib import Path
from typing import List
from sentence_transformers import SentenceTransformer
import faiss

class CoffeeRAGRetriever:
    """Retriever for coffee knowledge base"""
    
    def __init__(self, rag_dir: Path = None):
        if rag_dir is None:
            rag_dir = Path(__file__).parent.parent / "rag_data"
        
        self.rag_dir = rag_dir
        self.model = None
        self.chunks = None
        self.index = None
        
        self._load()
    
    def _load(self):
        """Load chunks, embeddings, and FAISS index"""
        # Load chunks
        chunks_path = self.rag_dir / "coffee_chunks.json"
        if not chunks_path.exists():
            raise FileNotFoundError(f"Chunks not found at {chunks_path}. Run build_coffee_rag.py first!")
        
        with open(chunks_path, 'r', encoding='utf-8') as f:
            self.chunks = json.load(f)
        
        # Load FAISS index
        index_path = self.rag_dir / "coffee_faiss.index"
        if not index_path.exists():
            raise FileNotFoundError(f"FAISS index not found at {index_path}")
        
        self.index = faiss.read_index(str(index_path))
        
        # Load embedding model
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
        
        print(f"✅ RAG retriever loaded: {len(self.chunks)} chunks indexed")
    
    def retrieve(self, query: str, top_k: int = 3) -> List[dict]:
        """
        Retrieve top-k most relevant chunks for a query
        
        Args:
            query: User query string
            top_k: Number of chunks to return
        
        Returns:
            List of dicts with 'text' and 'score' keys
        """
        # Encode query
        query_embedding = self.model.encode([query])
        
        # Search FAISS index
        distances, indices = self.index.search(query_embedding.astype('float32'), top_k)
        
        # Return results
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            results.append({
                'text': self.chunks[idx],
                'score': float(dist),
                'index': int(idx)
            })
        
        return results
    
    def format_context(self, results: List[dict]) -> str:
        """Format retrieved chunks as context for LLM"""
        context = "Context from coffee knowledge base:\n\n"
        for i, result in enumerate(results, 1):
            context += f"[Excerpt {i}]\n{result['text']}\n\n"
        return context

# Example usage
if __name__ == "__main__":
    retriever = CoffeeRAGRetriever()
    
    # Test query
    query = "Tell me about caffeine in coffee"
    results = retriever.retrieve(query, top_k=3)
    
    print(f"Query: {query}\n")
    print(f"Top {len(results)} results:\n")
    for i, result in enumerate(results, 1):
        print(f"{i}. Score: {result['score']:.4f}")
        print(f"   {result['text'][:200]}...\n")
    
    print("\n" + "="*60)
    print("Context formatted for LLM:")
    print(retriever.format_context(results))
