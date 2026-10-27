-- Search box (#167): one embedding per prompt or answer, no text.
CREATE TABLE "thread_search_embeddings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_search_embeddings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "thread_search_embeddings_source_kind_check" CHECK ("source_kind" IN ('prompt', 'answer'))
);

CREATE UNIQUE INDEX "thread_search_embeddings_source_kind_source_id_key" ON "thread_search_embeddings"("source_kind", "source_id");
CREATE INDEX "thread_search_embeddings_user_id_idx" ON "thread_search_embeddings"("user_id");
CREATE INDEX "thread_search_embeddings_embedding_hnsw" ON "thread_search_embeddings" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "thread_search_embeddings" ADD CONSTRAINT "thread_search_embeddings_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
