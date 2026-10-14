/* Standalone public reader. All record strings are rendered with textContent. */
'use strict';
(() => {
  const model = window.BXHPublicCatalog;
  const $ = id => document.getElementById(id);
  let catalog = null, tab = 'products', requestVersion = 0, controller = null;
  const node = (tag, text = '', className = '') => {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function state(value, message) {
    document.body.dataset.catalogState = value;
    $('catalog-status').textContent = message;
    $('catalog-controls').disabled = value !== 'ready';
    $('catalog-results').setAttribute('aria-busy', String(value === 'loading'));
    $('catalog-retry').hidden = value !== 'error';
  }
  function clear() {
    catalog = null;
    $('catalog-results').replaceChildren(); $('catalog-count').textContent = '';
    ['catalog-product-count', 'catalog-part-count', 'catalog-group-count'].forEach(id => $(id).textContent = '—');
    $('catalog-version').textContent = '';
  }
  function sourceLinks(...records) {
    const wrapper = node('div', '', 'source-links');
    model.uniqueSources(...records).forEach((url, index) => {
      const safe = model.safeSourceUrl(url);
      if (!safe) return;
      const isPdf = new URL(safe).pathname.toLowerCase().endsWith('.pdf');
      const isImage = /\.(png|jpe?g)$/i.test(new URL(safe).pathname);
      const link = node('a', '原廠' + (isPdf ? '說明書' : isImage ? '資料圖' : '頁面') + ' ' + (index + 1) + ' ↗', 'catalog-source-link');
      link.href = safe; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
      link.setAttribute('aria-label', link.textContent.replace(' ↗', '') + '（另開視窗）');
      wrapper.append(link);
    });
    return wrapper;
  }
  function appendName(parent, record, tag, fallback) {
    const display = model.displayName(record, fallback);
    const title = node(tag, display.primary, 'localized-name');
    title.lang = 'zh-Hant-TW'; title.dataset.nameStatus = display.status;
    if (display.label) title.append(node('span', display.label, 'name-status'));
    parent.append(title);
    if (display.original) {
      const original = node(tag === 'span' ? 'span' : 'p', '', 'original-name');
      const value = node('span', display.original); value.lang = 'ja';
      original.append(node('span', '原文：'), value); parent.append(original);
    }
  }
  function groupView(group, ordinal, partMap) {
    const section = node('section', '', 'assembly-group');
    section.dataset.groupId = group.groupId;
    appendName(section, group, 'h4', '部件清單 ' + ordinal);
    if (!group.originalName) section.append(node('p', '完整組合原文名稱待補；以下分別列出有來源的零件名稱。', 'missing-note'));
    const list = node('ul', '', 'parts-list');
    group.expectedParts.forEach(relation => {
      const item = node('li');
      const description = node('span', '', 'part-description');
      appendName(description, partMap.get(relation.partId), 'span');
      description.append(node('span', model.CATEGORY_LABELS[relation.category], 'part-category'));
      item.append(description, node('span', '× ' + relation.quantity, 'quantity')); list.append(item);
    });
    section.append(list, sourceLinks(group));
    return section;
  }
  function imageGallery(product, options) {
    const images = options.map(option => ({option, image: model.optionImage(product, option)})).filter(item => item.image);
    if (!images.length) return null;
    const gallery = node('section', '', 'option-gallery');
    gallery.setAttribute('aria-label', product.productCode + ' 款式圖片');
    const grid = node('div', '', 'option-image-grid');
    images.forEach(({option, image}) => {
      const figure = node('figure', '', 'option-image');
      figure.dataset.imageOptionCode = option.optionCode;
      const frame = node('div', '', 'option-image-frame');
      const photo = node('img');
      photo.alt = product.productCode + '-' + option.optionCode + ' ' + model.displayName(option).primary + ' 原廠商品示意圖';
      photo.width = image.width; photo.height = image.height;
      photo.loading = 'lazy'; photo.decoding = 'async'; photo.referrerPolicy = 'no-referrer';
      const fallback = node('span', '圖片暫時無法顯示，請查看原廠頁面。', 'image-fallback');
      fallback.hidden = true; fallback.setAttribute('role', 'status');
      photo.addEventListener('error', () => { photo.hidden = true; fallback.hidden = false; });
      photo.src = './' + image.path;
      frame.append(photo, fallback);
      const caption = node('figcaption');
      caption.append(node('span', product.productCode + '-' + option.optionCode, 'product-code'));
      appendName(caption, option, 'span');
      figure.append(frame, caption); grid.append(figure);
    });
    gallery.append(grid, node('p', '原廠商品示意圖，僅供辨識參考；不作實物配色或完整內容認證。', 'missing-note'));
    gallery.append(node('p', '圖片：TAKARA TOMY · © Homura Kawamoto, Hikaru Muno, Posuka Demizu, BBXProject · © TOMY', 'image-credit'), sourceLinks(product));
    return gallery;
  }
  function productCard(product, partMap) {
    const card = node('article', '', 'catalog-card'); card.dataset.productId = product.productId;
    const meta = node('div', '', 'card-meta');
    meta.append(node('span', product.productCode, 'product-code'), node('span', model.PACKAGE_LABELS[product.packageType], 'category-tag'));
    card.append(meta); appendName(card, product, 'h2');
    card.append(node('p', '台灣官方中文名稱、實物配色待補', 'missing-note'), sourceLinks(product));
    const options = catalog.options.filter(option => option.productId === product.productId);
    const gallery = imageGallery(product, options);
    if (gallery) card.append(gallery);
    const details = node('details');
    details.append(node('summary', '查看已收錄款式與部件'));
    details.append(node('p', '商品／款式的完整組成待補。以下清單只涵蓋已核對的對戰部件型別，不表示整盒內容、成品配色或所有款式皆完整。', 'scope-note'));
    if (!options.length) details.append(node('p', '部件組成資料待補，暫無可列出的部件清單。', 'missing-note'));
    options.forEach(option => {
      const section = node('section', '', 'option-section'); section.dataset.optionId = option.optionId;
      const heading = node('h3', option.optionCode ? '款式 ' + product.productCode + '-' + option.optionCode : '已收錄部件');
      section.append(heading);
      if (option.originalName) appendName(section, option, 'p');
      const groups = catalog.assemblyRelations.filter(group => group.optionId === option.optionId);
      if (!groups.length) section.append(node('p', '部件清單待補；僅顯示已有來源的款式名稱。', 'missing-note'));
      groups.forEach((group, index) => section.append(groupView(group, index + 1, partMap)));
      section.append(sourceLinks(option)); details.append(section);
    });
    card.append(details); return card;
  }
  function partIllustration(part) {
    const image = model.partImage(part);
    if (!image) return null;
    const figure = node('figure', '', 'part-image');
    const frame = node('div', '', 'part-image-frame');
    const photo = node('img');
    photo.alt = part.originalName + ' 軸心原廠資料圖（' + image.sourceProductCode + '）';
    photo.width = image.width; photo.height = image.height;
    photo.loading = 'lazy'; photo.decoding = 'async'; photo.referrerPolicy = 'no-referrer';
    const fallback = node('span', '圖片暫時無法顯示，請查看原廠頁面。', 'image-fallback');
    fallback.hidden = true; fallback.setAttribute('role', 'status');
    photo.addEventListener('error', () => { photo.hidden = true; fallback.hidden = false; });
    photo.src = './' + image.path;
    frame.append(photo, fallback);
    const caption = node('figcaption');
    caption.append(node('p', '參考圖片來源：' + image.sourceProductCode + '；僅供零件型別辨識，不代表所有配色。', 'missing-note'));
    caption.append(node('p', '重量：待補（尚無已核對數值）', 'missing-note'));
    caption.append(node('p', '圖片：TAKARA TOMY · © Homura Kawamoto, Hikaru Muno, Posuka Demizu, BBXProject · © TOMY', 'image-credit'));
    caption.append(sourceLinks({sourceUrls: {image: [image.sourcePage]}}));
    figure.append(frame, caption);
    return figure;
  }
  function partCard(part) {
    const card = node('article', '', 'catalog-card'); card.dataset.partId = part.partId;
    card.append(node('span', model.CATEGORY_LABELS[part.category], 'category-tag'));
    appendName(card, part, 'h2');
    const illustration = partIllustration(part);
    if (illustration) card.append(illustration);
    card.append(node('p', '零件型別資料；台灣官方中文名稱與實物配色待補。', 'missing-note'), sourceLinks(part));
    const products = [...new Set(catalog.contentFacts.filter(fact => fact.partId === part.partId).map(fact => fact.productId))];
    const productMap = new Map(catalog.products.map(product => [product.productId, product]));
    card.append(node('p', products.length ? '已收錄的商品關聯：' + products.map(id => productMap.get(id).productCode).join('、') : '尚無已收錄的商品部件關聯。', 'muted'));
    return card;
  }
  function draw() {
    if (!catalog) return;
    const items = model.filterCatalog(catalog, tab, $('catalog-search').value, $('catalog-category').value);
    const parts = new Map(catalog.parts.map(part => [part.partId, part]));
    $('catalog-results').replaceChildren(...items.map(item => tab === 'products' ? productCard(item, parts) : partCard(item)));
    if (!items.length) $('catalog-results').append(node('p', '沒有符合條件的資料。試試其他名稱，或清除篩選。', 'empty-state'));
    $('catalog-count').textContent = '顯示 ' + items.length + '／' + catalog[tab].length + (tab === 'products' ? ' 筆商品' : ' 筆零件型別') + '；此圖鑑仍持續補充。';
  }
  function categories() {
    const labels = tab === 'products' ? model.PACKAGE_LABELS : model.CATEGORY_LABELS;
    $('catalog-category-label').textContent = tab === 'products' ? '商品類別' : '零件類別';
    const all = node('option', '全部類別'); all.value = 'all';
    $('catalog-category').replaceChildren(all, ...Object.entries(labels).map(([value, label]) => {
      const option = node('option', label); option.value = value; return option;
    }));
  }
  async function load() {
    const version = ++requestVersion;
    controller?.abort(); controller = new AbortController();
    const requestController = controller;
    clear(); state('loading', '正在讀取並檢查資料版本…');
    const timeout = window.setTimeout(() => requestController.abort(), 15000);
    try {
      if (!model) throw new Error('MODEL_UNAVAILABLE');
      const response = await fetch(model.DATA_URL, {method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: requestController.signal});
      if (!response.ok) throw new Error('REQUEST_FAILED');
      const data = await model.decodeSnapshot(await response.arrayBuffer());
      if (version !== requestVersion) return;
      catalog = data;
      $('catalog-product-count').textContent = data.products.length;
      $('catalog-part-count').textContent = data.parts.length;
      $('catalog-group-count').textContent = data.assemblyRelations.length;
      $('catalog-version').textContent = '· ' + model.EXPECTED_SHA256.slice(0, 12);
      categories(); draw(); state('ready', '已載入有來源的公開資料。');
    } catch (error) {
      if (version !== requestVersion) return;
      clear();
      const message = error.message === 'SECURE_CONTEXT_REQUIRED' ? '此瀏覽器無法安全檢查資料。請使用支援安全驗證的瀏覽器，以加密連線（HTTPS）或本機網址開啟。' :
        ['SNAPSHOT_VERSION_MISMATCH', 'INVALID_PUBLIC_CATALOG'].includes(error.message) ? '資料版本或格式不符，已停止顯示。請重新讀取；若持續發生，請稍後再試。' :
        '資料暫時無法讀取。請確認連線後重新讀取。';
      state('error', message);
    } finally { window.clearTimeout(timeout); }
  }
  $('catalog-search').addEventListener('input', draw);
  $('catalog-category').addEventListener('change', draw);
  $('catalog-reset').addEventListener('click', () => {
    $('catalog-search').value = ''; $('catalog-category').value = 'all'; draw(); $('catalog-search').focus();
  });
  document.querySelectorAll('[data-catalog-tab]').forEach(button => button.addEventListener('click', () => {
    if (!catalog || button.dataset.catalogTab === tab) return;
    tab = button.dataset.catalogTab;
    document.querySelectorAll('[data-catalog-tab]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    categories(); draw();
  }));
  $('catalog-retry').addEventListener('click', load);
  load();
})();
