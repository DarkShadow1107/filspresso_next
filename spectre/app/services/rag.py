from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DocumentChunk, Source, SourceVersion
from app.services.model_client import embed_with_minilm


@dataclass(frozen=True)
class RetrievalHit:
    chunk_id: UUID
    source_version_id: UUID
    source_url: str
    source_title: str | None
    content: str
    semantic_score: float | None
    lexical_rank: int | None
    fusion_score: float


async def embed_chunks_for_version(db: AsyncSession, source_version_id: UUID) -> int:
    rows = await db.scalars(
        select(DocumentChunk)
        .where(
            DocumentChunk.source_version_id == source_version_id, DocumentChunk.embedding.is_(None)
        )
        .order_by(DocumentChunk.ordinal)
    )
    chunks = list(rows)
    if not chunks:
        return 0
    vectors = await embed_with_minilm([chunk.content for chunk in chunks])
    if vectors is None:
        return 0
    for chunk, vector in zip(chunks, vectors, strict=True):
        if len(vector) != 384:
            raise ValueError(f"MiniLM vector dimension mismatch: expected 384, got {len(vector)}")
        chunk.embedding = vector
    await db.flush()
    return len(chunks)


async def hybrid_retrieve(
    db: AsyncSession,
    *,
    organization_id: UUID,
    query: str,
    limit: int = 8,
) -> list[RetrievalHit]:
    """Fuse pgvector cosine retrieval with PostgreSQL full-text search using RRF."""
    candidate_limit = max(limit * 4, 20)
    semantic_rows: list[tuple[DocumentChunk, SourceVersion, Source, float]] = []
    vector = await embed_with_minilm([query])
    if vector:
        distance = DocumentChunk.embedding.cosine_distance(vector[0]).label("distance")
        result = await db.execute(
            select(DocumentChunk, SourceVersion, Source, distance)
            .join(SourceVersion, SourceVersion.id == DocumentChunk.source_version_id)
            .join(Source, Source.id == SourceVersion.source_id)
            .where(
                DocumentChunk.organization_id == organization_id,
                DocumentChunk.embedding.is_not(None),
            )
            .order_by(distance)
            .limit(candidate_limit)
        )
        semantic_rows = list(result.all())

    lexical_expression = func.to_tsvector("english", DocumentChunk.content)
    ts_query = func.websearch_to_tsquery("english", query)
    lexical_rank_value = func.ts_rank_cd(lexical_expression, ts_query).label("lexical_rank")
    lexical_result = await db.execute(
        select(DocumentChunk, SourceVersion, Source, lexical_rank_value)
        .join(SourceVersion, SourceVersion.id == DocumentChunk.source_version_id)
        .join(Source, Source.id == SourceVersion.source_id)
        .where(
            DocumentChunk.organization_id == organization_id, lexical_expression.op("@@")(ts_query)
        )
        .order_by(lexical_rank_value.desc())
        .limit(candidate_limit)
    )
    lexical_rows = list(lexical_result.all())

    ranked: dict[UUID, dict[str, object]] = defaultdict(dict)
    for index, (chunk, version, source, distance) in enumerate(semantic_rows, start=1):
        ranked[chunk.id].update(
            {
                "chunk": chunk,
                "version": version,
                "source": source,
                "semantic_rank": index,
                "distance": float(distance),
            }
        )
    for index, (chunk, version, source, rank) in enumerate(lexical_rows, start=1):
        ranked[chunk.id].update(
            {
                "chunk": chunk,
                "version": version,
                "source": source,
                "lexical_rank": index,
                "lexical_value": float(rank),
            }
        )

    hits: list[RetrievalHit] = []
    for values in ranked.values():
        semantic_rank = values.get("semantic_rank")
        lexical_rank = values.get("lexical_rank")
        fusion = 0.0
        if isinstance(semantic_rank, int):
            fusion += 1 / (60 + semantic_rank)
        if isinstance(lexical_rank, int):
            fusion += 1 / (60 + lexical_rank)
        chunk = values["chunk"]
        version = values["version"]
        source = values["source"]
        assert isinstance(chunk, DocumentChunk)
        assert isinstance(version, SourceVersion)
        assert isinstance(source, Source)
        distance = values.get("distance")
        hits.append(
            RetrievalHit(
                chunk_id=chunk.id,
                source_version_id=version.id,
                source_url=source.canonical_url,
                source_title=source.title,
                content=chunk.content,
                semantic_score=1 - float(distance) if isinstance(distance, float) else None,
                lexical_rank=lexical_rank if isinstance(lexical_rank, int) else None,
                fusion_score=fusion,
            )
        )
    return sorted(hits, key=lambda hit: hit.fusion_score, reverse=True)[:limit]
