export interface RankedFile {
  path: string;
  score: number;
}

const IMPORTANT_FILE_WEIGHTS: Record<string, number> = {
  'package.json': 15,
  'tsconfig.json': 12,
  'readme.md': 8,
  'dockerfile': 7,
  'docker-compose.yml': 7,
  '.gitignore': 5,
};

export function rankFiles(files: string[], query: string, topN = 10): RankedFile[] {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  const scored: RankedFile[] = files.map(file => {
    const fileLower = file.toLowerCase();
    const fileName = file.split(/[\\/]/).pop() || file;
    const fileNameLower = fileName.toLowerCase();
    let score = 0;

    // Exact filename match
    if (fileNameLower === queryLower) {
      score += 100;
    }

    // Partial filename match
    if (fileNameLower.includes(queryLower)) {
      score += 60;
    }

    // Keyword matches in path
    for (const word of queryWords) {
      if (fileNameLower.includes(word)) {
        score += 20;
      } else if (fileLower.includes(word)) {
        score += 8;
      }
    }

    // Known important files
    const weightKey = Object.keys(IMPORTANT_FILE_WEIGHTS).find(k => fileNameLower === k);
    if (weightKey) {
      score += IMPORTANT_FILE_WEIGHTS[weightKey];
    }

    // Extension bonus for source files
    if (fileLower.endsWith('.ts') || fileLower.endsWith('.tsx')) {
      score += 5;
    } else if (fileLower.endsWith('.js') || fileLower.endsWith('.jsx')) {
      score += 3;
    }

    // Root-level files are more important
    const depth = file.split(/[\\/]/).length - 1;
    score += Math.max(0, 8 - depth * 2);

    return { path: file, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
