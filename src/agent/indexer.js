// Node.js zero-dependency in-memory text indexer (BM25 & term-frequency)
// Designed for Skill-scoped knowledge retrieval without heavy external vector DBs.

export class KnowledgeIndex {
  constructor() {
    this.documents = []; // { id, title, content, path, terms: Map(term -> count) }
    this.docFreqs = new Map(); // term -> document frequency
    this.avgDocLength = 0;
    this.k1 = 1.2;
    this.b = 0.75;
  }

  // Tokenize text into normalized tokens (supporting both English words and Chinese n-grams)
  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    const normalized = text.toLowerCase();
    const tokens = [];

    // 1. English words
    const enMatches = normalized.match(/[a-z0-9_.-]{2,}/g) || [];
    for (const w of enMatches) {
      tokens.push(w);
    }

    // 2. Chinese characters & 2-grams / 3-grams
    const zhChars = normalized.match(/[\u4e00-\u9fa5]/g) || [];
    for (const char of zhChars) {
      tokens.push(char);
    }
    // Chinese bi-grams for semantic precision
    for (let i = 0; i < zhChars.length - 1; i++) {
      tokens.push(zhChars[i] + zhChars[i + 1]);
      if (i < zhChars.length - 2) {
        tokens.push(zhChars[i] + zhChars[i + 1] + zhChars[i + 2]);
      }
    }

    return tokens;
  }

  // Add document to index
  addDocument({ id, title, content, path }) {
    const tokens = this.tokenize(`${title}\n${content}`);
    const termCounts = new Map();
    for (const t of tokens) {
      termCounts.set(t, (termCounts.get(t) || 0) + 1);
    }

    const doc = {
      id: id || `doc_${this.documents.length + 1}`,
      title: title || '',
      content: content || '',
      path: path || '',
      length: tokens.length,
      terms: termCounts,
    };

    this.documents.push(doc);

    // Update doc frequencies
    for (const term of termCounts.keys()) {
      this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1);
    }

    // Recalculate average document length
    const totalLength = this.documents.reduce((sum, d) => sum + d.length, 0);
    this.avgDocLength = totalLength / (this.documents.length || 1);
  }

  // BM25 search
  search(query, topK = 3) {
    if (!query || typeof query !== 'string' || this.documents.length === 0) {
      return [];
    }

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    const N = this.documents.length;
    const scores = [];

    for (const doc of this.documents) {
      let score = 0;
      for (const token of queryTokens) {
        if (!doc.terms.has(token)) continue;

        const tf = doc.terms.get(token);
        const df = this.docFreqs.get(token) || 1;
        // Standard BM25 IDF with smoothing
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const num = tf * (this.k1 + 1);
        const denom = tf + this.k1 * (1 - this.b + this.b * (doc.length / (this.avgDocLength || 1)));
        score += idf * (num / denom);
      }

      if (score > 0) {
        // Boost if title matches
        const titleLower = doc.title.toLowerCase();
        for (const token of queryTokens) {
          if (titleLower.includes(token)) score += 1.5;
        }

        scores.push({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          snippet: doc.content.slice(0, 300) + (doc.content.length > 300 ? '...' : ''),
          path: doc.path,
          score: Math.round(score * 100) / 100,
        });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
}
