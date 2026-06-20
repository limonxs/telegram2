const fs = require('fs');
const path = 'c:/Users/liman/Desktop/telegram2/client/src/App.jsx';
let code = fs.readFileSync(path, 'utf8');

// 1. Rename GiphySearchModal to TenorSearchModal and update the API
const tenorModalLogic = `function TenorSearchModal({ onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchGifs = async (searchQuery) => {
    setLoading(true);
    try {
      const apiKey = 'LIVDSRZULECB'; // Public Tenor V1 Key
      const url = searchQuery.trim() 
        ? \`https://api.tenor.com/v1/search?key=\${apiKey}&q=\${encodeURIComponent(searchQuery)}&limit=15&media_filter=minimal\`
        : \`https://api.tenor.com/v1/trending?key=\${apiKey}&limit=15&media_filter=minimal\`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.results) {
        setGifs(data.results.map(item => item.media[0].gif.url));
      }
    } catch (e) {
      console.error('Failed to fetch GIFs from Tenor:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGifs('');
  }, []);

  return (
    <div className="graffiti-modal-overlay" onClick={onClose}>
      <div className="graffiti-modal-content" style={{ width: '400px', height: '500px', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="graffiti-canvas-header">
          <span className="graffiti-canvas-title"><GiphyIcon size={16} style={{marginRight: "6px"}}/> Поиск GIF (Tenor)</span>
          <button className="close-profile-btn" style={{ margin: 0, padding: '4px 8px', fontSize: '12px' }} onClick={onClose}><CloseIcon size={12} /></button>
        </div>
        <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input 
              type="text" 
              placeholder="Поиск GIF..." 
              value={query} 
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchGifs(query)}
              style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-main)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }}
            />
            <button className="start-dm-btn" style={{ padding: '8px 16px' }} onClick={() => fetchGifs(query)}>Искать</button>
          </div>
          
          <div className="scrollable" style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', paddingRight: '4px' }}>
            {loading ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Загрузка...</div>
            ) : gifs.map((url, i) => (
              <img 
                key={i} 
                src={url} 
                alt="gif" 
                style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '4px', cursor: 'pointer' }}
                onClick={() => onSelect(url)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}`;

code = code.replace(/function GiphySearchModal\(\{ onClose, onSelect \}\) \{[\s\S]*?<\//, tenorModalLogic.replace(/<\//g, '<_TEMP_SLASH_')); // Workaround for complex regex matching.

// More robust replace for the modal component:
const startIdx = code.indexOf('function GiphySearchModal');
if (startIdx !== -1) {
  const endModalIdx = code.indexOf('function ProfileWall', startIdx);
  if (endModalIdx !== -1) {
    code = code.substring(0, startIdx) + tenorModalLogic + '\n\n' + code.substring(endModalIdx);
  }
}

// Replace Giphy states and mentions in ProfileWall
code = code.replace(/showGiphy/g, 'showTenor');
code = code.replace(/setShowGiphy/g, 'setShowTenor');
code = code.replace(/<GiphySearchModal/g, '<TenorSearchModal');
code = code.replace(/Поиск GIF \(Giphy\)/g, 'Поиск GIF (Tenor)');


// 2. Add Profile loading to ProfileWall
const profileWallStateLogic = `  const [targetProfile, setTargetProfile] = useState({ aboutText: '', audioUrl: null });
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    if (!socket || !targetUser) return;
    socket.emit('get_user_profile', { username: targetUser }, (res) => {
      if (res && res.success && res.profile) {
        setTargetProfile(res.profile);
      }
      setProfileLoading(false);
    });
  }, [socket, targetUser]);
`;

// Insert the new state and effect after the first useState in ProfileWall
code = code.replace(
  /const \[posts, setPosts\] = useState\(\[\]\);/,
  `const [posts, setPosts] = useState([]);\n${profileWallStateLogic}`
);

// 3. Render Profile Info above the feed
const profileInfoLogic = `
      {!profileLoading && (targetProfile.aboutText || targetProfile.audioUrl) && (
        <div className="wall-profile-info" style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid var(--border)' }}>
          {targetProfile.aboutText && (
            <div style={{ marginBottom: targetProfile.audioUrl ? '16px' : '0' }}>
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '4px', textTransform: 'uppercase' }}>О себе</div>
              <div style={{ fontSize: '14px', color: 'var(--text-main)', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{targetProfile.aboutText}</div>
            </div>
          )}
          {targetProfile.audioUrl && (
            <div className="wall-audio-player" style={{ background: 'var(--bg-main)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)' }}>
               <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '8px', textTransform: 'uppercase' }}>Аудио профиля</div>
               <audio controls src={targetProfile.audioUrl} style={{ width: '100%', height: '36px', outline: 'none' }} />
            </div>
          )}
        </div>
      )}
`;

code = code.replace(
  /<div className="wall-feed">/,
  `${profileInfoLogic}\n      <div className="wall-feed">`
);

fs.writeFileSync(path, code, 'utf8');
console.log('Profile wall patched successfully.');
