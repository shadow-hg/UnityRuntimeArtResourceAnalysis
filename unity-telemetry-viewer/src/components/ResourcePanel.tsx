import React, { useMemo, useState } from 'react';

export default function ResourcePanel({ resources, onSelect }: { resources: any[] | undefined; onSelect?: (r: any) => void }) {
  const list = resources || [];
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return list;
    const f = filter.toLowerCase();
    return list.filter((r) => (r.name || '').toLowerCase().includes(f) || (r.type || '').toLowerCase().includes(f));
  }, [list, filter]);

  return (
    <div style={{ padding: 12 }}>
      <h3>Resources ({filtered.length})</h3>
      <div style={{ marginBottom: 8 }}>
        <input placeholder="filter name or type" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {filtered.map((r, i) => (
          <div key={i} style={{ padding: 6, borderBottom: '1px solid #eee', display: 'flex', gap: 8, cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect && onSelect(r)}>
            {r.thumbnailUrl ? <img src={r.thumbnailUrl} style={{ width: 64, height: 64, objectFit: 'cover' }} /> : <div style={{ width: 64, height: 64, background: '#222' }} />}
            <div>
              <strong>{r.name}</strong> [{r.type}]<br />{r.width}x{r.height} size:{r.sizeKB}KB
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
