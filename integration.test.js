/**
 * Integration tests showing HTML to Markdown + TextProcessor pipeline
 * Demonstrates improved structure preservation
 */

require('./htmlToMarkdown.js');
require('./textProcessor.js');

const HtmlToMarkdown = window.HtmlToMarkdown;
const TextProcessor = window.TextProcessor;

describe('HTML Parsing Integration', () => {
  describe('Comparison: Old vs New Approach', () => {
    test('should preserve list structure that was lost with innerText', () => {
      // Sample HTML content like from GitHub
      const html = `
        <div class="markdown-body">
          <h1>Project Features</h1>
          <p>This project includes:</p>
          <ul>
            <li>🎯 Fast performance</li>
            <li>⚡ Easy integration</li>
            <li>🎨 Modern design</li>
          </ul>
          <h2>Installation Steps</h2>
          <ol>
            <li>Clone the repository</li>
            <li>Install dependencies</li>
            <li>Run the application</li>
          </ol>
        </div>
      `;
      
      // Create a temporary DOM element
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      
      // OLD APPROACH: Using innerText (loses structure)
      const oldApproachText = tempDiv.innerText;
      const oldResult = TextProcessor.process(oldApproachText);
      
      // NEW APPROACH: HTML to Markdown then TextProcessor
      const markdownText = HtmlToMarkdown.convert(html);
      const newResult = TextProcessor.process(markdownText);
      
      // The new approach should preserve headers and list structure
      expect(newResult).toContain('Project Features:');
      expect(newResult).toContain('Installation Steps:');
      expect(newResult).toContain('🎯 Fast performance, ⚡ Easy integration, 🎨 Modern design');
      expect(newResult).toContain('Clone the repository, Install dependencies, Run the application');
      
      // Show that the old approach loses important formatting cues
      console.log('OLD APPROACH RESULT:');
      console.log(oldResult);
      console.log('\nNEW APPROACH RESULT:');
      console.log(newResult);
      
      // The new approach should be significantly better at preserving meaning
      expect(newResult.includes(':')).toBe(true); // Headers get colons
      expect(newResult.includes(',')).toBe(true); // Lists get commas
    });
    
    test('should handle GitHub README structure better', () => {
      const githubHtml = `
        <article class="markdown-body">
          <h1>chrome_local_tts_reader</h1>
          <p>A Chrome extension for local TTS reading.</p>
          
          <h2>Features</h2>
          <ul>
            <li>Text chunking for better performance</li>
            <li>Multiple voice options</li>
            <li>Keyboard shortcuts</li>
          </ul>
          
          <h2>Usage</h2>
          <ol>
            <li>Install the extension</li>
            <li>Configure your settings</li>
            <li>Select text and click play</li>
          </ol>
          
          <h3>Voice Options</h3>
          <p>Available voices include:</p>
          <ul>
            <li>Adam (Alloy)</li>
            <li>Nicole (Ash)</li>
            <li>Emma (Coral)</li>
          </ul>
        </article>
      `;
      
      const markdown = HtmlToMarkdown.convert(githubHtml);
      const result = TextProcessor.process(markdown);
      
      // Should create natural speech flow
      expect(result).toContain('chrome_local_tts_reader:');
      expect(result).toContain('Features:');
      expect(result).toContain('Text chunking for better performance, Multiple voice options, Keyboard shortcuts');
      expect(result).toContain('Usage:');
      expect(result).toContain('Install the extension, Configure your settings, Select text and click play');
      expect(result).toContain('Voice Options:');
      expect(result).toContain('Adam (Alloy), Nicole (Ash), Emma (Coral)');
      
      // Should flow naturally between sections
      expect(result).toContain('. Usage:');
      expect(result).toContain('. Voice Options:');
    });
    
    test('should handle complex nested HTML structures', () => {
      const complexHtml = `
        <div class="container">
          <section class="main-content">
            <header>
              <h1>API Documentation</h1>
            </header>
            <div class="content">
              <h2>Authentication</h2>
              <p>To authenticate, use one of these methods:</p>
              <ul>
                <li><strong>API Key</strong>: Include in headers</li>
                <li><em>OAuth</em>: Use OAuth 2.0 flow</li>
                <li><code>JWT</code>: JSON Web Tokens</li>
              </ul>
              
              <h2>Endpoints</h2>
              <table>
                <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
                <tr><td>GET</td><td>/api/users</td><td>List users</td></tr>
                <tr><td>POST</td><td>/api/users</td><td>Create user</td></tr>
              </table>
            </div>
          </section>
          <nav class="sidebar">
            <ul>
              <li><a href="#auth">Authentication</a></li>
              <li><a href="#endpoints">Endpoints</a></li>
            </ul>
          </nav>
        </div>
      `;
      
      const result = TextProcessor.process(HtmlToMarkdown.convert(complexHtml));
      
      // Should extract main content and preserve structure
      expect(result).toContain('API Documentation:');
      expect(result).toContain('Authentication:');
      expect(result).toContain('API Key: Include in headers');
      expect(result).toContain('Endpoints:');
      expect(result).toContain('Table content:');
      expect(result).toContain('Method, Endpoint, Description');
      
      // The main conversion should work correctly
      expect(result).toContain('GET, /api/users, List users');
    });
  });
  
  describe('Real-World Benefits', () => {
    test('should make TTS sound more natural with proper pauses', () => {
      const beforeHtml = `
        <h2>Benefits</h2>
        <ul>
          <li>Faster processing</li>
          <li>Better accuracy</li>
          <li>Improved reliability</li>
        </ul>
      `;
      
      // Without structure preservation (old way)
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = beforeHtml;
      const flatText = tempDiv.innerText; // "Benefits\nFaster processing\nBetter accuracy\nImproved reliability"
      
      // With structure preservation (new way)
      const structuredMarkdown = HtmlToMarkdown.convert(beforeHtml);
      const processedText = TextProcessor.process(structuredMarkdown);
      
      // The processed text should have natural pauses and flow
      expect(processedText).toBe('Benefits: Faster processing, Better accuracy, Improved reliability');
      
      // This will sound much more natural when read by TTS:
      // "Benefits: Faster processing, Better accuracy, Improved reliability"
      // vs
      // "Benefits Faster processing Better accuracy Improved reliability"
    });
  });
});