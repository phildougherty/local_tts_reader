/**
 * Jest setup file for Chrome extension testing
 */

// Mock window object and browser APIs
global.window = global.window || {};
global.document = global.document || {};

// Mock URL constructor (for textProcessor.js)
global.URL = global.URL || require('url').URL;

// Mock Chrome extension APIs
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    },
    getContexts: jest.fn(),
    onInstalled: {
      addListener: jest.fn()
    }
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  tabs: {
    query: jest.fn()
  },
  scripting: {
    executeScript: jest.fn()
  },
  contextMenus: {
    create: jest.fn(),
    onClicked: {
      addListener: jest.fn()
    }
  },
  commands: {
    onCommand: {
      addListener: jest.fn()
    }
  },
  offscreen: {
    createDocument: jest.fn()
  }
};

// Suppress console logs during tests (optional)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn()
// };