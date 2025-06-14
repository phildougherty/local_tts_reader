/**
 * Text processor for TTS
 * - Removes markdown formatting
 * - Cleans up URLs
 * - Removes special characters that don't read well
 */
class TextProcessor {
  /**
   * Process text for TTS
   * @param {string} text - The text to process
   * @returns {string} - The processed text
   */
  static process(text) {
    if (!text) return '';
    
    let processedText = text;
    
    // Remove markdown bold/italic
    processedText = processedText.replace(/(\*\*|__)(.*?)\1/g, '$2');
    processedText = processedText.replace(/(\*|_)(.*?)\1/g, '$2');
    
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
      const line = lines[i].trim();
      
      if (!line) {
        // Skip empty lines but they can separate sections
        continue;
      }
      
      // Handle headers
      if (/^#{1,6}\s+/.test(line)) {
        const headerText = line.replace(/^#{1,6}\s+/, '');
        processedLines.push(headerText + ':');
      }
      // Handle list items
      else if (/^[\s]*[-*+]\s+/.test(line)) {
        const itemText = line.replace(/^[\s]*[-*+]\s+/, '');
        processedLines.push(itemText + ',');
      }
      else if (/^\s*\d+\.\s+/.test(line)) {
        const itemText = line.replace(/^\s*\d+\.\s+/, '');
        processedLines.push(itemText + ',');
      }
      // Regular text
      else {
        processedLines.push(line);
      }
    }
    
    // Join lines with spaces
    processedText = processedLines.join(' ');
    
    // Remove special characters that don't read well (after list processing)
    processedText = processedText.replace(/[|~`]/g, ' '); // Note: removed * since it's used in lists
    
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
    
    return processedText;
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
