const fs = require('fs');
const path = 'c:/Users/liman/Desktop/telegram2/client/src/App.jsx';
let code = fs.readFileSync(path, 'utf8');

// Replace Tenor logic with Giphy logic
const tenorRegex = /function TenorSearchModal\(\{ onClose, onSelect \}\) \{[\s\S]*?\}\s*function ProfileWall/g;

const giphyLogic = `function GiphySearchModal({ onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchGifs = async (searchQuery) => {
    setLoading(true);
    try {
      const apiKey = 'LvhxmQLv5zTNs516gEP5E9Zd7yFqXgcl'; // Giphy key
      const url = searchQuery.trim() 
        ? \`https://api.giphy.com/v1/gifs/search?api_key=\${apiKey}&q=\${encodeURIComponent(searchQuery)}&limit=15&rating=g\`
        : \`https://api.giphy.com/v1/gifs/trending?api_key=\${apiKey}&limit=15&rating=g\`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.data) {
        setGifs(data.data.map(item => item.images.fixed_height.url));
      }
    } catch (e) {
      console.error('Failed to fetch GIFs from Giphy:', e);
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
          <span className="graffiti-canvas-title"><GiphyIcon size={16} style={{marginRight: "6px"}}/> Поиск GIF (Giphy)</span>
          <button className="close-profile-btn" style={{ margin: 0, padding: '4px 8px', fontSize: '12px' }} onClick={onClose}><CloseIcon size={12} /></button>
        </div>
        
        <input
          type="text"
          className="sidebar-search input"
          style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', outline: 'none', margin: '10px 0' }}
          placeholder="Поиск гифок..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              fetchGifs(query);
            }
          }}
        />

        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', paddingRight: '4px' }}>
          {loading ? (
            <div style={{ gridColumn: 'span 2', textAlign: 'center', color: 'var(--text-muted)', paddingTop: '40px' }}>Загрузка...</div>
          ) : gifs.length === 0 ? (
            <div style={{ gridColumn: 'span 2', textAlign: 'center', color: 'var(--text-muted)', paddingTop: '40px' }}>Ничего не найдено</div>
          ) : (
            gifs.map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt="gif"
                style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '8px', cursor: 'pointer', border: '1px solid transparent', transition: 'border-color 0.2s' }}
                onClick={() => onSelect(url)}
                onMouseOver={e => e.target.style.borderColor = '#8a2be2'}
                onMouseOut={e => e.target.style.borderColor = 'transparent'}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileWall`;

code = code.replace(tenorRegex, giphyLogic);

// Replace state references
code = code.replace(/showTenor/g, 'showGiphy');
code = code.replace(/setShowTenor/g, 'setShowGiphy');
code = code.replace(/TenorSearchModal/g, 'GiphySearchModal');
code = code.replace(/Поиск GIF \(Tenor\)/g, 'Поиск GIF (Giphy)');

fs.writeFileSync(path, code, 'utf8');
console.log('Reverted to Giphy.');
