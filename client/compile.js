const babel = require('@babel/core');
const fs = require('fs');

const code = fs.readFileSync('./src/App.jsx', 'utf8');

try {
  const result = babel.transformSync(code, {
    presets: ['@babel/preset-react'],
    filename: 'App.jsx'
  });
  
  fs.writeFileSync('./AppCompiled.js', result.code);
  console.log("Compiled to AppCompiled.js");
} catch (e) {
  console.error("Compile error", e);
}
