require('@babel/register')({ presets: ['@babel/preset-react'] });
const React = require('react');
const ReactDOMServer = require('react-dom/server');

// Mock localStorage and window
global.window = {
  require: () => ({ ipcRenderer: { on: () => {}, invoke: () => {} } }),
  AudioContext: class {},
  webkitAudioContext: class {}
};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.navigator = { mediaDevices: { enumerateDevices: async () => [] } };
global.document = { getElementById: () => ({ click: () => {} }) };

// Mock lucide-react to avoid SVGs blowing up
const mockIcon = () => React.createElement('div', null, 'Icon');
require.cache[require.resolve('lucide-react')] = {
  exports: new Proxy({}, { get: () => mockIcon })
};

const App = require('./src/App.jsx').default;

try {
  // Try to render the initial state (disconnected)
  let html = ReactDOMServer.renderToString(React.createElement(App));
  console.log("Initial render success! Length:", html.length);
  
  // To test the "connected" state, we'd need to mock state inside App, which is hard.
  // We can patch App.jsx temporarily to set connected = true initially!
} catch (e) {
  console.error("Render crash:", e);
}
