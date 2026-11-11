import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KnowledgeIndex } from '../../../../src/agent/indexer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, '..', 'docs');

let indexInstance = null;

export function getAlexKnowledgeIndex() {
  if (indexInstance) return indexInstance;

  indexInstance = new KnowledgeIndex();

  try {
    const files = readdirSync(DOCS_DIR);
    for (const file of files) {
      if (!file.endsWith('.md') && !file.endsWith('.json')) continue;
      const fullPath = path.join(DOCS_DIR, file);
      const content = readFileSync(fullPath, 'utf8');
      const title = file.replace(/\.[^.]+$/, '');
      indexInstance.addDocument({
        id: `alex_kb_${file}`,
        title: `Alex Document: ${title}`,
        content,
        path: fullPath,
      });
    }
  } catch (err) {
    console.warn('[indexer-tool] Failed to scan docs dir:', err.message);
  }

  return indexInstance;
}

export function searchMerchantKnowledge(query, topK = 2) {
  const idx = getAlexKnowledgeIndex();
  return idx.search(query, topK);
}
