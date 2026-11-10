// Turns YouTube Music's internal JSON responses into simple sections of items.
// Runs both inside the YouTube Music page (injected) and in Node (tests).
(function (root) {
  'use strict';

  const SHELVES = [
    'musicShelfRenderer',
    'musicCarouselShelfRenderer',
    'musicPlaylistShelfRenderer',
    'gridRenderer',
    'musicCardShelfRenderer',
  ];
  const HEADERS = [
    'musicResponsiveHeaderRenderer',
    'musicDetailHeaderRenderer',
    'musicImmersiveHeaderRenderer',
    'musicVisualHeaderRenderer',
    'musicEditablePlaylistDetailHeaderRenderer',
  ];
  const SKIP = new Set(['menu', 'trackingParams', 'responseContext', 'frameworkUpdates']);

  function text(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if (t.runs) return t.runs.map((r) => r.text).join('');
    return t.simpleText || '';
  }

  // First value stored under `key` anywhere inside `o` (skipping context menus).
  function deep(o, key, depth) {
    depth = depth || 0;
    if (!o || typeof o !== 'object' || depth > 14) return undefined;
    if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
    for (const k of Object.keys(o)) {
      if (SKIP.has(k)) continue;
      const found = deep(o[k], key, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function thumb(o) {
    const list = deep(o, 'thumbnails');
    if (!Array.isArray(list) || !list.length) return '';
    const good = list.find((t) => (t.width || 0) >= 120) || list[list.length - 1];
    let url = good.url || '';
    if (url.startsWith('//')) url = 'https:' + url;
    return url;
  }

  function kindFromPageType(pageType, browseId) {
    pageType = pageType || '';
    if (/ARTIST|USER_CHANNEL/.test(pageType)) return 'artist';
    if (/ALBUM|AUDIOBOOK/.test(pageType)) return 'album';
    if (/PLAYLIST|PODCAST_SHOW/.test(pageType)) return 'playlist';
    if (/^MPRE/.test(browseId || '')) return 'album';
    if (/^(VL|MPSP)/.test(browseId || '')) return 'playlist';
    if (/^UC/.test(browseId || '')) return 'artist';
    return 'page';
  }

  function applyEndpoint(item, ep) {
    if (!ep) return;
    const watch = ep.watchEndpoint;
    if (watch && watch.videoId && !item.videoId) {
      item.videoId = watch.videoId;
      if (watch.playlistId) item.playlistId = watch.playlistId;
    }
    const list = ep.watchPlaylistEndpoint;
    if (list && list.playlistId && !item.playPlaylistId) item.playPlaylistId = list.playlistId;
    const browse = ep.browseEndpoint;
    if (browse && browse.browseId && !item.browseId) {
      item.browseId = browse.browseId;
      if (browse.params) item.browseParams = browse.params;
      item.pageType = deep(browse, 'pageType') || '';
    }
  }

  function finish(item) {
    if (item.videoId) item.kind = 'song';
    else if (item.browseId) item.kind = kindFromPageType(item.pageType, item.browseId);
    else if (item.playPlaylistId) item.kind = 'playlist';
    else item.kind = 'text';
    delete item.pageType;
    return item;
  }

  function overlayEndpoint(r) {
    const btn = deep(r.overlay || r.thumbnailOverlay, 'musicPlayButtonRenderer');
    return btn && btn.playNavigationEndpoint;
  }

  function responsiveItem(r) {
    const cols = (r.flexColumns || []).map((c) => c.musicResponsiveListItemFlexColumnRenderer || {});
    const item = {
      title: text(cols[0] && cols[0].text),
      subtitle: cols.slice(1).map((c) => text(c.text)).filter(Boolean).join(' • '),
      thumb: thumb(r.thumbnail),
    };
    const fixed = (r.fixedColumns || [])[0];
    const duration = fixed && text(deep(fixed, 'text'));
    if (duration) item.duration = duration;
    if (r.playlistItemData && r.playlistItemData.videoId) item.videoId = r.playlistItemData.videoId;
    applyEndpoint(item, overlayEndpoint(r));
    const titleRun = cols[0] && cols[0].text && cols[0].text.runs && cols[0].text.runs[0];
    applyEndpoint(item, titleRun && titleRun.navigationEndpoint);
    applyEndpoint(item, r.navigationEndpoint);
    return finish(item);
  }

  function twoRowItem(r) {
    const item = { title: text(r.title), subtitle: text(r.subtitle), thumb: thumb(r.thumbnailRenderer) };
    applyEndpoint(item, r.navigationEndpoint);
    applyEndpoint(item, overlayEndpoint(r));
    return finish(item);
  }

  function cardItem(r) {
    const item = { title: text(r.title), subtitle: text(r.subtitle), thumb: thumb(r.thumbnail) };
    const run = r.title && r.title.runs && r.title.runs[0];
    applyEndpoint(item, run && run.navigationEndpoint);
    applyEndpoint(item, r.onTap);
    return finish(item);
  }

  function shelfTitle(r) {
    const header = r.header && Object.values(r.header)[0];
    if (header && header.title) return text(header.title);
    return r.title && !r.subtitle ? text(r.title) : '';
  }

  function parseHeader(r) {
    const header = { title: text(r.title), subtitle: '', thumb: thumb(r.thumbnail || r.foregroundThumbnail) };
    const parts = [text(r.subtitle), text(r.straplineTextOne), text(r.secondSubtitle)].filter(Boolean);
    header.subtitle = parts.join(' • ');
    const listEp = deep(r.buttons || r.playButton || r.menu, 'watchPlaylistEndpoint');
    const watchEp = deep(r.buttons || r.playButton || r.menu, 'watchEndpoint');
    if (listEp && listEp.playlistId) header.playPlaylistId = listEp.playlistId;
    else if (watchEp && watchEp.playlistId) header.playPlaylistId = watchEp.playlistId;
    return header;
  }

  // Search filter buttons ("Songs", "Albums", ...) offered by the response.
  function parseChips(json) {
    const cloud = deep(json, 'chipCloudRenderer');
    const chips = [];
    for (const c of (cloud && cloud.chips) || []) {
      const r = c.chipCloudChipRenderer;
      const search = r && r.navigationEndpoint && r.navigationEndpoint.searchEndpoint;
      if (search && search.params) chips.push({ label: text(r.text), params: search.params, selected: !!r.isSelected });
    }
    return chips;
  }

  // Returns { header, chips, sections: [{ title, items: [...] }] }.
  function parse(json) {
    const sections = [];
    let header = null;
    let loose = null;

    function push(section, item) {
      if (!item.title) return;
      if (section) return void section.items.push(item);
      if (!loose) {
        loose = { title: '', items: [] };
        sections.push(loose);
      }
      loose.items.push(item);
    }

    function walk(o, section, depth) {
      if (!o || typeof o !== 'object' || depth > 40) return;
      if (Array.isArray(o)) {
        for (const child of o) walk(child, section, depth + 1);
        return;
      }
      for (const k of Object.keys(o)) {
        if (SKIP.has(k)) continue;
        const v = o[k];
        if (k === 'musicResponsiveListItemRenderer') push(section, responsiveItem(v));
        else if (k === 'musicTwoRowItemRenderer') push(section, twoRowItem(v));
        else if (HEADERS.includes(k)) {
          if (!header) header = parseHeader(v);
        } else if (SHELVES.includes(k)) {
          const next = { title: shelfTitle(v), items: [] };
          sections.push(next);
          loose = null;
          if (k === 'musicCardShelfRenderer') {
            next.title = next.title || 'Top result';
            next.items.push(cardItem(v));
            walk(v.contents, next, depth + 1);
          } else {
            walk(v.contents || v.items, next, depth + 1);
          }
          loose = null;
        } else walk(v, section, depth + 1);
      }
    }

    walk(json, null, 0);
    return { header, chips: parseChips(json), sections: sections.filter((s) => s.items.length) };
  }

  const api = { parse, text, deep, thumb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.__retroParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
