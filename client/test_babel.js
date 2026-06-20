const fs = require('fs');
const babel = require('@babel/core');

const code = fs.readFileSync('c:/Users/liman/Desktop/telegram2/client/src/App.jsx', 'utf8');

try {
  const result = babel.transformSync(code, {
    presets: ['@babel/preset-react'],
    filename: 'App.jsx'
  });
  console.log("Babel transpile SUCCESS. This means no syntax errors.");
  
  // Now let's try to mock the environment and evaluate it to see if there's a reference error at the top level
  // Actually, a runtime crash during render won't be caught by just running the file.
  // The error happens when the component executes.
} catch (e) {
  console.error("Babel error:", e);
}
