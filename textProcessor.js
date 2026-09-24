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
    
    // Remove markdown headers
    processedText = processedText.replace(/^#{1,6}\s+(.+)$/gm, '$1');
    
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
    
    // Remove special characters that don't read well
    processedText = processedText.replace(/[|*~`]/g, ' ');
    
    // Remove excessive whitespace
    processedText = processedText.replace(/\s+/g, ' ').trim();
    
    // Remove markdown list markers
    processedText = processedText.replace(/^[\s-]*[-*+]\s+/gm, '');
    processedText = processedText.replace(/^\s*\d+\.\s+/gm, '');
    
    // Remove HTML tags
    processedText = processedText.replace(/<[^>]*>/g, '');
    
    // Replace common symbols with words
    processedText = processedText.replace(/&/g, ' and ');
    processedText = processedText.replace(/\$/g, ' dollars ');
    processedText = processedText.replace(/%/g, ' percent ');
    processedText = processedText.replace(/\^/g, ' ');
    
    // Replace multiple dots with a single period
    processedText = processedText.replace(/\.{2,}/g, '.');
    
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

// Make available globally. Loaded both via importScripts() in the
// background service worker (no `window`) and, previously, as an
// injected content script (`window` === `self`) — `self` covers both.
self.TextProcessor = TextProcessor;
