// script.js (versione riscritta)
// - Debounce sulla digitazione
// - AbortController per cancellare richieste in corso
// - Cache semplice per evitare chiamate duplicate
// - UI più resiliente (errori, loading, pager)

(() => {
  const ENDPOINT = 'https://graphql.anilist.co';

  const QUERY = `
    query ($search: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
          perPage
        }
        media(search: $search, type: ANIME) {
          id
          title { romaji english native }
          episodes
          status
          season
          seasonYear
          genres
          averageScore
          coverImage { large }
          siteUrl
        }
      }
    }
  `;

  // Selettori UI
  const ui = {
    searchInput: null,
    searchBtn: null,
    perPageSelect: null,
    statusEl: null,
    tableHolder: null,
    pager: null,
    prevBtn: null,
    nextBtn: null,
    pageInfo: null,
    errorEl: null
  };

  // Stato
  let currentPage = 1;
  let lastQuery = '';
  let lastPageInfo = null;
  let abortController = null;
  const cache = new Map(); // cache key: `${query}|${page}|${perPage}`

  // Utility: debounce
  function debounce(fn, wait) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  // Escape HTML per sicurezza
  function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // Mostra errore
  function showError(msg) {
    ui.errorEl.style.display = 'block';
    ui.errorEl.textContent = msg;
  }
  function clearError() {
    ui.errorEl.style.display = 'none';
    ui.errorEl.textContent = '';
  }

  // Fetch GraphQL con cancellazione e gestione errori
  async function fetchAnilist(search, page = 1, perPage = 20) {
    clearError();
    ui.statusEl.textContent = 'Caricamento…';
    ui.searchBtn.disabled = true;

    // controlla cache
    const cacheKey = `${search}|${page}|${perPage}`;
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      lastPageInfo = cached.pageInfo;
      ui.statusEl.textContent = `Dati dalla cache — pagina ${lastPageInfo.currentPage}/${lastPageInfo.lastPage} — ${cached.media.length} risultati mostrati (tot ${lastPageInfo.total})`;
      ui.searchBtn.disabled = false;
      return cached;
    }

    // annulla eventuale richiesta precedente
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    try {
      const variables = { search, page, perPage };
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables }),
        signal
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} — ${text || res.statusText}`);
      }

      const payload = await res.json();
      if (payload.errors) {
        throw new Error(payload.errors.map(e => e.message).join('; '));
      }

      const pageData = payload.data.Page;
      lastPageInfo = pageData.pageInfo;
      ui.statusEl.textContent = `Mostrati ${pageData.media.length} di ${lastPageInfo.total} risultati (pagina ${lastPageInfo.currentPage}/${lastPageInfo.lastPage})`;

      // salva in cache
      cache.set(cacheKey, pageData);
      // limite cache semplice (evita crescita infinita)
      if (cache.size > 50) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }

      return pageData;
    } catch (err) {
      if (err.name === 'AbortError') {
        // richiesta annullata: non mostriamo errore visibile, solo reset status
        ui.statusEl.textContent = 'Richiesta annullata.';
        return null;
      }
      showError('Errore: ' + err.message);
      ui.statusEl.textContent = 'Errore durante il caricamento.';
      return null;
    } finally {
      ui.searchBtn.disabled = false;
    }
  }

  // Pulisce area tabella
  function clearTable() {
    ui.tableHolder.innerHTML = '';
    ui.pager.style.display = 'none';
  }

  // Costruisce la tabella DOM (tutta creata via JS)
  function renderTable(mediaArray) {
    clearTable();
    if (!mediaArray || !mediaArray.length) {
      ui.tableHolder.innerHTML = '<div class="small">Nessun risultato trovato.</div>';
      return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th scope="col">Copertina</th>
        <th scope="col">Titolo</th>
        <th scope="col">Ep.</th>
        <th scope="col">Anno / Stagione</th>
        <th scope="col">Generi</th>
        <th scope="col">Score</th>
        <th scope="col">Link</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    for (const m of mediaArray) {
      const tr = document.createElement('tr');

      // Cover
      const tdCover = document.createElement('td');
      const img = document.createElement('img');
      img.className = 'cover';
      img.alt = escapeHtml(m.title?.romaji || m.title?.english || 'cover');
      img.src = m.coverImage?.large || '';
      img.loading = 'lazy';
      // fallback se immagine non disponibile
      img.onerror = () => {
        img.style.display = 'none';
      };
      tdCover.appendChild(img);
      tr.appendChild(tdCover);

      // Title
      const tdTitle = document.createElement('td');
      const titleMain = m.title?.romaji || m.title?.english || m.title?.native || '—';
      const subtitle = (m.title?.english && m.title.english !== m.title?.romaji) ? `<div class="small">${escapeHtml(m.title.english)}</div>` : '';
      tdTitle.innerHTML = `<div style="font-weight:600">${escapeHtml(titleMain)}</div>${subtitle}`;
      tr.appendChild(tdTitle);

      // Episodes
      const tdEps = document.createElement('td');
      tdEps.textContent = m.episodes != null ? String(m.episodes) : '—';
      tr.appendChild(tdEps);

      // Season / Year
      const tdYear = document.createElement('td');
      tdYear.textContent = (m.seasonYear ? `${m.seasonYear}` : '—') + (m.season ? ` • ${m.season}` : '');
      tr.appendChild(tdYear);

      // Genres
      const tdGenres = document.createElement('td');
      tdGenres.textContent = (Array.isArray(m.genres) && m.genres.length) ? m.genres.join(', ') : '—';
      tr.appendChild(tdGenres);

      // Score
      const tdScore = document.createElement('td');
      tdScore.textContent = (m.averageScore != null) ? `${m.averageScore}/100` : '—';
      tr.appendChild(tdScore);

      // Link
      const tdLink = document.createElement('td');
      if (m.siteUrl) {
        const a = document.createElement('a');
        a.href = m.siteUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'link';
        a.textContent = 'Apri';
        tdLink.appendChild(a);
      } else {
        tdLink.textContent = '—';
      }
      tr.appendChild(tdLink);

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    ui.tableHolder.appendChild(table);
  }

  // Render pager in base a lastPageInfo
  function renderPager() {
    const pi = lastPageInfo;
    if (!pi || pi.lastPage <= 1) {
      ui.pager.style.display = 'none';
      return;
    }
    ui.pager.style.display = 'flex';
    ui.pageInfo.textContent = `Pagina ${pi.currentPage} di ${pi.lastPage} — Totale risultati: ${pi.total}`;
    ui.prevBtn.disabled = !pi.currentPage || pi.currentPage <= 1;
    ui.nextBtn.disabled = !pi.hasNextPage;
  }

  // Esegui ricerca (usato da click, enter, debounce)
  async function doSearch(page = 1) {
    const q = (ui.searchInput.value || '').trim();
    if (!q) {
      ui.statusEl.textContent = 'Inserisci un termine di ricerca.';
      return;
    }
    const perPage = parseInt(ui.perPageSelect.value, 10) || 20;
    currentPage = page;
    lastQuery = q;

    const data = await fetchAnilist(q, page, perPage);
    if (!data) return;
    renderTable(data.media);
    renderPager();
  }

  // Inizializzazione e binding eventi
  function init() {
    // hook elementi UI
    ui.searchInput = document.getElementById('searchInput');
    ui.searchBtn = document.getElementById('searchBtn');
    ui.perPageSelect = document.getElementById('perPageSelect');
    ui.statusEl = document.getElementById('status');
    ui.tableHolder = document.getElementById('tableHolder');
    ui.pager = document.getElementById('pager');
    ui.prevBtn = document.getElementById('prevBtn');
    ui.nextBtn = document.getElementById('nextBtn');
    ui.pageInfo = document.getElementById('pageInfo');
    ui.errorEl = document.getElementById('error');

    // safety: verifica elementi
    if (!ui.searchInput || !ui.searchBtn || !ui.tableHolder) {
      console.error('Elementi UI mancanti — assicurati che index.html contenga gli id corretti.');
      return;
    }

    // debounce per digitazione
    const debounced = debounce(() => doSearch(1), 500);
    ui.searchInput.addEventListener('input', debounced);

    // tasto invio
    ui.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch(1);
      }
    });

    ui.searchBtn.addEventListener('click', () => doSearch(1));
    ui.prevBtn.addEventListener('click', () => { if (currentPage > 1) doSearch(currentPage - 1); });
    ui.nextBtn.addEventListener('click', () => { if (lastPageInfo?.hasNextPage) doSearch(currentPage + 1); });

    // opzione perPage: ricarica pagina 1 quando cambia
    ui.perPageSelect.addEventListener('change', () => doSearch(1));

    // messaggio iniziale
    ui.statusEl.textContent = 'Pronto. Inserisci un termine e premi Cerca (o digita).';
  }

  // Avvio quando DOM pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
