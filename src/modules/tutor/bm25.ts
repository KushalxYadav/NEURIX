/**
 * Small BM25 index for grounded retrieval over course chunks. Pure and
 * synchronous so it can be unit-tested; the loader lives in retrieval.ts.
 */
export interface RetrievalDoc {
  id: string;
  documentId: string;
  filename: string;
  citation: string;
  content: string;
  /** Source tier: 1 = lecture/course material, 2 = textbook. */
  tier: 1 | 2;
  sessionKeys: string[];
}

export interface Hit {
  doc: RetrievalDoc;
  score: number;
}

const STOP = new Set(
  "a an and are as at be but by can do does for from has have how i if in into is it its may me my not of on or our so than that the their them then there these they this to too us was we were what when where which while who why will with would you your about also each just more most other some such only very explain tell describe difference between".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").match(/[a-z0-9]+(?:[./-][a-z0-9]+)*/g) ?? [])
    .map((t) => t.replace(/[./-]+$/, ""))
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

/** Light suffix stripping so "layers"/"layer", "caching"/"cache" meet. */
export function stem(token: string): string {
  if (token.length <= 4 || /\d/.test(token)) return token;
  for (const suffix of ["ing", "ies", "es", "s", "ed"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return suffix === "ies" ? `${token.slice(0, -3)}y` : token.slice(0, -suffix.length);
    }
  }
  return token;
}

export class Bm25Index {
  private readonly postings = new Map<string, Map<number, number>>();
  private readonly lengths: number[] = [];
  private readonly avgLength: number;

  constructor(readonly docs: RetrievalDoc[], private readonly k1 = 1.2, private readonly b = 0.75) {
    docs.forEach((doc, i) => {
      const tokens = tokenize(doc.content);
      this.lengths[i] = tokens.length;
      for (const token of tokens) {
        let posting = this.postings.get(token);
        if (!posting) this.postings.set(token, (posting = new Map()));
        posting.set(i, (posting.get(i) ?? 0) + 1);
      }
    });
    this.avgLength = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, docs.length);
  }

  search(
    query: string,
    { limit = 8, sessionKeys = [], preferCourse = true, perDocument = 3 }: { limit?: number; sessionKeys?: string[]; preferCourse?: boolean; perDocument?: number } = {},
  ): Hit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    const scores = new Map<number, number>();
    const n = this.docs.length;
    for (const term of terms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const idf = Math.log(1 + (n - posting.size + 0.5) / (posting.size + 0.5));
      for (const [i, tf] of posting) {
        const norm = tf + this.k1 * (1 - this.b + (this.b * this.lengths[i]) / this.avgLength);
        scores.set(i, (scores.get(i) ?? 0) + idf * ((tf * (this.k1 + 1)) / norm));
      }
    }
    const boosted = [...scores.entries()].map(([i, score]) => {
      const doc = this.docs[i];
      let s = score;
      if (preferCourse && doc.tier === 1) s *= 1.25; // teacher's material before books
      if (sessionKeys.length && doc.sessionKeys.some((k) => sessionKeys.includes(k))) s *= 1.5;
      return { doc, score: s };
    });
    boosted.sort((a, b) => b.score - a.score);
    const perDoc = new Map<string, number>();
    const out: Hit[] = [];
    for (const hit of boosted) {
      const used = perDoc.get(hit.doc.documentId) ?? 0;
      if (used >= perDocument) continue; // keep results diverse
      perDoc.set(hit.doc.documentId, used + 1);
      out.push(hit);
      if (out.length >= limit) break;
    }
    return out;
  }
}
