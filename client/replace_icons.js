const fs = require('fs');

const appFile = 'c:/Users/liman/Desktop/telegram2/client/src/App.jsx';
let content = fs.readFileSync(appFile, 'utf8');

const replacements = [
  ['              ▶', '              <PlayIcon size={48} />'],
  ['              🧹 Ластик', '              <EraserIcon size={14} style={{marginRight: "4px"}}/> Ластик'],
  ['              ✕', '              <CloseIcon size={14} />'],
  ['              📷', '              <CameraIcon size={20} />'],
  ['              👾', '              <GiphyIcon size={20} />'],
  ['              🎨', '              <PaintIcon size={20} />'],
  ['              🖥️', '              <ScreenShareIcon size={20} />'],
  ['              🎮', '              <GamingIcon size={20} />'],
  ['              📞', '              <PhoneIcon size={20} />'],
  ['              📌', '              <PinIcon size={14} />'],
  ['              📎', '              <AttachIcon size={20} />'],
  ['              💬 Начать диалог', '              <MessageIcon size={16} style={{marginRight:"6px"}}/> Начать диалог'],
];

for (let [search, replace] of replacements) {
  content = content.replace(search, replace);
}

// Global replace for any straggling standalone emojis on their own lines:
content = content.replace(/^\s*▶\s*$/gm, '              <PlayIcon size={24} />');
content = content.replace(/^\s*✕\s*$/gm, '              <CloseIcon size={14} />');
content = content.replace(/^\s*📷\s*$/gm, '              <CameraIcon size={18} />');
content = content.replace(/^\s*👾\s*$/gm, '              <GiphyIcon size={18} />');
content = content.replace(/^\s*🎨\s*$/gm, '              <PaintIcon size={18} />');
content = content.replace(/^\s*📌\s*$/gm, '              <PinIcon size={14} />');
content = content.replace(/^\s*📎\s*$/gm, '              <AttachIcon size={20} />');
content = content.replace(/^\s*🖥️\s*$/gm, '              <ScreenShareIcon size={20} />');
content = content.replace(/^\s*🎮\s*$/gm, '              <GamingIcon size={20} />');
content = content.replace(/^\s*📞\s*$/gm, '              <PhoneIcon size={20} />');
content = content.replace(/^\s*🧹 Ластик\s*$/gm, '              <EraserIcon size={14} style={{marginRight: "4px"}}/> Ластик');
content = content.replace(/^\s*💬 Начать диалог\s*$/gm, '              <MessageIcon size={16} style={{marginRight:"6px"}}/> Начать диалог');

fs.writeFileSync(appFile, content, 'utf8');
console.log('Replacements done part 3.');
