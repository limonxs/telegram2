const fs = require('fs');

// Patch App.jsx
const appPath = 'c:/Users/liman/Desktop/telegram2/client/src/App.jsx';
let appCode = fs.readFileSync(appPath, 'utf8');

const feedViewSearch = `<FeedView 
            socket={newSocket}`;
const feedViewReplace = `<FeedView 
            socket={newSocket}
            onRequestMedia={(id) => requestMedia('feed', id, null)}`;
if (appCode.includes(feedViewSearch)) {
  appCode = appCode.replace(feedViewSearch, feedViewReplace);
  fs.writeFileSync(appPath, appCode, 'utf8');
  console.log('App.jsx FeedView prop added.');
}

// Patch FeedView.jsx
const feedPath = 'c:/Users/liman/Desktop/telegram2/client/src/FeedView.jsx';
let feedCode = fs.readFileSync(feedPath, 'utf8');

// Add onRequestMedia to props
feedCode = feedCode.replace(`export default function FeedView({ socket, username, onlineUsers }) {`, `export default function FeedView({ socket, username, onlineUsers, onRequestMedia }) {`);

// Update media rendering
const mediaRenderSearch = `{post.mediaUrl && (
                  <div style={{ borderRadius: '12px', overflow: 'hidden', marginBottom: '16px' }}>`;
const mediaRenderReplace = `{post.hasMedia && !post.mediaUrl && (
                  <div className="feed-media-placeholder" onClick={() => onRequestMedia(post.id)} style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '40px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--primary)' }}>
                    <span style={{ color: 'var(--primary)', fontSize: '14px' }}>Кликните для загрузки медиа</span>
                  </div>
                )}
                {post.mediaUrl && (
                  <div style={{ borderRadius: '12px', overflow: 'hidden', marginBottom: '16px' }}>`;
if (feedCode.includes(mediaRenderSearch)) {
  feedCode = feedCode.replace(mediaRenderSearch, mediaRenderReplace);
  fs.writeFileSync(feedPath, feedCode, 'utf8');
  console.log('FeedView.jsx patched successfully.');
}
