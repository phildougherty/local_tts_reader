/**
 * Jest tests for TextProcessor class
 * Run with: npm test
 */

// Import TextProcessor
require('./textProcessor.js');
const TextProcessor = window.TextProcessor;

describe('TextProcessor', () => {
  describe('Header Processing', () => {
    describe('Markdown Headers', () => {
      test('should add colon to single H1 header', () => {
        expect(TextProcessor.process('# Main Title')).toBe('Main Title:');
      });

      test('should add colon to H2 header', () => {
        expect(TextProcessor.process('## Section Header')).toBe('Section Header:');
      });

      test('should add colon to H3 header', () => {
        expect(TextProcessor.process('### Subsection')).toBe('Subsection:');
      });

      test('should create natural transition from header to content', () => {
        const input = '## Important Note\nThis is the content that follows.';
        const expected = 'Important Note: This is the content that follows.';
        expect(TextProcessor.process(input)).toBe(expected);
      });

      test('should process multiple headers correctly', () => {
        const input = `# Main Title
Some intro text.
## Section One
Content for section one.
### Subsection
More detailed content.`;
        
        const expected = 'Main Title: Some intro text. Section One: Content for section one. Subsection: More detailed content.';
        expect(TextProcessor.process(input)).toBe(expected);
      });
    });

    describe('HTML Headers', () => {
      test('should convert H1 HTML tags to markdown format', () => {
        expect(TextProcessor.process('<h1>Main Title</h1>')).toBe('Main Title:');
      });

      test('should convert H2 HTML tags to markdown format', () => {
        expect(TextProcessor.process('<h2>Section Header</h2>')).toBe('Section Header:');
      });

      test('should handle HTML headers with attributes', () => {
        expect(TextProcessor.process('<h1 class="title" id="main">Header Text</h1>')).toBe('Header Text:');
      });

      test('should handle nested HTML in headers', () => {
        expect(TextProcessor.process('<h2>Header with <span>nested</span> content</h2>')).toBe('Header with nested content:');
      });

      test('should convert multiple HTML headers', () => {
        const input = `<h1>Main Title</h1>
Some content here.
<h2>Section One</h2>
More content.`;
        
        const result = TextProcessor.process(input);
        expect(result).toContain('Main Title:');
        expect(result).toContain('Section One:');
      });

      test('should handle title and header semantic elements', () => {
        expect(TextProcessor.process('<title>Page Title</title>')).toBe('Page Title:');
        expect(TextProcessor.process('<header>Header Content</header>')).toBe('Header Content:');
      });
    });

    describe('Text-Based Headers', () => {
      test('should detect ALL CAPS headers', () => {
        expect(TextProcessor.process('FEATURES')).toBe('FEATURES:');
        expect(TextProcessor.process('INSTALLATION GUIDE')).toBe('INSTALLATION GUIDE:');
      });

      test('should detect underlined headers with equals signs', () => {
        const input = `Main Title
=========
Content follows.`;
        
        const result = TextProcessor.process(input);
        expect(result).toContain('Main Title:');
        expect(result).not.toContain('=========');
      });

      test('should detect underlined headers with dashes', () => {
        const input = `Section Header
--------------
Some content here.`;
        
        const result = TextProcessor.process(input);
        expect(result).toContain('Section Header:');
        expect(result).not.toContain('--------------');
      });

      test('should detect likely titles based on context', () => {
        const input = `
Getting Started

This section covers the basics of installation.

Configuration

Here are the configuration options.`;
        
        const result = TextProcessor.process(input);
        expect(result).toContain('Getting Started:');
        expect(result).toContain('Configuration:');
      });

      test('should not detect false positive headers', () => {
        // Long sentences should not be detected as headers
        expect(TextProcessor.process('This is a very long sentence that should not be detected as a header because it is too long.')).not.toContain(':');
        
        // Sentences ending with punctuation should not be headers
        expect(TextProcessor.process('This is a sentence.')).not.toContain('This is a sentence:');
        
        // Mixed case text should not trigger all-caps detection
        expect(TextProcessor.process('Mixed Case Text')).not.toContain('Mixed Case Text:');
      });
    });

    describe('GitHub-style Content', () => {
      test('should handle typical GitHub README structure', () => {
        const input = `# chrome_local_tts_reader

A Chrome extension for local TTS reading.

## Features

- Text chunking for better performance
- Multiple voice options

## Installation

Follow these steps to install.`;
        
        const result = TextProcessor.process(input);
        expect(result).toContain('chrome_local_tts_reader:');
        expect(result).toContain('Features:');
        expect(result).toContain('Installation:');
        expect(result).toContain('Text chunking for better performance, Multiple voice options');
      });

      test('should handle repository sections with underlines', () => {
        const input = `Repository Overview
==================

This repository contains the source code.

Contributing
============

Please follow these guidelines.`;
        
        const result = TextProcessor.process(input);
        expect(result).toContain('Repository Overview:');
        expect(result).toContain('Contributing:');
      });
    });
  });

  describe('List Processing', () => {
    test('should add commas to simple unordered list', () => {
      const input = `- First item
- Second item
- Third item`;
      
      expect(TextProcessor.process(input)).toBe('First item, Second item, Third item');
    });

    test('should add commas to ordered list', () => {
      const input = `1. Step one
2. Step two
3. Step three`;
      
      expect(TextProcessor.process(input)).toBe('Step one, Step two, Step three');
    });

    test('should handle mixed list markers', () => {
      const input = `* Item with asterisk
+ Item with plus
- Item with dash`;
      
      expect(TextProcessor.process(input)).toBe('Item with asterisk, Item with plus, Item with dash');
    });

    test('should handle indented lists', () => {
      const input = `  - Indented item
    - More indented
- Normal indent`;
      
      expect(TextProcessor.process(input)).toBe('Indented item, More indented, Normal indent');
    });

    test('should flow naturally from header to list', () => {
      const input = `## Shopping List
- Apples
- Bananas
- Oranges`;
      
      expect(TextProcessor.process(input)).toBe('Shopping List: Apples, Bananas, Oranges');
    });

    test('should handle Unicode bullet points', () => {
      const input = `• First item
• Second item
• Third item`;
      
      expect(TextProcessor.process(input)).toBe('First item, Second item, Third item');
    });

    test('should handle HTML list items', () => {
      const input = `<ul>
<li>First item</li>
<li>Second item</li>
<li>Third item</li>
</ul>`;
      
      expect(TextProcessor.process(input)).toBe('First item, Second item, Third item');
    });

    test('should handle emoji-prefixed lists', () => {
      const input = `🎯 First item
🎭 Second item
🚀 Third item`;
      
      const result = TextProcessor.process(input);
      expect(result).toContain('First item,');
      expect(result).toContain('Second item,');
      expect(result).toContain('Third item');
      // Note: Some emojis might not be fully removed due to Unicode complexity
    });

    test('should preserve italics while processing lists', () => {
      const input = `Features
This has *italic text* in a sentence.
- First item
* Second item`;
      
      const result = TextProcessor.process(input);
      expect(result).toContain('italic text');
      expect(result).toContain('First item,');
      expect(result).toContain('Second item');
    });
  });

  describe('Comma Cleanup', () => {
    test('should handle complex text with headers and lists', () => {
      const input = `## Features
- Fast processing
- Easy to use
- Reliable

## Benefits
- Saves time
- Improves accuracy`;
      
      const expected = 'Features: Fast processing, Easy to use, Reliable. Benefits: Saves time, Improves accuracy';
      expect(TextProcessor.process(input)).toBe(expected);
    });

    test('should not add trailing comma to single item', () => {
      expect(TextProcessor.process('- Only item')).toBe('Only item');
    });

    test('should normalize comma spacing', () => {
      const input = '- Item one\n- Item two\n\n- Item three';
      expect(TextProcessor.process(input)).toBe('Item one, Item two, Item three');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty text', () => {
      expect(TextProcessor.process('')).toBe('');
    });

    test('should handle null/undefined input', () => {
      expect(TextProcessor.process(null)).toBe('');
      expect(TextProcessor.process(undefined)).toBe('');
    });

    test('should handle only headers', () => {
      expect(TextProcessor.process('# Title\n## Subtitle')).toBe('Title: Subtitle:');
    });

    test('should handle only lists', () => {
      expect(TextProcessor.process('- Item 1\n- Item 2')).toBe('Item 1, Item 2');
    });

    test('should process mixed markdown content', () => {
      const input = `# Title
**Bold text** and *italic text*
- List item with [link](http://example.com)
- Another item with \`code\``;
      
      const result = TextProcessor.process(input);
      
      expect(result).toContain('Title:');
      expect(result).toContain('List item with link,');
      expect(result).not.toContain('**');
      expect(result).not.toContain('*');
    });
  });

  describe('Markdown Processing', () => {
    test('should remove bold and italic formatting', () => {
      expect(TextProcessor.process('**bold** and *italic*')).toBe('bold and italic');
      expect(TextProcessor.process('__bold__ and _italic_')).toBe('bold and italic');
    });

    test('should handle code blocks', () => {
      const input = 'Text with ```code block``` and `inline code`.';
      const result = TextProcessor.process(input);
      expect(result).toContain('code block omitted');
      expect(result).toContain('inline code');
      expect(result).not.toContain('```');
      expect(result).not.toContain('`');
    });

    test('should extract link text', () => {
      expect(TextProcessor.process('[link text](http://example.com)')).toBe('link text');
    });

    test('should process standalone URLs', () => {
      const result = TextProcessor.process('Visit http://example.com for info');
      expect(result).toContain('[Example dot com link]');
    });
  });

  describe('Symbol Processing', () => {
    test('should replace common symbols with words', () => {
      expect(TextProcessor.process('Price: $100 & 50%')).toBe('Price: dollars 100 and 50 percent');
    });

    test('should clean up multiple dots', () => {
      expect(TextProcessor.process('Text...with...dots')).toBe('Text.with.dots');
    });

    test('should remove HTML tags', () => {
      expect(TextProcessor.process('Text with <span>HTML</span> tags')).toBe('Text with HTML tags');
    });
  });

  describe('Real-World Examples', () => {
    test('should process API documentation format', () => {
      const input = `# API Documentation

## Getting Started
1. Install the package
2. Import the module
3. Initialize the client

## Features
- Fast and reliable
- Easy to integrate
- Comprehensive documentation

### Authentication
Follow these steps to authenticate.`;
      
      const result = TextProcessor.process(input);
      
      expect(result).toContain('API Documentation:');
      expect(result).toContain('Getting Started:');
      expect(result).toContain('Install the package, Import the module, Initialize the client');
      expect(result).toContain('Fast and reliable, Easy to integrate, Comprehensive documentation');
      expect(result).toContain('Authentication:');
    });

    test('should process README format', () => {
      const input = `# Project Name
A brief description of the project.

## Installation
\`\`\`bash
npm install package-name
\`\`\`

## Usage
- Import the library
- Create an instance
- Call the methods

Visit [our website](https://example.com) for more info.`;
      
      const result = TextProcessor.process(input);
      
      expect(result).toContain('Project Name:');
      expect(result).toContain('Installation:');
      expect(result).toContain('code block omitted');
      expect(result).toContain('Import the library, Create an instance, Call the methods');
      expect(result).toContain('our website');
    });
  });

  describe('Performance', () => {
    test('should handle large text efficiently', () => {
      // Generate a large markdown document
      const sections = [];
      for (let i = 1; i <= 100; i++) {
        sections.push(`## Section ${i}`);
        for (let j = 1; j <= 10; j++) {
          sections.push(`- Item ${i}.${j}`);
        }
      }
      const largeInput = sections.join('\n');
      
      const startTime = Date.now();
      const result = TextProcessor.process(largeInput);
      const endTime = Date.now();
      
      expect(result).toBeTruthy();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
      expect(result).toContain('Section 1:');
      expect(result).toContain('Item 1.1,');
    });
  });
});