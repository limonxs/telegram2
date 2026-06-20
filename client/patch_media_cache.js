const fs = require('fs');
const path = require('path');
const target = 'c:/Users/liman/Desktop/telegram2/client/src/App.jsx';
let code = fs.readFileSync(target, 'utf8');

// 1. Inject caching utilities at the top
const importsMark = `import './index.css';`;
const cacheUtils = `

// --- File System Caching for Media ---
const fsNode = window.require ? window.require('fs') : null;
const pathNode = window.require ? window.require('path') : null;
const BufferNode = window.require ? window.require('buffer').Buffer : null;

function getCacheDir(username) {
  if (!fsNode || !pathNode || !username) return null;
  const basePath = pathNode.join(window.process.cwd(), 'cache');
  if (!fsNode.existsSync(basePath)) fsNode.mkdirSync(basePath);
  const userPath = pathNode.join(basePath, username);
  if (!fsNode.existsSync(userPath)) fsNode.mkdirSync(userPath);
  return userPath;
}

function getCachedFileUrl(username, mediaId) {
  if (!fsNode || !pathNode || !username) return null;
  const dir = getCacheDir(username);
  if (!dir || !fsNode.existsSync(dir)) return null;
  const files = fsNode.readdirSync(dir);
  const file = files.find(f => f.startsWith(mediaId + '.'));
  if (file) {
    return 'file:///' + pathNode.join(dir, file).replace(/\\\\/g, '/');
  }
  return null;
}

function saveToCacheAsBinary(username, mediaId, dataUrl) {
  if (!fsNode || !pathNode || !BufferNode || !dataUrl) return null;
  try {
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches) return null;
    let extMatch = matches[1].split('/')[1] || 'bin';
    let ext = extMatch.split(';')[0];
    if (ext.includes('+')) ext = ext.split('+')[0];
    const p = pathNode.join(getCacheDir(username), \`\${mediaId}.\${ext}\`);
    const buffer = BufferNode.from(matches[2], 'base64');
    fsNode.writeFileSync(p, buffer);
    return 'file:///' + p.replace(/\\\\/g, '/');
  } catch (e) {
    console.error('Failed to save binary to cache', e);
    return null;
  }
}
`;

if (!code.includes('File System Caching for Media')) {
  code = code.replace(importsMark, importsMark + cacheUtils);
}

// 2. Add media request function inside App component
const appStartMark = `function App() {`;
const mediaRequestFunc = `
  const requestMedia = (type, id, chatId) => {
    if (!newSocket) return;
    newSocket.emit('request_media', { type, id, chatId }, (res) => {
      if (res && res.success && res.dataUrl) {
        if (type === 'chat') {
           const decUrl = decryptMessage(res.dataUrl, chatId);
           const cached = saveToCacheAsBinary(username, id, decUrl);
           setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: c.messages.map(m => m.id === id ? { ...m, fileUrl: cached || decUrl } : m) } : c));
        } else if (type === 'wall') {
           const cached = saveToCacheAsBinary(username, id, res.dataUrl);
           setWallPosts(prev => prev.map(p => p.id === id ? { ...p, mediaUrl: cached || res.dataUrl } : p));
        } else if (type === 'feed') {
           const cached = saveToCacheAsBinary(username, id, res.dataUrl);
           setFeedPosts(prev => prev.map(p => p.id === id ? { ...p, mediaUrl: cached || res.dataUrl } : p));
        }
      }
    });
  };
`;
if (!code.includes('const requestMedia =')) {
  code = code.replace(appStartMark, appStartMark + mediaRequestFunc);
}

// 3. Update Decryption inside Login logic
const loginDecryptSearch = `fileUrl: msg.fileUrl ? decryptMessage(msg.fileUrl, chat.id) : null,`;
const loginDecryptReplace = `fileUrl: msg.fileUrl ? decryptMessage(msg.fileUrl, chat.id) : (msg.hasMedia ? getCachedFileUrl(username, msg.id) : null),
                hasMedia: msg.hasMedia,`;
if (code.includes(loginDecryptSearch)) {
  code = code.replace(loginDecryptSearch, loginDecryptReplace);
}

// 4. Update Decryption inside chat_message event
const chatMsgDecryptSearch = `const decryptedMsg = {
          ...message,
          text: decryptMessage(message.text, chatId),
          fileUrl: message.fileUrl ? decryptMessage(message.fileUrl, chatId) : null,
          fileName: message.fileName ? decryptMessage(message.fileName, chatId) : null,
          transcription: message.transcription ? decryptMessage(message.transcription, chatId) : null
        };`;
const chatMsgDecryptReplace = `const decryptedMsg = {
          ...message,
          text: decryptMessage(message.text, chatId),
          fileUrl: message.fileUrl ? decryptMessage(message.fileUrl, chatId) : (message.hasMedia ? getCachedFileUrl(username, message.id) : null),
          hasMedia: message.hasMedia,
          fileName: message.fileName ? decryptMessage(message.fileName, chatId) : null,
          transcription: message.transcription ? decryptMessage(message.transcription, chatId) : null
        };`;
if (code.includes(chatMsgDecryptSearch)) {
  code = code.replace(chatMsgDecryptSearch, chatMsgDecryptReplace);
}

// 5. Update UI rendering for message media placeholder
// Instead of `{msg.fileUrl && ( ... )}`, we do `{msg.hasMedia && ...}`
const mediaRenderSearch = `{msg.fileUrl && (
                      msg.fileType === 'audio' ? (`;
const mediaRenderReplace = `{msg.hasMedia && !msg.fileUrl && (
                      <div className="message-media-placeholder" onClick={() => requestMedia('chat', msg.id, activeChat.id)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '20px', border: '1px dashed var(--primary)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                          <span style={{ opacity: 0.5 }}><FolderIcon size={48} /></span>
                          <span style={{ color: 'var(--primary)', fontSize: '13px' }}>Кликните для загрузки ({msg.fileName || 'медиа'})</span>
                        </div>
                      </div>
                    )}
                    {msg.fileUrl && (
                      msg.fileType === 'audio' ? (`;
if (code.includes(mediaRenderSearch)) {
  code = code.replace(mediaRenderSearch, mediaRenderReplace);
}

// 6. Fix get_feed_posts callback mapping
const feedPostsUpdateSearch = `setFeedPosts(res.posts);`;
const feedPostsUpdateReplace = `setFeedPosts(res.posts.map(p => ({ ...p, mediaUrl: p.mediaUrl || (p.hasMedia ? getCachedFileUrl(username, p.id) : null) })));`;
if (code.includes(feedPostsUpdateSearch)) {
  code = code.replace(feedPostsUpdateSearch, feedPostsUpdateReplace);
}

const wallPostsUpdateSearch = `setWallPosts(res.posts);`;
const wallPostsUpdateReplace = `setWallPosts(res.posts.map(p => ({ ...p, mediaUrl: p.mediaUrl || (p.hasMedia ? getCachedFileUrl(username, p.id) : null) })));`;
if (code.includes(wallPostsUpdateSearch)) {
  code = code.replace(wallPostsUpdateSearch, wallPostsUpdateReplace);
}

// 7. Update feed/wall post creation handler
const feedPostCreatedSearch = `newSocket.on('feed_post_created', (post) => {
      setFeedPosts(prev => [post, ...prev]);
    });`;
const feedPostCreatedReplace = `newSocket.on('feed_post_created', (post) => {
      const p = { ...post, mediaUrl: post.mediaUrl || (post.hasMedia ? getCachedFileUrl(username, post.id) : null) };
      setFeedPosts(prev => [p, ...prev]);
    });`;
if (code.includes(feedPostCreatedSearch)) {
  code = code.replace(feedPostCreatedSearch, feedPostCreatedReplace);
}

const wallPostCreatedSearch = `newSocket.on('wall_post_created', handleNewPost);`;
// We'll replace it inside handleNewPost instead, or just inline
const handleNewPostSearch = `const handleNewPost = (post) => {
      setWallPosts(prev => {
        if (post.targetUser === targetProfile.username) {
          return [post, ...prev].sort((a, b) => b.timestamp - a.timestamp);
        }
        return prev;
      });
    };`;
const handleNewPostReplace = `const handleNewPost = (post) => {
      const p = { ...post, mediaUrl: post.mediaUrl || (post.hasMedia ? getCachedFileUrl(username, post.id) : null) };
      setWallPosts(prev => {
        if (p.targetUser === targetProfile.username) {
          return [p, ...prev].sort((a, b) => b.timestamp - a.timestamp);
        }
        return prev;
      });
    };`;
if (code.includes(handleNewPostSearch)) {
  code = code.replace(handleNewPostSearch, handleNewPostReplace);
}

// 8. Update UI rendering for wall post placeholders
const wallRenderSearch = `{post.mediaType === 'graffiti' || post.mediaType === 'image' ? (
                    <div className="wall-post-graffiti">`;
const wallRenderReplace = `{post.hasMedia && !post.mediaUrl ? (
                    <div className="wall-post-graffiti placeholder" onClick={() => requestMedia('wall', post.id)} style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', border: '1px dashed var(--primary)', borderRadius: '12px' }}>
                       <span style={{ color: 'var(--primary)' }}>Кликните для загрузки медиа</span>
                    </div>
                  ) : post.mediaType === 'graffiti' || post.mediaType === 'image' ? (
                    <div className="wall-post-graffiti">`;
if (code.includes(wallRenderSearch)) {
  code = code.replace(wallRenderSearch, wallRenderReplace);
}

fs.writeFileSync(target, code, 'utf8');
console.log('App.jsx patched successfully');
