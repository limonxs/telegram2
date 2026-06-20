const fs = require('fs');
const cssPath = 'c:/Users/liman/Desktop/telegram2/client/src/index.css';
let css = fs.readFileSync(cssPath, 'utf8');

if (!css.includes('.ui-icon')) {
  css += `\n
/* --- UI Icon Styles --- */
.ui-icon {
  display: inline-block;
  vertical-align: middle;
  transition: stroke 0.2s ease, transform 0.2s ease;
}

button:hover .ui-icon,
.graffiti-btn:hover .ui-icon,
.wall-send-btn:hover .ui-icon {
  stroke: var(--primary);
  transform: scale(1.05);
}

.graffiti-btn .ui-icon {
  margin: 0;
}

.custom-player-controls .ui-icon {
  stroke: white;
}
.custom-player-controls button:hover .ui-icon {
  stroke: var(--primary);
}
`;
  fs.writeFileSync(cssPath, css, 'utf8');
  console.log('Appended .ui-icon styles.');
} else {
  console.log('Already appended.');
}
