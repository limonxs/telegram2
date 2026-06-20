const fs = require('fs');
const path = 'c:/Users/liman/Desktop/telegram2/client/src/App.jsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(/<_TEMP_SLASH_/g, '</');

fs.writeFileSync(path, code, 'utf8');
console.log('Fixed TEMP_SLASH issue.');
