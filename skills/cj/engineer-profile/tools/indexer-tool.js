import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KnowledgeIndex } from '../../../../src/agent/indexer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, '..', 'docs');

let indexInstance = null;

export function getCjKnowledgeIndex() {
  if (indexInstance) return indexInstance;
  indexInstance = new KnowledgeIndex();
  try {
    const files = readdirSync(DOCS_DIR);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const fullPath = path.join(DOCS_DIR, file);
      const content = readFileSync(fullPath, 'utf8');
      indexInstance.addDocument({
        id: `cj_kb_${file}`,
        title: `CJ Document: ${file}`,
        content,
        path: fullPath,
      });
    }
  } catch (err) {
    console.warn('[cj indexer] failed:', err.message);
  }
  return indexInstance;
}

export function searchCjKnowledge(query, topK = 2) {
  return getCjKnowledgeIndex().search(query, topK);
}
