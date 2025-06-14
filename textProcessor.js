/**
 * Text processor for TTS
 * - Removes markdown formatting
 * - Cleans up URLs
 * - Removes special characters that don't read well
 */
class TextProcessor {
  // Static reference to HtmlToMarkdown converter
  static htmlToMarkdown = null;
  
  /**
   * Initialize the TextProcessor with HtmlToMarkdown converter
   * @param {object} converter - The HtmlToMarkdown converter instance
   */
  static init(converter) {
    this.htmlToMarkdown = converter;
    console.log('✅ TextProcessor initialized with HtmlToMarkdown converter');
  }
  /**
   * Process text for TTS
   * @param {string|object} input - The text to process, or pageData object with html/text
   * @returns {string} - The processed text
   */
  static process(input) {
    let text = input;
    
    // Handle pageData object with HTML and text
    if (typeof input === 'object' && input !== null) {
      console.log('🔍 TextProcessor received pageData:', {
        type: input.type,
        hasHtml: !!input.html,
        hasText: !!input.text,
        debug: input.debug
      });
      
      // Try HTML to markdown conversion first
      if (input.html && input.html.trim()) {
        console.log('🔧 Converting HTML to markdown');
        console.log('🔍 HTML preview:', input.html.substring(0, 200) + '...');
        
        try {
          // Use HtmlToMarkdown if available
          if (this.htmlToMarkdown) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = input.html;
            text = this.htmlToMarkdown.convert(tempDiv);
            console.log('✅ HTML converted to markdown:', text.substring(0, 200) + '...');
          } else {
            console.log('⚠️ HtmlToMarkdown not available, using text fallback');
            text = input.text || '';
          }
        } catch (error) {
          console.error('❌ HTML to markdown conversion failed:', error);
          text = input.text || '';
        }
      } else {
        console.log('⚠️ No HTML content, using plain text');
        text = input.text || '';
      }
    }
    
    console.log('🔍 TextProcessor final input text:', text);
    if (!text) return '';
    
    let processedText = text;
    
    // First, handle HTML headers and convert them to markdown-like format
    processedText = this.processHtmlHeaders(processedText);
    
    // Handle HTML list items
    processedText = this.processHtmlLists(processedText);
    
    // Handle other header patterns (integrated into main line processing below)
    
    // Remove markdown bold/italic (but be careful with underscores in identifiers and list markers)
    processedText = processedText.replace(/(\*\*|__)(.*?)\1/g, '$2');
    // Remove single * formatting for italics (after list processing is done below)
    // We'll handle this after the main line processing to avoid conflicts
    processedText = processedText.replace(/(\s|^)_([^_\s]+)_(\s|$)/g, '$1$2$3');
    
    // Remove markdown code blocks
    processedText = processedText.replace(/```[\s\S]*?```/g, 'code block omitted');
    processedText = processedText.replace(/`([^`]+)`/g, '$1');
    
    // Remove markdown links but keep the text
    processedText = processedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    
    // Process URLs
    processedText = this.processUrls(processedText);
    
    // Process by lines to handle headers and lists properly (before removing special chars)
    const lines = processedText.split('\n');
    const processedLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      if (!trimmedLine) {
        // Skip empty lines but they can separate sections
        continue;
      }
      
      // Handle markdown headers first (highest priority)
      if (/^#{1,6}\s+/.test(trimmedLine)) {
        const headerText = trimmedLine.replace(/^#{1,6}\s+/, '');
        processedLines.push(headerText + ':');
      }
      // Handle list items (second priority) - expanded to include more formats
      else if (this.isListItem(trimmedLine)) {
        console.log('📋 Found list item:', trimmedLine);
        const itemText = this.extractListItemText(trimmedLine);
        console.log('📋 Extracted text:', itemText);
        processedLines.push(itemText + ',');
      }
      // Check for text-based headers (only if not already processed as markdown or list)
      else {
        let isHeader = false;
        let headerLevel = 2;
        
        // Pattern 1: All caps line (likely a header)
        if (this.isAllCapsHeader(trimmedLine)) {
          isHeader = true;
          headerLevel = 2;
        }
        
        // Pattern 2: Underlined headers (text followed by === or ---)
        if (!isHeader && i < lines.length - 1) {
          const nextLine = lines[i + 1]?.trim();
          if (this.isUnderlineHeader(trimmedLine, nextLine)) {
            isHeader = true;
            headerLevel = nextLine.startsWith('=') ? 1 : 2;
            // Skip the underline in next iteration
            i++;
          }
        }
        
        // Pattern 3: Short lines that look like titles (heuristic)
        if (!isHeader && this.isLikelyTitle(trimmedLine, lines, i)) {
          isHeader = true;
          headerLevel = 3;
        }
        
        if (isHeader) {
          processedLines.push(trimmedLine + ':');
        } else {
          processedLines.push(trimmedLine);
        }
      }
    }
    
    // Join lines with spaces
    processedText = processedLines.join(' ');
    
    // Now it's safe to remove italic asterisks since list processing is complete
    processedText = processedText.replace(/\*([^*]+)\*/g, '$1');
    
    // Remove special characters that don't read well (after list processing)
    // Note: Keep _ for programming identifiers, remove others
    processedText = processedText.replace(/[|~`]/g, ' ');
    
    // Remove HTML tags
    processedText = processedText.replace(/<[^>]*>/g, '');
    
    // Replace common symbols with words
    processedText = processedText.replace(/&/g, ' and ');
    processedText = processedText.replace(/\$/g, ' dollars ');
    processedText = processedText.replace(/%/g, ' percent ');
    processedText = processedText.replace(/\^/g, ' ');
    
    // Replace multiple dots with a single period
    processedText = processedText.replace(/\.{2,}/g, '.');
    
    // Clean up comma spacing and remove trailing commas at end of text
    processedText = processedText.replace(/,\s*,/g, ','); // Remove double commas
    processedText = processedText.replace(/,\s*$/, ''); // Remove trailing comma at end
    processedText = processedText.replace(/,\s+/g, ', '); // Normalize comma spacing
    
    // Add period after lists when followed by headers or other content
    processedText = processedText.replace(/,\s+([^,]+:)/g, '. $1');
    
    // Final whitespace cleanup
    processedText = processedText.replace(/\s+/g, ' ').trim();
    
    console.log('✅ TextProcessor output:', processedText);
    return processedText;
  }
  
  /**
   * Process HTML headers and convert them to markdown-like format
   * @param {string} text - The text containing HTML headers
   * @returns {string} - Text with HTML headers converted
   */
  static processHtmlHeaders(text) {
    // Handle HTML heading tags (h1-h6)
    let processedText = text;
    
    // Convert <h1>Header</h1> to # Header
    processedText = processedText.replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi, (match, level, content) => {
      const headerPrefix = '#'.repeat(parseInt(level));
      // Clean up any nested HTML tags in the header content
      const cleanContent = content.replace(/<[^>]*>/g, '').trim();
      return `${headerPrefix} ${cleanContent}`;
    });
    
    // Handle self-closing header variants and incomplete tags
    processedText = processedText.replace(/<h([1-6])[^>]*\/>/gi, '');
    
    // Handle other semantic heading elements
    processedText = processedText.replace(/<(title|header)[^>]*>(.*?)<\/(title|header)>/gi, '# $2');
    
    return processedText;
  }
  
  /**
   * Process HTML lists and convert them to markdown-like format
   * @param {string} text - The text containing HTML lists
   * @returns {string} - Text with HTML lists converted
   */
  static processHtmlLists(text) {
    let processedText = text;
    
    // Remove <ul> and <ol> tags but keep the content
    processedText = processedText.replace(/<\/?[uo]l[^>]*>/gi, '');
    
    // Convert <li>item</li> to - item
    processedText = processedText.replace(/<li[^>]*>(.*?)<\/li>/gi, (match, content) => {
      // Clean up any nested HTML tags in the list item content
      const cleanContent = content.replace(/<[^>]*>/g, '').trim();
      return `- ${cleanContent}`;
    });
    
    return processedText;
  }
  
  
  /**
   * Check if a line is a list item
   * @param {string} line - The line to check
   * @returns {boolean} - True if it's a list item
   */
  static isListItem(line) {
    // Standard markdown list markers: -, *, +
    if (/^[\s]*[-*+]\s+/.test(line)) return true;
    
    // Numbered lists: 1., 2., etc.
    if (/^\s*\d+\.\s+/.test(line)) return true;
    
    // Unicode bullet points: •, ◦, ▪, ▫, etc.
    if (/^[\s]*[•◦▪▫‣⁃]\s+/.test(line)) return true;
    
    // Emoji-based lists (common on GitHub): 🎯, 🎭, ⚡, etc.
    if (/^[\s]*[\u{1F300}-\u{1F9FF}]\s+/u.test(line)) return true;
    
    // Arrow-based lists: →, ➤, ⇒, etc.
    if (/^[\s]*[→➤⇒⟶]\s+/.test(line)) return true;
    
    return false;
  }
  
  /**
   * Extract the text content from a list item
   * @param {string} line - The list item line
   * @returns {string} - The extracted text content
   */
  static extractListItemText(line) {
    const trimmedLine = line.trim();
    
    // Remove standard markdown markers
    if (/^[-*+]\s+/.test(trimmedLine)) {
      return trimmedLine.replace(/^[-*+]\s+/, '');
    }
    
    // Remove numbered list markers
    if (/^\d+\.\s+/.test(trimmedLine)) {
      return trimmedLine.replace(/^\d+\.\s+/, '');
    }
    
    // Remove Unicode bullets
    if (/^[•◦▪▫‣⁃]\s+/.test(trimmedLine)) {
      return trimmedLine.replace(/^[•◦▪▫‣⁃]\s+/, '');
    }
    
    // Remove emoji markers
    if (/^[\u{1F300}-\u{1F9FF}]\s+/u.test(trimmedLine)) {
      return trimmedLine.replace(/^[\u{1F300}-\u{1F9FF}]\s+/u, '');
    }
    
    // Remove arrow markers
    if (/^[→➤⇒⟶]\s+/.test(trimmedLine)) {
      return trimmedLine.replace(/^[→➤⇒⟶]\s+/, '');
    }
    
    // Fallback: return the original line if no pattern matches
    return trimmedLine;
  }
  
  /**
   * Check if a line is likely an all-caps header
   * @param {string} line - The line to check
   * @returns {boolean} - True if likely a header
   */
  static isAllCapsHeader(line) {
    // Must be reasonably short and mostly uppercase
    if (line.length > 100 || line.length < 3) return false;
    
    // Count uppercase vs lowercase letters
    const letters = line.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 3) return false;
    
    const upperCount = (line.match(/[A-Z]/g) || []).length;
    const lowerCount = (line.match(/[a-z]/g) || []).length;
    
    // Should be mostly uppercase (80% threshold)
    return upperCount > 0 && (upperCount / (upperCount + lowerCount)) >= 0.8;
  }
  
  /**
   * Check if lines form an underlined header pattern
   * @param {string} textLine - The text line
   * @param {string} nextLine - The following line
   * @returns {boolean} - True if this is an underlined header
   */
  static isUnderlineHeader(textLine, nextLine) {
    if (!nextLine || !textLine) return false;
    
    // Check if next line is made of underline characters
    const underlineChars = /^[=\-_~]{3,}$/;
    if (!underlineChars.test(nextLine)) return false;
    
    // Text line should be reasonable length for a header
    if (textLine.length > 80 || textLine.length < 3) return false;
    
    // Underline should be roughly same length as text (±3 chars)
    return Math.abs(textLine.length - nextLine.length) <= 3;
  }
  
  /**
   * Check if a line is likely a title based on context
   * @param {string} line - The line to check
   * @param {array} allLines - All lines for context
   * @param {number} index - Current line index
   * @returns {boolean} - True if likely a title
   */
  static isLikelyTitle(line, allLines, index) {
    // Basic length check - titles are usually short
    if (line.length > 60 || line.length < 3) return false;
    
    // Should not end with punctuation (except :)
    if (/[.!?;,]$/.test(line) && !line.endsWith(':')) return false;
    
    // Check if it's at the start of a section (preceded by empty line)
    const prevLine = index > 0 ? allLines[index - 1]?.trim() : '';
    const nextLine = index < allLines.length - 1 ? allLines[index + 1]?.trim() : '';
    
    // More likely to be a header if:
    // 1. Preceded by empty line or it's the first non-empty line
    // 2. Followed by empty line then content, OR followed by content
    const precededByEmpty = index === 0 || !prevLine;
    const followedByEmptyThenContent = !nextLine && index < allLines.length - 2 && (allLines[index + 2]?.trim().length > 10);
    const followedByContent = nextLine && nextLine.length > 10; // Content should be substantial
    
    return precededByEmpty && (followedByContent || followedByEmptyThenContent);
  }
  
  /**
   * Process URLs in text
   * @param {string} text - The text containing URLs
   * @returns {string} - Text with processed URLs
   */
  static processUrls(text) {
    // Regular expression for URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    
    return text.replace(urlRegex, (url) => {
      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        
        // Extract the domain name without subdomains
        let domainName = domain.split('.');
        if (domainName.length > 2) {
          // Handle cases like www.example.com
          if (domainName[0] === 'www') {
            domainName = domainName.slice(1);
          }
          // Get the main domain part
          domainName = domainName.slice(-2, -1)[0];
        } else {
          // Handle cases like example.com
          domainName = domainName[0];
        }
        
        // Capitalize first letter
        domainName = domainName.charAt(0).toUpperCase() + domainName.slice(1);
        
        return `[${domainName} dot ${domain.split('.').pop()} link]`;
      } catch (e) {
        // If URL parsing fails, return a generic placeholder
        return '[web link]';
      }
    });
  }
}

// Make available globally
window.TextProcessor = TextProcessor;
