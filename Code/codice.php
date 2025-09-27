<?php
(() => {
  const ENDPOINT = 'https://graphql.anilist.co';
  // Query: characters sorted by favourites desc, and include node.favourites
  const QUERY = `
    query ($page:Int, $perPage:Int, $search:String, $format_in:[MediaFormat], $country:CountryCode, $tag_not_in:[String], $genre_not_in:[String]) {
      Page(page:$page, perPage:$perPage) {
        pageInfo { total currentPage lastPage }
        media(format_in:$format_in, countryOfOrigin:$country, isAdult:false, search:$search, tag_not_in:$tag_not_in, genre_not_in:$genre_not_in) {
          id
          type
          format
          title { userPreferred }
          status
          chapters
          countryOfOrigin
          coverImage { medium }
          characters(perPage:20, sort:[FAVOURITES_DESC]) {
            edges {
              role
              node {
                id
                name { full }
                image { medium }
                favourites
              }
            }
          }
          staff(perPage:8, sort:[ROLE, FAVOURITES_DESC]) {
            edges {
              role
              node {
                name { full }
                favourites
              }
            }
          }
        }
      }
    }
  `;

  // UI references
  const ui = {
    statusEl: document.getElementById('status'),
    tableHolder: document.getElementById('tableHolder'),
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    pager: document.getElementById('pager'),
    pageInfo: document.getElementById('pageInfo'),
    errorEl: document.getElementById('error'),
    btnManga: document.getElementById('btn-manga'),
    btnNovel: document.getElementById('btn-novel'),
    btnManhwa: document.getElementById('btn-manhwa'),
    btnManhua: document.getElementById('btn-manhua')
  };

  let state = {
    currentFormat: null, // 'MANGA' | 'NOVEL' | 'MANHWA' | 'MANHUA'
    page: 1,
    perPage: 20,
    search: ''
  };

  // Default exclusion list for "adult" tags (personalizzabile)
  const DEFAULT_TAG_EXCLUDE = ['Hentai','Ecchi','Adult','Erotica','Sexual Content','Nudity'];
  const DEFAULT_GENRE_EXCLUDE = [];

  function setStatus(t){ ui.statusEl.textContent = t; }
  function setError(e){ ui.errorEl.style.display = e? 'block':'none'; ui.errorEl.textContent = e||''; }

  async function fetchData() {
    setError('');
    setStatus('Caricamento...');
    ui.tableHolder.innerHTML = '';

    // Decide format_in and optional country filter
    let format_in = null;
    let country = null;
    if (state.currentFormat === 'NOVEL') {
      format_in = ['NOVEL'];
      // NOVEL: no country forced
    } else {
      format_in = ['MANGA']; // for MANGA / MANHWA / MANHUA use format MANGA
      if (state.currentFormat === 'MANHWA') country = 'KR';
      else if (state.currentFormat === 'MANHUA') country = 'CN';
      else if (state.currentFormat === 'MANGA') country = 'JP'; // <-- requested change: MANGA -> only JP
    }

    const variables = {
      page: state.page,
      perPage: state.perPage,
      search: state.search || null,
      format_in: format_in,
      tag_not_in: DEFAULT_TAG_EXCLUDE
    };
    if (DEFAULT_GENRE_EXCLUDE.length) variables.genre_not_in = DEFAULT_GENRE_EXCLUDE;
    // include country only if set
    if (country) variables.country = country;

    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables })
      });
      const data = await resp.json();
      if (data.errors) throw new Error(data.errors.map(e=>e.message).join('; '));
      return data.data.Page;
    } catch (err) {
      throw err;
    }
  }

  // New robust protagonist picker:
  // - prefer edges whose role contains 'MAIN' (case-insensitive). If multiple MAIN, pick the one with highest node.favourites.
  // - if no MAIN, pick the node with highest favourites.
  // - fallback to first available node with a name.
  function pickProtagonist(characters){
    if (!characters || !Array.isArray(characters.edges)) return null;
    const edges = characters.edges.filter(e => e && e.node); // keep valid
    if (edges.length === 0) return null;

    // find all edges with role indicating main (role may be 'MAIN', 'Main', etc.)
    const mainEdges = edges.filter(e => e.role && String(e.role).toUpperCase().includes('MAIN'));
    if (mainEdges.length === 1) {
      const e = mainEdges[0];
      return { name: e.node.name?.full || '', image: e.node.image?.medium || '' };
    } else if (mainEdges.length > 1) {
      // pick the one with highest favourites
      mainEdges.sort((a,b) => (b.node.favourites || 0) - (a.node.favourites || 0));
      const e = mainEdges[0];
      return { name: e.node.name?.full || '', image: e.node.image?.medium || '' };
    }

    // if no main edges, attempt to pick the edge with highest favourites (we requested sort by favourites so edges[0] is likely best)
    const edgesWithFav = edges.filter(e => typeof e.node.favourites === 'number');
    if (edgesWithFav.length > 0) {
      edgesWithFav.sort((a,b) => (b.node.favourites || 0) - (a.node.favourites || 0));
      const e = edgesWithFav[0];
      return { name: e.node.name?.full || '', image: e.node.image?.medium || '' };
    }

    // final fallback: first edge with a name
    const firstWithName = edges.find(e => e.node && e.node.name && e.node.name.full);
    if (firstWithName) return { name: firstWithName.node.name.full, image: firstWithName.node.image?.medium || '' };

    return null;
  }

  // staff picker: prefer roles indicating author/creator; if several, choose highest favourites, else first
  function pickMainStaff(staff){
    if (!staff || !Array.isArray(staff.edges)) return null;
    const edges = staff.edges.filter(e => e && e.node);
    if (edges.length === 0) return null;

    // prefer roles like story/original/creator/author
    let candidates = edges.filter(e => e.role && /story|original|creator|author/i.test(e.role));
    if (candidates.length === 0) candidates = edges;

    // choose highest favourites if available
    candidates.sort((a,b) => (b.node.favourites || 0) - (a.node.favourites || 0));
    const pick = candidates[0];
    return { name: pick.node.name?.full || '' };
  }

  function renderTable(mediaList, pageInfo){
    if (!mediaList || mediaList.length===0) {
      ui.tableHolder.innerHTML = '<p class="small">Nessun risultato.</p>';
      ui.pager.style.display = 'none';
      setStatus('Nessun risultato trovati.');
      return;
    }

    // Column "Type" intentionally removed (we keep item.type in JS if needed)
    const headers = ['Format','Title','Status','Chapters','Country','Protagonist','Creator','Cover'];
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const thr = document.createElement('tr');
    headers.forEach(h=>{ const th = document.createElement('th'); th.textContent = h; thr.appendChild(th); });
    thead.appendChild(thr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    mediaList.forEach(item => {
      const protagonist = pickProtagonist(item.characters) || { name: '', image: '' };
      const mainStaff = pickMainStaff(item.staff) || { name: '' };

      const tr = document.createElement('tr');

      const tdFormat = document.createElement('td'); tdFormat.textContent = item.format || '';
      const tdTitle = document.createElement('td'); tdTitle.textContent = item.title?.userPreferred || '';
      const tdStatus = document.createElement('td'); tdStatus.textContent = item.status || '';
      const tdChapters = document.createElement('td'); tdChapters.textContent = item.chapters!=null ? item.chapters : '';
      const tdCountry = document.createElement('td'); tdCountry.textContent = item.countryOfOrigin || '';
      const tdProt = document.createElement('td');
      tdProt.innerHTML = `<div style="display:flex;gap:8px;align-items:center"><div class="person-img">${protagonist.image?`<img src="${protagonist.image}" alt="${protagonist.name}">`:''}</div><div>${protagonist.name}</div></div>`;
      const tdStaff = document.createElement('td'); tdStaff.textContent = mainStaff.name || '';
      const tdCover = document.createElement('td'); tdCover.className = 'cover'; tdCover.innerHTML = item.coverImage?.medium ? `<img src="${item.coverImage.medium}" alt="cover">` : '';

      [tdFormat, tdTitle, tdStatus, tdChapters, tdCountry, tdProt, tdStaff, tdCover].forEach(td => tr.appendChild(td));
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    ui.tableHolder.innerHTML = '';
    ui.tableHolder.appendChild(table);

    // pager
    if (pageInfo && pageInfo.total!=null) {
      ui.pager.style.display = 'flex';
      ui.pageInfo.textContent = `Pagina ${pageInfo.currentPage} di ${pageInfo.lastPage} — totale risultati: ${pageInfo.total}`;
    } else {
      ui.pager.style.display = 'none';
    }
    setStatus(`Mostrati ${mediaList.length} risultati.`);
  }

  async function doSearch(page=1){
    if (!state.currentFormat) { setError('Seleziona una sottocategoria.'); return; }
    state.page = page;
    state.search = ui.searchInput.value.trim();
    try {
      const pageData = await fetchData();
      renderTable(pageData.media, pageData.pageInfo);
    } catch (err) {
      setError(err.message || String(err));
      setStatus('Errore durante il caricamento.');
    }
  }

  function attachHandlers(){
    ui.btnManga.addEventListener('click', ()=>{
      state.currentFormat = 'MANGA';
      state.page = 1;
      doSearch(1);
    });
    ui.btnNovel.addEventListener('click', ()=>{
      state.currentFormat = 'NOVEL';
      state.page = 1;
      doSearch(1);
    });
    ui.btnManhwa.addEventListener('click', ()=>{
      state.currentFormat = 'MANHWA';
      state.page = 1;
      doSearch(1);
    });
    ui.btnManhua.addEventListener('click', ()=>{
      state.currentFormat = 'MANHUA';
      state.page = 1;
      doSearch(1);
    });

    ui.searchBtn.addEventListener('click', ()=> doSearch(1));
    ui.prevBtn.addEventListener('click', ()=> { if (state.page>1) doSearch(state.page-1); });
    ui.nextBtn.addEventListener('click', ()=> { state.page++; doSearch(state.page); });

    // Enter to submit search
    ui.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch(1);
      }
    });
  }

  function init(){
    attachHandlers();
    setStatus('Pronto. Seleziona una sottocategoria per caricare i risultati.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})();

?>

