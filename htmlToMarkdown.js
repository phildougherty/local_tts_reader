/**
 * HTML to Markdown converter for preserving document structure
 * Converts HTML elements to markdown equivalents before text processing
 */
class HtmlToMarkdown {
  /**
   * Convert HTML content to markdown format
   * @param {string|Element} input - HTML string or DOM element
   * @returns {string} - Markdown formatted text
   */
  static convert(input) {
    let element;
    
    if (typeof input === 'string') {
      // Create a temporary DOM element to parse HTML
      const temp = document.createElement('div');
      temp.innerHTML = input;
      element = temp;
    } else if (input instanceof Element) {
      element = input;
    } else {
      return '';
    }
    
    return this.processElement(element);
  }
  
  /**
   * Process a DOM element and convert to markdown
   * @param {Element} element - DOM element to process
   * @returns {string} - Markdown text
   */
  static processElement(element) {
    let result = '';
    
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        // Add text content, cleaning up whitespace
        const text = node.textContent.trim();
        if (text) {
          result += text + ' ';
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // Skip GitHub permalink anchors
        if (node.tagName.toLowerCase() === 'a' && 
            node.classList.contains('anchor') && 
            node.getAttribute('href')?.startsWith('#')) {
          continue;
        }
        result += this.convertElementToMarkdown(node);
      }
    }
    
    return result.trim();
  }
  
  /**
   * Convert specific HTML elements to markdown equivalents
   * @param {Element} element - HTML element to convert
   * @returns {string} - Markdown representation
   */
  static convertElementToMarkdown(element) {
    const tagName = element.tagName.toLowerCase();
    const text = this.getTextContent(element);
    
    switch (tagName) {
      case 'h1':
        return `\n# ${text}\n`;
      case 'h2':
        return `\n## ${text}\n`;
      case 'h3':
        return `\n### ${text}\n`;
      case 'h4':
        return `\n#### ${text}\n`;
      case 'h5':
        return `\n##### ${text}\n`;
      case 'h6':
        return `\n###### ${text}\n`;
      
      case 'p':
        return `\n${text}\n`;
      
      case 'ul':
      case 'ol':
        return `\n${this.processList(element)}\n`;
      
      case 'li':
        // This is handled by processList, but as fallback
        return `- ${text}\n`;
      
      case 'strong':
      case 'b':
        return `**${text}**`;
      
      case 'em':
      case 'i':
        return `*${text}*`;
      
      case 'code':
        return `\`${text}\``;
      
      case 'pre':
        return `\n\`\`\`\n${text}\n\`\`\`\n`;
      
      case 'blockquote':
        return `\n> ${text}\n`;
      
      case 'a':
        const href = element.getAttribute('href');
        // Skip anchor links with no text (like GitHub permalink anchors)
        if (!text || text.trim() === '') {
          return '';
        }
        // Skip self-referencing anchors (like #section-name)
        if (href && href.startsWith('#')) {
          return '';
        }
        if (href) {
          return `[${text}](${href})`;
        }
        return text;
      
      case 'br':
        return '\n';
      
      case 'hr':
        return '\n---\n';
      
      case 'div':
        // Special handling for GitHub markdown-heading divs
        if (element.classList.contains('markdown-heading')) {
          // Process only the heading element, skip the anchor
          const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
          if (heading) {
            return this.convertElementToMarkdown(heading);
          }
        }
        // Container elements - just process children
        return `\n${this.processElement(element)}\n`;
        
      case 'section':
      case 'article':
      case 'main':
        // Container elements - just process children
        return `\n${this.processElement(element)}\n`;
      
      case 'span':
        // Inline container - no special formatting
        return this.processElement(element);
      
      case 'img':
        const alt = element.getAttribute('alt') || '';
        const src = element.getAttribute('src') || '';
        return `![${alt}](${src})`;
      
      case 'table':
        return this.processTable(element);
      
      case 'nav':
      case 'header':
      case 'footer':
      case 'aside':
        // Navigation and structural elements - process but with spacing
        return `\n${this.processElement(element)}\n`;
      
      case 'script':
      case 'style':
      case 'noscript':
        // Skip these elements entirely
        return '';
      
      default:
        // For unknown elements, just process the content
        return this.processElement(element);
    }
  }
  
  /**
   * Process list elements (ul/ol) and their items
   * @param {Element} listElement - The list element (ul or ol)
   * @returns {string} - Markdown list
   */
  static processList(listElement) {
    const isOrdered = listElement.tagName.toLowerCase() === 'ol';
    let result = '';
    let counter = 1;
    
    for (const child of listElement.children) {
      if (child.tagName.toLowerCase() === 'li') {
        const itemText = this.processElement(child);
        if (isOrdered) {
          result += `${counter}. ${itemText}\n`;
          counter++;
        } else {
          result += `- ${itemText}\n`;
        }
      }
    }
    return result.trim();
  }
  
  /**
   * Process table elements
   * @param {Element} tableElement - The table element
   * @returns {string} - Markdown table or simplified text
   */
  static processTable(tableElement) {
    // For TTS purposes, convert tables to a simple list format
    // rather than trying to preserve markdown table structure
    let result = '\nTable content:\n';
    
    const rows = tableElement.querySelectorAll('tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td, th');
      const cellTexts = Array.from(cells).map(cell => this.getTextContent(cell).trim());
      if (cellTexts.some(text => text)) {
        result += `- ${cellTexts.join(', ')}\n`;
      }
    }
    
    return result;
  }
  
  /**
   * Get clean text content from an element
   * @param {Element} element - Element to extract text from
   * @returns {string} - Clean text content
   */
  static getTextContent(element) {
    // For elements that might contain other structural elements,
    // we want to process them recursively
    if (element.children.length > 0) {
      return this.processElement(element);
    }
    
    // For simple text nodes, just return the text content
    return element.textContent?.trim() || '';
  }
  
  /**
   * Extract content from a page element or selection
   * @param {Element} [rootElement] - Root element to extract from (default: document.body)
   * @returns {string} - Markdown formatted content
   */
  static extractPageContent(rootElement = document.body) {
    // Clone the element to avoid modifying the original
    const clone = rootElement.cloneNode(true);
    
    // Remove unwanted elements that don't contribute to readable content
    const unwantedSelectors = [
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '.advertisement', '.ads', '.sidebar', '.menu',
      '[aria-hidden="true"]', '.sr-only'
    ];
    
    unwantedSelectors.forEach(selector => {
      const elements = clone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });
    
    return this.convert(clone);
  }
  
  /**
   * Extract content from current selection or fallback to page content
   * @returns {string} - Markdown formatted content
   */
  static extractSelectionOrPage() {
    const selection = window.getSelection();
    
    if (selection.rangeCount > 0 && !selection.isCollapsed) {
      // User has selected text - extract from selection
      console.log('🔧 Extracting from selection');
      const range = selection.getRangeAt(0);
      const container = document.createElement('div');
      container.appendChild(range.cloneContents());
      console.log('🔧 Selection HTML:', container.innerHTML);
      return this.convert(container);
    } else {
      // No selection - extract from main content
      console.log('🔧 No selection - extracting from page');
      // Try to find main content area first
      const mainSelectors = [
        'main',
        '[role="main"]',
        'article',
        '.main-content',
        '.content',
        '#content',
        '.post-content',
        '.article-content'
      ];
      
      for (const selector of mainSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          console.log('🔧 Found main content with selector:', selector);
          console.log('🔧 Element HTML preview:', element.innerHTML.substring(0, 200) + '...');
          return this.extractPageContent(element);
        }
      }
      
      // Fallback to body
      console.log('🔧 Fallback to document.body');
      console.log('🔧 Body HTML preview:', document.body.innerHTML.substring(0, 200) + '...');
      return this.extractPageContent();
    }
  }
}

// Make available globally
window.HtmlToMarkdown = HtmlToMarkdown;