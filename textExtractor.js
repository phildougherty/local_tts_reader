/**
 * Shared text extraction logic for consistent behavior across popup and keyboard shortcuts
 * This function runs in the page context via chrome.scripting.executeScript
 */
function extractPageText() {
  const selection = window.getSelection();
  
  // Collect debug info
  const debugInfo = {
    hasSelection: selection.rangeCount > 0 && !selection.isCollapsed,
    listCount: document.querySelectorAll('ul, ol').length,
    articleCount: document.querySelectorAll('article').length,
    mainCount: document.querySelectorAll('main').length
  };
  
  if (selection.rangeCount > 0 && !selection.isCollapsed) {
    // User has selected text
    const range = selection.getRangeAt(0);
    const container = document.createElement('div');
    container.appendChild(range.cloneContents());
    
    return {
      type: 'selection',
      html: container.innerHTML,
      text: selection.toString().trim(),
      debug: debugInfo
    };
  } else {
    // No selection - get page content
    const mainSelectors = [
      'main',
      '[role="main"]', 
      'article',
      '.markdown-body',  // GitHub specific
      '.main-content',
      '.content',
      '#content',
      '.post-content',
      '.article-content'
    ];
    
    let targetElement = null;
    let selectorUsed = 'body';
    
    for (const selector of mainSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        targetElement = element;
        selectorUsed = selector;
        break;
      }
    }
    
    if (!targetElement) {
      targetElement = document.body;
    }
    
    // Get first list HTML for debugging
    const firstList = targetElement.querySelector('ul, ol');
    debugInfo.firstListHtml = firstList ? firstList.outerHTML.substring(0, 300) : 'No lists found';
    debugInfo.selector = selectorUsed;
    
    return {
      type: 'page',
      html: targetElement.innerHTML,
      text: targetElement.innerText,
      debug: debugInfo
    };
  }
}

// Make the function available globally when injected
window.extractPageText = extractPageText;