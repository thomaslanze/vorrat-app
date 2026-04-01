// ═══════════════════════════════════════════
//  DATENBANK (localStorage)
// ═══════════════════════════════════════════
const DB = {
  _get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  _set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },
  getLocations() {
    return this._get('locations') || [
      { id: 'loc1', name: 'Kühlschrank' },
      { id: 'loc2', name: 'Keller' },
      { id: 'loc3', name: 'Vorratskammer' }
    ];
  },
  saveLocations(locs) { this._set('locations', locs); },
  getItems() { return this._get('items') || []; },
  saveItems(items) { this._set('items', items); },
  addItem(item) {
    item.id = Date.now().toString();
    item.createdAt = new Date().toISOString();
    const items = this.getItems();
    items.push(item);
    this.saveItems(items);
    return item;
  },
  updateItem(id, changes) {
    const items = this.getItems();
    const i = items.findIndex(x => x.id === id);
    if (i === -1) return null;
    items[i] = { ...items[i], ...changes };
    this.saveItems(items);
    return items[i];
  },
  deleteItem(id) {
    this.saveItems(this.getItems().filter(x => x.id !== id));
  },
  findByBarcode(barcode) {
    return this.getItems().find(x => x.barcode === barcode) || null;
  },
  getShoppingList() {
    return this.getItems().filter(x => x.currentQty < x.minQty);
  }
};

// ═══════════════════════════════════════════
//  OPEN FOOD FACTS API
// ═══════════════════════════════════════════
const API = {
  async lookup(barcode) {
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
      const d = await r.json();
      if (d.status === 1 && d.product) {
        const p = d.product;
        return {
          found: true,
          barcode,
          name: p.product_name_de || p.product_name || p.product_name_en || '',
          brand: p.brands || '',
          quantity: p.quantity || '',
          imageUrl: p.image_front_small_url || p.image_url || ''
        };
      }
    } catch { /* network error */ }
    return { found: false, barcode };
  }
};

// ═══════════════════════════════════════════
//  UI HILFSFUNKTIONEN
// ═══════════════════════════════════════════
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escA(s) {
  return String(s ?? '').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

function showToast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function openModal(html) {
  const overlay = document.getElementById('modal-overlay');
  document.getElementById('modal-content').innerHTML =
    '<div class="modal-handle"></div>' + html;
  overlay.classList.remove('hidden');
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function updateBadge() {
  const n = DB.getShoppingList().length;
  const b = document.getElementById('shopping-badge');
  b.textContent = n;
  b.classList.toggle('hidden', n === 0);
}

function addFab(icon, onClick) {
  document.querySelector('.fab')?.remove();
  const btn = document.createElement('button');
  btn.className = 'fab';
  btn.textContent = icon;
  btn.onclick = onClick;
  document.getElementById('app').appendChild(btn);
}

function stepQty(id, delta) {
  const el = document.getElementById(id);
  if (el) el.value = Math.max(0, (parseInt(el.value) || 0) + delta);
}

// ═══════════════════════════════════════════
//  ROUTER
// ═══════════════════════════════════════════
let currentView = '';
let scanner = null;

function navigate(view) {
  if (currentView === 'scanner' && scanner) {
    scanner.stop().catch(() => {});
    scanner = null;
  }
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  document.querySelector('.fab')?.remove();
  const main = document.getElementById('main-content');
  const title = document.getElementById('page-title');
  const actions = document.getElementById('header-actions');
  actions.innerHTML = '';

  if (view === 'inventory') { title.textContent = 'Mein Vorrat'; renderInventory(main); }
  else if (view === 'scanner')  { title.textContent = 'Produkt scannen'; renderScanner(main); }
  else if (view === 'shopping') { title.textContent = 'Einkaufsliste'; renderShopping(main); }
  else if (view === 'settings') { title.textContent = 'Einstellungen'; renderSettings(main); }

  updateBadge();
}

// ═══════════════════════════════════════════
//  VORRAT (INVENTORY)
// ═══════════════════════════════════════════
function renderInventory(container) {
  const items = DB.getItems();
  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🥫</div>
        <div class="empty-title">Noch leer</div>
        <div class="empty-text">Scanne dein erstes Produkt und baue deinen Vorrat auf.</div>
      </div>`;
    addFab('📷', () => navigate('scanner'));
    return;
  }

  const low = items.filter(i => i.currentQty < i.minQty).length;
  const ok  = items.length - low;
  const locations = DB.getLocations();

  container.innerHTML = `
    <div class="stats-bar">
      <div class="stat-card"><div class="stat-number">${items.length}</div><div class="stat-label">Produkte</div></div>
      <div class="stat-card"><div class="stat-number success">${ok}</div><div class="stat-label">Ausreichend</div></div>
      <div class="stat-card"><div class="stat-number ${low > 0 ? 'danger' : ''}">${low}</div><div class="stat-label">Zu wenig</div></div>
    </div>
    <div class="search-bar">
      <input type="search" id="inv-search" class="search-input" placeholder="Produkt suchen …" autocomplete="off">
    </div>
    <div class="filter-row" id="filter-row">
      <button class="filter-pill active" data-loc="all">Alle</button>
      ${locations.map(l => `<button class="filter-pill" data-loc="${esc(l.id)}">${esc(l.name)}</button>`).join('')}
    </div>
    <div id="inv-list" class="view" style="padding-top:0"></div>
  `;

  let activeFilter = 'all', searchQ = '';

  document.getElementById('inv-search').addEventListener('input', e => {
    searchQ = e.target.value.toLowerCase();
    renderInvList(activeFilter, searchQ);
  });
  document.getElementById('filter-row').addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeFilter = pill.dataset.loc;
    renderInvList(activeFilter, searchQ);
  });

  renderInvList('all', '');
  addFab('📷', () => navigate('scanner'));
}

function renderInvList(locFilter, search) {
  const container = document.getElementById('inv-list');
  if (!container) return;
  const locations = DB.getLocations();
  let items = DB.getItems();
  if (locFilter !== 'all') items = items.filter(i => i.locationId === locFilter);
  if (search) items = items.filter(i =>
    i.name.toLowerCase().includes(search) ||
    (i.brand || '').toLowerCase().includes(search)
  );

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Nichts gefunden</div></div>`;
    return;
  }

  // Gruppe nach Lagerort
  const groups = {};
  items.forEach(item => {
    const loc = locations.find(l => l.id === item.locationId);
    const key = loc ? loc.name : '—';
    (groups[key] = groups[key] || []).push(item);
  });

  let html = '';
  for (const [locName, grpItems] of Object.entries(groups)) {
    grpItems.sort((a, b) => (a.currentQty < a.minQty ? 0 : 1) - (b.currentQty < b.minQty ? 0 : 1));
    html += `<div class="section-title">${esc(locName)}</div><div class="item-list">`;
    for (const item of grpItems) {
      const low = item.currentQty < item.minQty;
      html += `
        <div class="item-row">
          <div class="status-dot ${low ? 'low' : 'ok'}"></div>
          <div class="item-info">
            <div class="item-name">${esc(item.name)}</div>
            <div class="item-meta">${esc(item.brand || '')}${item.brand ? ' · ' : ''}Min: ${item.minQty} ${esc(item.unit)}</div>
          </div>
          <div class="qty-display">
            <button class="qty-btn" data-id="${item.id}" data-action="dec">−</button>
            <span class="qty-current ${low ? 'low' : 'ok'}">${item.currentQty}</span>
            <button class="qty-btn" data-id="${item.id}" data-action="inc">+</button>
          </div>
          <button class="item-edit-btn" data-id="${item.id}" data-action="edit">✏️</button>
        </div>`;
    }
    html += `</div>`;
  }
  container.innerHTML = html;

  container.onclick = e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'inc') {
      const it = DB.getItems().find(x => x.id === id);
      if (it) { DB.updateItem(id, { currentQty: it.currentQty + 1 }); refresh(); }
    } else if (action === 'dec') {
      const it = DB.getItems().find(x => x.id === id);
      if (it && it.currentQty > 0) { DB.updateItem(id, { currentQty: it.currentQty - 1 }); refresh(); }
    } else if (action === 'edit') {
      const it = DB.getItems().find(x => x.id === id);
      if (it) showEditModal(it);
    }
    function refresh() {
      const search = document.getElementById('inv-search')?.value.toLowerCase() || '';
      const loc    = document.querySelector('.filter-pill.active')?.dataset.loc || 'all';
      renderInvList(loc, search);
      updateBadge();
    }
  };
}

// ═══════════════════════════════════════════
//  SCANNER
// ═══════════════════════════════════════════
function renderScanner(container) {
  container.innerHTML = `
    <div class="view">
      <div class="card" style="overflow:hidden;margin-bottom:14px;">
        <div id="qr-region"></div>
      </div>
      <p class="scan-hint">Halte die Kamera auf den Barcode des Produkts</p>
      <div style="height:14px"></div>
      <div id="scan-status"></div>
      <div style="height:12px"></div>
      <button class="btn btn-secondary" onclick="showManualModal()">✏️ Manuell hinzufügen</button>
    </div>`;
  startScanner();
}

function startScanner() {
  scanner = new Html5Qrcode('qr-region');
  const cfg = {
    fps: 15,
    qrbox: { width: 270, height: 110 },
    rememberLastUsedCamera: true,
    supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
    showTorchButtonIfSupported: true
  };

  Html5Qrcode.getCameras().then(cams => {
    if (!cams?.length) { showScanError('Keine Kamera gefunden.'); return; }
    const back = cams.find(c =>
      /back|rear|environment|rück/i.test(c.label)
    ) || cams[cams.length - 1];

    scanner.start(back.id, cfg, onBarcode, () => {}).catch(() => {
      scanner.start({ facingMode: 'environment' }, cfg, onBarcode, () => {}).catch(showScanError);
    });
  }).catch(() => showScanError('Kamerazugriff verweigert. Bitte in den Einstellungen erlauben.'));
}

function showScanError(msg) {
  const el = document.getElementById('scan-status');
  if (el) el.innerHTML = `<div style="background:var(--danger-light);color:var(--danger);padding:14px;border-radius:var(--radius-sm);font-size:14px;">${esc(msg)}</div>`;
}

async function onBarcode(barcode) {
  if (!scanner) return;
  await scanner.stop().catch(() => {});
  scanner = null;
  if (navigator.vibrate) navigator.vibrate(60);

  const existing = DB.findByBarcode(barcode);
  if (existing) { showUpdateModal(existing); return; }

  const statusEl = document.getElementById('scan-status');
  if (statusEl) statusEl.innerHTML = `<div class="loading-row"><div class="spinner"></div><span>Produkt wird gesucht …</span></div>`;

  const product = await API.lookup(barcode);
  if (product.found) {
    showAddModal(product);
  } else {
    showManualModal({ barcode });
  }
}

// ═══════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════
function locationOptions(selectedId) {
  return DB.getLocations().map(l =>
    `<option value="${esc(l.id)}" ${l.id === selectedId ? 'selected' : ''}>${esc(l.name)}</option>`
  ).join('');
}

function unitOptions(selected) {
  return ['Stück','Packung','Dose','Flasche','Liter','kg','g'].map(u =>
    `<option value="${u}" ${u === selected ? 'selected' : ''}>${u}</option>`
  ).join('');
}

function productCardHtml(p) {
  const img = p.imageUrl
    ? `<img class="product-img" src="${escA(p.imageUrl)}" alt="">`
    : `<div class="product-img-placeholder">🥫</div>`;
  return `
    <div class="product-card">
      ${img}
      <div>
        <div class="product-card-name">${esc(p.name || 'Unbekanntes Produkt')}</div>
        <div class="product-card-brand">${esc(p.brand || '')}</div>
        <div class="product-card-barcode">${esc(p.barcode)}</div>
      </div>
    </div>`;
}

// Produkt bereits vorhanden → Bestand updaten
function showUpdateModal(item) {
  const loc = DB.getLocations().find(l => l.id === item.locationId);
  openModal(`
    <div class="modal-title">Bereits im Vorrat</div>
    ${productCardHtml(item)}
    <p style="font-size:14px;color:var(--text-muted);margin-bottom:16px;">
      Lagerort: <strong>${esc(loc?.name || '—')}</strong> · Aktuell: <strong>${item.currentQty} ${esc(item.unit)}</strong>
    </p>
    <div class="form-group">
      <label class="form-label">Neuer Bestand</label>
      <div class="qty-input-wrap">
        <button class="qty-stepper" onclick="stepQty('upd-qty',-1)">−</button>
        <input class="qty-input" id="upd-qty" type="number" value="${item.currentQty}" min="0">
        <button class="qty-stepper" onclick="stepQty('upd-qty',1)">+</button>
      </div>
    </div>
    <button class="btn btn-primary" onclick="saveUpdate('${item.id}')">Bestand aktualisieren</button>
    <div style="height:8px"></div>
    <button class="btn btn-secondary" onclick="closeModal();navigate('scanner')">Nochmal scannen</button>
  `);
}
function saveUpdate(id) {
  const qty = parseInt(document.getElementById('upd-qty').value) || 0;
  DB.updateItem(id, { currentQty: qty });
  closeModal();
  showToast('Bestand aktualisiert ✓', 'success');
  updateBadge();
}

// Produkt gefunden → hinzufügen
function showAddModal(product) {
  const locs = DB.getLocations();
  if (!locs.length) { showToast('Bitte zuerst einen Lagerort anlegen', 'error'); navigate('settings'); return; }
  openModal(`
    <div class="modal-title">Produkt hinzufügen</div>
    ${productCardHtml(product)}
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-input" id="add-name" type="text" value="${escA(product.name)}" placeholder="Produktname">
    </div>
    <div class="form-group">
      <label class="form-label">Lagerort</label>
      <select class="form-select" id="add-loc">${locationOptions('')}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Aktueller Bestand</label>
      <div class="qty-input-wrap">
        <button class="qty-stepper" onclick="stepQty('add-cur',-1)">−</button>
        <input class="qty-input" id="add-cur" type="number" value="1" min="0">
        <button class="qty-stepper" onclick="stepQty('add-cur',1)">+</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Mindestbestand — wird auf Einkaufsliste wenn darunter</label>
      <div class="qty-input-wrap">
        <button class="qty-stepper" onclick="stepQty('add-min',-1)">−</button>
        <input class="qty-input" id="add-min" type="number" value="2" min="1">
        <button class="qty-stepper" onclick="stepQty('add-min',1)">+</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Einheit</label>
      <select class="form-select" id="add-unit">${unitOptions('Stück')}</select>
    </div>
    <button class="btn btn-primary" onclick="saveAdd('${escA(product.barcode)}','${escA(product.imageUrl||'')}','${escA(product.brand||'')}','${escA(product.quantity||'')}')">Zum Vorrat hinzufügen</button>
    <div style="height:8px"></div>
    <button class="btn btn-secondary" onclick="closeModal();navigate('scanner')">Nochmal scannen</button>
  `);
}

// Manuell hinzufügen
function showManualModal(prefill = {}) {
  const locs = DB.getLocations();
  if (!locs.length) { showToast('Bitte zuerst einen Lagerort anlegen', 'error'); navigate('settings'); return; }
  openModal(`
    <div class="modal-title">Produkt hinzufügen</div>
    <div class="form-group">
      <label class="form-label">Name *</label>
      <input class="form-input" id="add-name" type="text" value="${escA(prefill.name||'')}" placeholder="z.B. Bohnen 400g">
    </div>
    <div class="form-group">
      <label class="form-label">Lagerort</label>
      <select class="form-select" id="add-loc">${locationOptions('')}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Aktueller Bestand</label>
      <div class="qty-input-wrap">
        <button class="qty-stepper" onclick="stepQty('add-cur',-1)">−</button>
        <input class="qty-input" id="add-cur" type="number" value="1" min="0">
        <button class="qty-stepper" onclick="stepQty('add-cur',1)">+</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Mindestbestand</label>
      <div class="qty-input-wrap">
        <button class="qty-stepper" onclick="stepQty('add-min',-1)">−</button>
        <input class="qty-input" id="add-min" type="number" value="2" min="1">
        <button class="qty-stepper" onclick="stepQty('add-min',1)">+</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Einheit</label>
      <select class="form-select" id="add-unit">${unitOptions('Stück')}</select>
    </div>
    <button class="btn btn-primary" onclick="saveAdd('${escA(prefill.barcode||'')}','','','')">Zum Vorrat hinzufügen</button>
  `);
}

function saveAdd(barcode, imageUrl, brand, quantity) {
  const name = document.getElementById('add-name').value.trim();
  if (!name) { showToast('Bitte einen Namen eingeben', 'error'); return; }
  const item = {
    barcode, imageUrl, brand, quantity,
    name,
    locationId:  document.getElementById('add-loc').value,
    currentQty: parseInt(document.getElementById('add-cur').value) || 0,
    minQty:     parseInt(document.getElementById('add-min').value) || 1,
    unit:        document.getElementById('add-unit').value
  };
  DB.addItem(item);
  closeModal();
  showToast(`${name} hinzugefügt ✓`, 'success');
  updateBadge();
  navigate('inventory');
}

// Bearbeiten
function showEditModal(item) {
  openModal(`
    <div class="modal-title">Produkt bearbeiten</div>
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-input" id="ed-name" type="text" value="${escA(item.name)}">
    </div>
    <div class="form-group">
      <label class="form-label">Lagerort</label>
      <select class="form-select" id="ed-loc">${locationOptions(item.locationId)}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Aktueller Bestand</label>
      <div class="qty-input-wrap">
        <button class="qty-stepper" onclick="stepQty('ed-cur',-1)">−</button>
        <input class="qty-input" id="ed-cur" type="number" value="${item.currentQty}" min="0">
        <button class="qty-stepper" onclick="stepQty('ed-cur',1)">+</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Mindestbestand</label>
      <div class="qty-input-wrap">
        <button class="qty-stepper" onclick="stepQty('ed-min',-1)">−</button>
        <input class="qty-input" id="ed-min" type="number" value="${item.minQty}" min="1">
        <button class="qty-stepper" onclick="stepQty('ed-min',1)">+</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Einheit</label>
      <select class="form-select" id="ed-unit">${unitOptions(item.unit)}</select>
    </div>
    <button class="btn btn-primary" onclick="saveEdit('${item.id}')">Speichern</button>
    <div style="height:8px"></div>
    <button class="btn btn-danger" onclick="confirmDelete('${item.id}','${escA(item.name)}')">Produkt löschen</button>
  `);
}

function saveEdit(id) {
  const name = document.getElementById('ed-name').value.trim();
  if (!name) { showToast('Name darf nicht leer sein', 'error'); return; }
  DB.updateItem(id, {
    name,
    locationId:  document.getElementById('ed-loc').value,
    currentQty: parseInt(document.getElementById('ed-cur').value) || 0,
    minQty:     parseInt(document.getElementById('ed-min').value) || 1,
    unit:        document.getElementById('ed-unit').value
  });
  closeModal();
  showToast('Gespeichert ✓', 'success');
  updateBadge();
  navigate('inventory');
}

function confirmDelete(id, name) {
  openModal(`
    <div class="modal-title">Produkt löschen?</div>
    <p style="color:var(--text-muted);font-size:15px;margin-bottom:24px;">
      <strong>${esc(name)}</strong> wirklich aus dem Vorrat entfernen?
    </p>
    <button class="btn btn-danger" onclick="doDelete('${id}')">Ja, löschen</button>
    <div style="height:8px"></div>
    <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
  `);
}
function doDelete(id) {
  DB.deleteItem(id);
  closeModal();
  showToast('Produkt gelöscht');
  updateBadge();
  navigate('inventory');
}

// ═══════════════════════════════════════════
//  EINKAUFSLISTE
// ═══════════════════════════════════════════
function renderShopping(container) {
  const items = DB.getShoppingList();
  const locs  = DB.getLocations();

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <div class="empty-title">Alles da!</div>
        <div class="empty-text">Dein Vorrat ist vollständig. Nichts fehlt.</div>
      </div>`;
    return;
  }

  let html = `
    <div class="view">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:14px;color:var(--text-muted);">${items.length} Produkt${items.length !== 1 ? 'e' : ''} fehlt${items.length !== 1 ? 'en' : ''}</span>
        <button onclick="shareList()" style="background:none;border:none;color:var(--primary);font-size:14px;font-weight:700;cursor:pointer;">📤 Teilen</button>
      </div>
      <div class="item-list">`;

  items.forEach(item => {
    const loc    = locs.find(l => l.id === item.locationId);
    const needed = item.minQty - item.currentQty;
    html += `
      <div class="shopping-item" id="si-${item.id}">
        <div class="shopping-check" id="sc-${item.id}" onclick="checkItem('${item.id}')"></div>
        <div class="shopping-info">
          <div class="shopping-name">${esc(item.name)}</div>
          <div class="shopping-detail">${esc(loc?.name || '—')} · Vorhanden: ${item.currentQty} ${esc(item.unit)}</div>
        </div>
        <div class="shopping-qty">${needed} ${esc(item.unit)}</div>
      </div>`;
  });

  html += `</div></div>`;
  container.innerHTML = html;
}

function checkItem(id) {
  const row   = document.getElementById(`si-${id}`);
  const check = document.getElementById(`sc-${id}`);
  const wasChecked = check.classList.contains('checked');
  check.classList.toggle('checked');
  row.classList.toggle('checked');
  check.textContent = wasChecked ? '' : '✓';
  if (!wasChecked) {
    const item = DB.getItems().find(x => x.id === id);
    if (item) {
      DB.updateItem(id, { currentQty: item.minQty });
      updateBadge();
      showToast(`${item.name} als gekauft markiert ✓`, 'success');
    }
  }
}

function shareList() {
  const items = DB.getShoppingList();
  const locs  = DB.getLocations();
  const text  = '🛒 Einkaufsliste:\n' + items.map(i => {
    const loc    = locs.find(l => l.id === i.locationId);
    const needed = i.minQty - i.currentQty;
    return `• ${needed}x ${i.name} (${loc?.name || '—'})`;
  }).join('\n');

  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text);
    showToast('In Zwischenablage kopiert', 'success');
  }
}

// ═══════════════════════════════════════════
//  EINSTELLUNGEN
// ═══════════════════════════════════════════
function renderSettings(container) {
  const locs  = DB.getLocations();
  const items = DB.getItems();

  container.innerHTML = `
    <div class="view">
      <div class="section-title">Lagerorte</div>
      <div class="item-list">
        ${locs.length === 0
          ? '<div style="padding:16px;text-align:center;color:var(--text-muted)">Noch keine Lagerorte</div>'
          : locs.map(l => {
              const cnt = items.filter(i => i.locationId === l.id).length;
              return `
                <div class="location-item">
                  <span class="location-name">${esc(l.name)}</span>
                  <span class="location-count">${cnt} Produkt${cnt !== 1 ? 'e' : ''}</span>
                  <button class="btn-delete" onclick="deleteLoc('${l.id}','${escA(l.name)}',${cnt})">🗑</button>
                </div>`;
            }).join('')}
      </div>
      <div class="add-location-row">
        <input class="form-input" id="new-loc" type="text" placeholder="Neuer Lagerort …" autocomplete="off">
        <button class="btn btn-primary" onclick="addLoc()">+ Hinzufügen</button>
      </div>

      <div class="divider"></div>

      <div class="section-title">Daten</div>
      <div class="item-list">
        <div class="item-row" onclick="exportData()" style="cursor:pointer;">
          <div class="item-info"><div class="item-name">Backup exportieren</div><div class="item-meta">Als JSON-Datei speichern</div></div>
          <span style="color:var(--text-muted)">→</span>
        </div>
        <div class="item-row" onclick="triggerImport()" style="cursor:pointer;">
          <div class="item-info"><div class="item-name">Backup importieren</div><div class="item-meta">Daten wiederherstellen</div></div>
          <span style="color:var(--text-muted)">→</span>
        </div>
        <div class="item-row" onclick="confirmClear()" style="cursor:pointer;">
          <div class="item-info"><div class="item-name" style="color:var(--danger)">Alle Daten löschen</div><div class="item-meta">Kompletten Vorrat zurücksetzen</div></div>
          <span style="color:var(--text-muted)">→</span>
        </div>
      </div>
      <input type="file" id="import-input" accept=".json" style="display:none" onchange="importData(this)">

      <div style="text-align:center;color:var(--text-muted);font-size:12px;padding:24px 0 8px;">
        Mein Vorrat v1.0 · Alle Daten lokal auf deinem Gerät
      </div>
    </div>`;

  document.getElementById('new-loc').addEventListener('keydown', e => {
    if (e.key === 'Enter') addLoc();
  });
}

function addLoc() {
  const input = document.getElementById('new-loc');
  const name  = input.value.trim();
  if (!name) return;
  const locs = DB.getLocations();
  if (locs.find(l => l.name.toLowerCase() === name.toLowerCase())) {
    showToast('Lagerort existiert bereits', 'error'); return;
  }
  locs.push({ id: Date.now().toString(), name });
  DB.saveLocations(locs);
  input.value = '';
  showToast(`"${name}" hinzugefügt ✓`, 'success');
  renderSettings(document.getElementById('main-content'));
}

function deleteLoc(id, name, count) {
  if (count > 0) {
    openModal(`
      <div class="modal-title">Lagerort löschen?</div>
      <p style="color:var(--text-muted);font-size:15px;margin-bottom:24px;">
        <strong>${esc(name)}</strong> enthält noch ${count} Produkt${count !== 1 ? 'e' : ''}. Diese werden trotzdem behalten.
      </p>
      <button class="btn btn-danger" onclick="doDeleteLoc('${id}')">Trotzdem löschen</button>
      <div style="height:8px"></div>
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
    `);
  } else {
    doDeleteLoc(id);
  }
}
function doDeleteLoc(id) {
  DB.saveLocations(DB.getLocations().filter(l => l.id !== id));
  closeModal();
  showToast('Lagerort gelöscht');
  renderSettings(document.getElementById('main-content'));
}

function exportData() {
  const blob = new Blob([JSON.stringify({
    locations: DB.getLocations(),
    items: DB.getItems(),
    exportedAt: new Date().toISOString(),
    version: '1.0'
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vorrat-backup-${new Date().toLocaleDateString('de-DE').replace(/\./g,'-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup erstellt ✓', 'success');
}

function triggerImport() {
  document.getElementById('import-input')?.click();
}
function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      if (d.locations && d.items) {
        DB.saveLocations(d.locations);
        DB.saveItems(d.items);
        showToast('Daten importiert ✓', 'success');
        navigate('inventory');
      } else {
        showToast('Ungültige Datei', 'error');
      }
    } catch { showToast('Fehler beim Lesen', 'error'); }
  };
  reader.readAsText(file);
}

function confirmClear() {
  openModal(`
    <div class="modal-title">Alle Daten löschen?</div>
    <p style="color:var(--text-muted);font-size:15px;margin-bottom:24px;">
      ⚠️ Alle Produkte und Lagerorte werden unwiderruflich gelöscht.
    </p>
    <button class="btn btn-danger" onclick="clearAll()">Ja, alles löschen</button>
    <div style="height:8px"></div>
    <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
  `);
}
function clearAll() {
  localStorage.clear();
  closeModal();
  showToast('Alle Daten gelöscht');
  navigate('inventory');
}

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bottom-nav').addEventListener('click', e => {
    const btn = e.target.closest('.nav-btn');
    if (btn) navigate(btn.dataset.view);
  });
  navigate('inventory');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
