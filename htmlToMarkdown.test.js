/**
 * Jest tests for HtmlToMarkdown converter
 * Run with: npm test
 */

// Mock DOM environment
require('./htmlToMarkdown.js');
const HtmlToMarkdown = window.HtmlToMarkdown;

describe('HtmlToMarkdown', () => {
  beforeEach(() => {
    // Reset DOM for each test
    document.body.innerHTML = '';
  });

  describe('Basic HTML Conversion', () => {
    test('should convert H1 headers', () => {
      const html = '<h1>Main Title</h1>';
      expect(HtmlToMarkdown.convert(html)).toContain('# Main Title');
    });

    test('should convert H2 headers', () => {
      const html = '<h2>Section Header</h2>';
      expect(HtmlToMarkdown.convert(html)).toContain('## Section Header');
    });

    test('should convert nested headers', () => {
      const html = '<h1>Main</h1><h2>Sub</h2><h3>Subsub</h3>';
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('# Main');
      expect(result).toContain('## Sub');
      expect(result).toContain('### Subsub');
    });
  });

  describe('List Conversion', () => {
    test('should convert unordered lists', () => {
      const html = '<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>';
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('- Item 1');
      expect(result).toContain('- Item 2');
      expect(result).toContain('- Item 3');
    });

    test('should convert ordered lists', () => {
      const html = '<ol><li>First</li><li>Second</li><li>Third</li></ol>';
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('1. First');
      expect(result).toContain('2. Second');
      expect(result).toContain('3. Third');
    });

    test('should handle nested lists', () => {
      const html = `
        <ul>
          <li>Parent 1
            <ul>
              <li>Child 1</li>
              <li>Child 2</li>
            </ul>
          </li>
          <li>Parent 2</li>
        </ul>
      `;
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('- Parent 1');
      expect(result).toContain('- Child 1');
      expect(result).toContain('- Child 2');
      expect(result).toContain('- Parent 2');
    });
  });

  describe('Text Formatting', () => {
    test('should convert bold text', () => {
      expect(HtmlToMarkdown.convert('<strong>bold</strong>')).toContain('**bold**');
      expect(HtmlToMarkdown.convert('<b>bold</b>')).toContain('**bold**');
    });

    test('should convert italic text', () => {
      expect(HtmlToMarkdown.convert('<em>italic</em>')).toContain('*italic*');
      expect(HtmlToMarkdown.convert('<i>italic</i>')).toContain('*italic*');
    });

    test('should convert code', () => {
      expect(HtmlToMarkdown.convert('<code>code</code>')).toContain('`code`');
    });

    test('should handle code blocks', () => {
      const html = '<pre>function test() {\n  return true;\n}</pre>';
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('```');
      expect(result).toContain('function test()');
    });
  });

  describe('Links and Images', () => {
    test('should convert links', () => {
      const html = '<a href="https://example.com">Link Text</a>';
      const result = HtmlToMarkdown.convert(html);
      expect(result).toBe('[Link Text](https://example.com)');
    });

    test('should handle links without href', () => {
      const html = '<a>Just Text</a>';
      const result = HtmlToMarkdown.convert(html);
      expect(result).toBe('Just Text');
    });

    test('should convert images', () => {
      const html = '<img src="image.jpg" alt="Alt text">';
      const result = HtmlToMarkdown.convert(html);
      expect(result).toBe('![Alt text](image.jpg)');
    });
  });

  describe('Complex Document Structure', () => {
    test('should handle article with headers and lists', () => {
      const html = `
        <article>
          <h1>Main Article</h1>
          <p>Introduction paragraph.</p>
          <h2>Features</h2>
          <ul>
            <li>Feature 1</li>
            <li>Feature 2</li>
          </ul>
          <h2>Benefits</h2>
          <ol>
            <li>Benefit 1</li>
            <li>Benefit 2</li>
          </ol>
        </article>
      `;
      
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('# Main Article');
      expect(result).toContain('Introduction paragraph');
      expect(result).toContain('## Features');
      expect(result).toContain('- Feature 1');
      expect(result).toContain('- Feature 2');
      expect(result).toContain('## Benefits');
      expect(result).toContain('1. Benefit 1');
      expect(result).toContain('2. Benefit 2');
    });

    test('should filter out unwanted elements', () => {
      document.body.innerHTML = `
        <main>
          <h1>Main Content</h1>
          <p>Important content</p>
          <script>console.log('unwanted');</script>
          <style>.test { color: red; }</style>
          <nav>Navigation content</nav>
        </main>
      `;
      
      const result = HtmlToMarkdown.extractPageContent();
      expect(result).toContain('# Main Content');
      expect(result).toContain('Important content');
      expect(result).not.toContain('console.log');
      expect(result).not.toContain('color: red');
      expect(result).not.toContain('Navigation content');
    });
  });

  describe('Table Conversion', () => {
    test('should convert simple tables to lists', () => {
      const html = `
        <table>
          <tr><th>Header 1</th><th>Header 2</th></tr>
          <tr><td>Cell 1</td><td>Cell 2</td></tr>
          <tr><td>Cell 3</td><td>Cell 4</td></tr>
        </table>
      `;
      
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('Table content:');
      expect(result).toContain('- Header 1, Header 2');
      expect(result).toContain('- Cell 1, Cell 2');
      expect(result).toContain('- Cell 3, Cell 4');
    });
  });

  describe('Selection and Page Extraction', () => {
    test('should find main content areas', () => {
      document.body.innerHTML = `
        <header>Site Header</header>
        <nav>Navigation</nav>
        <main>
          <h1>Main Title</h1>
          <p>Main content goes here.</p>
        </main>
        <footer>Site Footer</footer>
      `;
      
      const result = HtmlToMarkdown.extractPageContent();
      expect(result).toContain('# Main Title');
      expect(result).toContain('Main content goes here');
      // Should filter out header, nav, footer by default
    });

    test('should handle missing main element', () => {
      document.body.innerHTML = `
        <div class="content">
          <h1>Page Title</h1>
          <p>Page content.</p>
        </div>
      `;
      
      // Should fallback to extracting from body
      const result = HtmlToMarkdown.extractPageContent();
      expect(result).toContain('# Page Title');
      expect(result).toContain('Page content');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty input', () => {
      expect(HtmlToMarkdown.convert('')).toBe('');
      expect(HtmlToMarkdown.convert(null)).toBe('');
    });

    test('should handle malformed HTML', () => {
      const html = '<h1>Unclosed header<p>Paragraph<li>List item';
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('Unclosed header');
      expect(result).toContain('Paragraph');
      expect(result).toContain('List item');
    });

    test('should handle deeply nested structures', () => {
      const html = `
        <div>
          <div>
            <div>
              <h2>Nested Header</h2>
              <p>Nested <strong>content</strong> with <em>formatting</em>.</p>
            </div>
          </div>
        </div>
      `;
      
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('## Nested Header');
      expect(result).toContain('**content**');
      expect(result).toContain('*formatting*');
    });
  });

  describe('Real-World GitHub Examples', () => {
    test('should handle typical GitHub README structure', () => {
      const html = `
        <div class="markdown-body">
          <h1>Repository Name</h1>
          <p>A brief description of the project.</p>
          <h2>Features</h2>
          <ul>
            <li>🎯 Feature 1</li>
            <li>⚡ Feature 2</li>
            <li>🎨 Feature 3</li>
          </ul>
          <h2>Installation</h2>
          <ol>
            <li>Clone the repository</li>
            <li>Install dependencies</li>
            <li>Run the application</li>
          </ol>
        </div>
      `;
      
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('# Repository Name');
      expect(result).toContain('## Features');
      expect(result).toContain('- 🎯 Feature 1');
      expect(result).toContain('- ⚡ Feature 2');
      expect(result).toContain('## Installation');
      expect(result).toContain('1. Clone the repository');
      expect(result).toContain('2. Install dependencies');
    });

    test('should handle GitHub issue and PR descriptions', () => {
      const html = `
        <div class="comment-body">
          <h3>Summary</h3>
          <p>This PR adds new functionality.</p>
          <h3>Changes</h3>
          <ul>
            <li>Added feature X</li>
            <li>Fixed bug Y</li>
            <li>Updated documentation</li>
          </ul>
          <h3>Testing</h3>
          <p>All tests pass.</p>
        </div>
      `;
      
      const result = HtmlToMarkdown.convert(html);
      expect(result).toContain('### Summary');
      expect(result).toContain('### Changes');
      expect(result).toContain('- Added feature X');
      expect(result).toContain('- Fixed bug Y');
      expect(result).toContain('### Testing');
    });
    
    test('should handle GitHub markdown-heading with permalink anchors', () => {
      const html = `
        <div class="markdown-heading" dir="auto">
          <h2 tabindex="-1" class="heading-element" dir="auto">Features</h2>
          <a id="user-content-features" class="anchor" aria-label="Permalink: Features" href="#features">
            <svg class="octicon octicon-link" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true">
              <path d="..."></path>
            </svg>
          </a>
        </div>
        <ul dir="auto">
          <li>🎯 Read selected text</li>
          <li>🎭 Multiple voices</li>
        </ul>
      `;
      
      const result = HtmlToMarkdown.convert(html);
      // Should have the header without the anchor link
      expect(result).toContain('## Features');
      // Should NOT have empty link markup
      expect(result).not.toContain('[](#features)');
      expect(result).not.toContain('[]');
      // Should have the list items
      expect(result).toContain('- 🎯 Read selected text');
      expect(result).toContain('- 🎭 Multiple voices');
    });
  });
});