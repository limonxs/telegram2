const fs = require('fs');
const content = fs.readFileSync('c:/Users/liman/Desktop/telegram2/client/src/App.jsx', 'utf8');
const lines = content.split('\n');
const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}]/gu;
lines.forEach((line, index) => {
  if (emojiRegex.test(line) || line.includes('▶') || line.includes('⏸') || line.includes('✕') || line.includes('🔇') || line.includes('🔊') || line.includes('⛶') || line.includes('🗗')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
