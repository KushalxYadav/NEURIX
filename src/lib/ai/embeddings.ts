/**
 * Provider-independent embeddings. Claude generates text; it does not
 * produce embeddings, so vectors come from a separate provider. Without one,
 * retrieval uses PostgreSQL full-text search only.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

export interface VoyageOptions {
  apiKey: string;
  model: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
}

/** Voyage AI embeddings (matches the 1024-dim `chunk_embeddings` column). */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly name = "voyage";
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VoyageOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.dimensions = options.dimensions ?? 1024;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.fetchImpl("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: texts, model: this.model, input_type: kind, output_dimension: this.dimensions }),
    });
    if (!response.ok) {
      throw new Error(`Embedding request failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { data: { embedding: number[]; index: number }[] };
    const vectors = [...payload.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== this.dimensions)) {
      throw new Error("Embedding response did not match the requested inputs/dimensions");
    }
    return vectors;
  }
}
