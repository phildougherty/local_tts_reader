/**
 * Smart text chunker for TTS processing
 * Intelligently splits text into chunks that maintain natural speech flow
 */
class TextChunker {
  constructor(options = {}) {
    this.maxChunkSize = options.maxChunkSize || 800; // Characters per chunk
    this.minChunkSize = options.minChunkSize || 200; // Minimum chunk size
  }

  /**
   * Split text into intelligent chunks for TTS processing
   * @param {string} text - The text to chunk
   * @returns {Array<string>} - Array of text chunks
   */
  chunkText(text) {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // First, split by double newlines (paragraphs)
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    const chunks = [];
    let currentChunk = '';

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i].trim();
      const nextParagraph = i < paragraphs.length - 1 ? paragraphs[i + 1].trim() : null;
      
      // Check if this paragraph should be bundled with the next one
      const shouldBundle = this.shouldBundleWithNext(paragraph, nextParagraph);
      
      // If adding this paragraph would exceed max size, finalize current chunk
      if (currentChunk.length > 0 && 
          (currentChunk.length + paragraph.length + 2) > this.maxChunkSize) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      // Add paragraph to current chunk
      if (currentChunk.length > 0) {
        currentChunk += '\n\n' + paragraph;
      } else {
        currentChunk = paragraph;
      }
      
      // If this paragraph is very long, split it further
      if (currentChunk.length > this.maxChunkSize) {
        const subChunks = this.splitLongParagraph(currentChunk);
        chunks.push(...subChunks.slice(0, -1)); // Add all but the last
        currentChunk = subChunks[subChunks.length - 1]; // Keep the last as current
      }
      
      // If we shouldn't bundle with next, or this is the last paragraph, finalize chunk
      if (!shouldBundle || i === paragraphs.length - 1) {
        if (currentChunk.trim().length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
      }
    }

    // Handle any remaining text
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    // Post-process to merge very small chunks
    return this.mergeSmallChunks(chunks);
  }

  /**
   * Determine if a paragraph should be bundled with the next one
   * @param {string} current - Current paragraph
   * @param {string} next - Next paragraph
   * @returns {boolean} - Whether to bundle
   */
  shouldBundleWithNext(current, next) {
    if (!next) return false;
    
    // Bundle if current paragraph is very short (likely a title or intro)
    if (current.length < 100) return true;
    
    // Bundle if current paragraph ends with a colon (introducing a list)
    if (current.endsWith(':')) return true;
    
    // Bundle if next paragraph starts with list indicators
    if (/^[\s]*[-•*]\s/.test(next) || /^[\s]*\d+[\.)]\s/.test(next)) return true;
    
    // Bundle if current paragraph seems to introduce something
    const introPatterns = [
      /\b(the following|these include|such as|for example|including)\s*:?\s*$/i,
      /\b(here are|below are|listed below)\b/i,
      /\b(consider|note|remember)\s*:?\s*$/i
    ];
    
    if (introPatterns.some(pattern => pattern.test(current))) return true;
    
    // Bundle if both paragraphs are short (likely related thoughts)
    if (current.length < 200 && next.length < 200) return true;
    
    // Don't bundle if current chunk would become too large
    if ((current.length + next.length + 2) > this.maxChunkSize) return false;
    
    return false;
  }

  /**
   * Split a long paragraph into smaller chunks
   * @param {string} paragraph - The long paragraph to split
   * @returns {Array<string>} - Array of smaller chunks
   */
  splitLongParagraph(paragraph) {
    if (paragraph.length <= this.maxChunkSize) {
      return [paragraph];
    }

    const chunks = [];
    const sentences = this.splitIntoSentences(paragraph);
    let currentChunk = '';

    for (const sentence of sentences) {
      // If adding this sentence would exceed max size, finalize current chunk
      if (currentChunk.length > 0 && 
          (currentChunk.length + sentence.length + 1) > this.maxChunkSize) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      // Add sentence to current chunk
      if (currentChunk.length > 0) {
        currentChunk += ' ' + sentence;
      } else {
        currentChunk = sentence;
      }
      
      // If even a single sentence is too long, split by clauses
      if (currentChunk.length > this.maxChunkSize && currentChunk === sentence) {
        const subChunks = this.splitByClauses(sentence);
        chunks.push(...subChunks.slice(0, -1));
        currentChunk = subChunks[subChunks.length - 1];
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Split text into sentences
   * @param {string} text - Text to split
   * @returns {Array<string>} - Array of sentences
   */
  splitIntoSentences(text) {
    // Split on sentence-ending punctuation followed by whitespace and capital letter
    return text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s => s.trim().length > 0);
  }

  /**
   * Split a sentence by clauses (commas, semicolons)
   * @param {string} sentence - Sentence to split
   * @returns {Array<string>} - Array of clauses
   */
  splitByClauses(sentence) {
    if (sentence.length <= this.maxChunkSize) {
      return [sentence];
    }

    // Split by commas and semicolons, but be careful with abbreviations
    const parts = sentence.split(/(?<=[,;])\s+/);
    const chunks = [];
    let currentChunk = '';

    for (const part of parts) {
      if (currentChunk.length > 0 && 
          (currentChunk.length + part.length + 1) > this.maxChunkSize) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      if (currentChunk.length > 0) {
        currentChunk += ' ' + part;
      } else {
        currentChunk = part;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Merge chunks that are too small
   * @param {Array<string>} chunks - Array of chunks
   * @returns {Array<string>} - Merged chunks
   */
  mergeSmallChunks(chunks) {
    const merged = [];
    let currentChunk = '';

    for (const chunk of chunks) {
      if (currentChunk.length === 0) {
        currentChunk = chunk;
      } else if (currentChunk.length < this.minChunkSize || 
                 (currentChunk.length + chunk.length + 2) <= this.maxChunkSize) {
        currentChunk += '\n\n' + chunk;
      } else {
        merged.push(currentChunk);
        currentChunk = chunk;
      }
    }

    if (currentChunk.length > 0) {
      merged.push(currentChunk);
    }

    return merged;
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.TextChunker = TextChunker;
}

// Export for Node.js if available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextChunker;
}