/* Public snapshot contract. No private loader, authentication or database dependency. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BXHPublicCatalog = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EXPECTED_SHA256 = 'd8f36e95e0a12ae411df9e336411c0dd65f9797729b2f772c00a5abb4507b927';
  const EXPECTED_BYTES = 64615;
  const DATA_URL = './data/bey-catalog/public-catalog.' + EXPECTED_SHA256 + '.json';
  const COUNTS = Object.freeze({products: 9, parts: 45, options: 13, assemblyRelations: 11, contentFacts: 38});
  const PACKAGE_LABELS = Object.freeze({booster: '強化組', starter: '入門組', random_booster: '隨機強化組', deck_set: '套組', part_set: '零件組'});
  const CATEGORY_LABELS = Object.freeze({blade: '刀刃', ratchet: '棘輪', bit: '軸心', blade_ratchet: '刀刃／棘輪整合型', lock_chip: '鎖定晶片', main_blade: '主刀刃', assist_blade: '輔助刀刃', ratchet_bit: '棘輪／軸心整合型', metal_blade: '金屬刀刃', over_blade: '外層刀刃'});
  // Presentation-only aliases, keyed by the exact sourced name. These are provisional
  // translations, not Taiwan-official names or evidence/verification state. The public
  // snapshot and its integrity pin stay unchanged; unknown names are never guessed.
  const DISPLAY_NAMES = Object.freeze({
    'ウィザードロッド5-70DB': '魔導神杖 5-70DB',
    'バレットグリフォンH': '彈丸獅鷲 H',
    'グローリーワルキューレLF': '榮耀武神 LF',
    'ペガサスブラストATr': '天馬爆擊 ATr',
    'バハムートブリッツBK1-50I': '龍王閃擊 BK1-50I',
    'ランダムブースターVol.8': '隨機強化組 第 8 彈',
    'ドランソード3-60F': '蒼龍神劍 3-60F',
    'ドランダガーデッキセット': '蒼龍利刃改造組',
    'ロックチップ/ドラン クリアブラックVer. and ベイバトルパスシート': '蒼龍鎖定紋章〈透明黑版〉＋陀螺對戰通行證貼紙',
    'ウィザードロッド': '魔導神杖',
    'バレットグリフォン': '彈丸獅鷲',
    'グローリーワルキューレ': '榮耀武神',
    'マミーカース': '古屍詛咒',
    'ドランソード': '蒼龍神劍',
    'ドランダガー': '蒼龍利刃',
    'シャークエッジ': '鮫鯊鋒鰭',
    'ナイトシールド': '騎士重盾',
    'ロックチップ/ドラン': '蒼龍鎖定紋章',
    'ペガサス': '天馬',
    'ブラスト': '爆擊',
    'A（アサルト）': '突襲 A',
    'バハムート': '龍王',
    'ブリッツ': '閃擊',
    'B（ブレイク）': '破擊 B',
    'K（ナックル）': '拳擊 K',
    'ブラッシュ': '布拉許',
    'M（マッシブ）': '馬西夫 M',
    'ソル': '索爾',
    'ブレイブ': '勇氣',
    'C（チャージ）': '衝鋒 C',
    'ヴァイスタイガー': '皓戰猛虎',
    'マミーカース7-55W': '古屍詛咒 7-55W',
    'マミーカース4-60C': '古屍詛咒 4-60C',
    'ペガサスブラッシュM3-85W': '天馬九尾 M3-85W',
    'ソルブレイブC9-70TP': '焰神勇氣 C9-70TP',
    'ドランダガー7-55G': '蒼龍利刃 7-55G',
    'ヴァイスタイガー4-80LR': '皓戰猛虎 4-80LR',
    'ドランダガー4-60R': '蒼龍利刃 4-60R',
    'ロックチップ/ドラン クリアブラックVer.': '蒼龍鎖定紋章〈透明黑版〉'
  });
  // Bounded presentation assets; never infer an image from a record ID or filename.
  const OPTION_IMAGES = Object.freeze([
  {
    "optionCode": "01",
    "sourceUrl": "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/UX18_02@1.png",
    "sourceSha256": "b5c5e8ecece69d06fea387088db83f44d1372cfa7ccbc39546ff53bcce37e03e",
    "sourceBytes": 223301,
    "path": "assets/bey-catalog/ux18/ux18-01.webp",
    "width": 586,
    "height": 709,
    "bytes": 29100,
    "sha256": "86895189698e65ca5e051569d4d1d0d88a8a7056580600f7fde52deadbfd93b5",
    "originalName": "マミーカース7-55W",
    "optionId": "option_000006"
  },
  {
    "optionCode": "02",
    "sourceUrl": "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/UX18_03@1.png",
    "sourceSha256": "9232f8abd2f8047db85d247058137732b59ab8cacc347c9fe117d001f16db5b8",
    "sourceBytes": 242421,
    "path": "assets/bey-catalog/ux18/ux18-02.webp",
    "width": 586,
    "height": 709,
    "bytes": 32586,
    "sha256": "582a72113ba30ceda15ace7f1ba2308a3215aab96ac8b724266c7f65505a7589",
    "originalName": "マミーカース4-60C",
    "optionId": "option_000007"
  },
  {
    "optionCode": "03",
    "sourceUrl": "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/UX18_06@1.png",
    "sourceSha256": "303331e4298913f994525efbe1d1ab21f53729264c0eee74090047e447bc252e",
    "sourceBytes": 255692,
    "path": "assets/bey-catalog/ux18/ux18-03.webp",
    "width": 586,
    "height": 709,
    "bytes": 41528,
    "sha256": "ad2514bbd680a721a06cbdf57f7b177bc832c6f7fd53ccc537ff32588e07b12e",
    "originalName": "ペガサスブラッシュM3-85W",
    "optionId": "option_000008"
  },
  {
    "optionCode": "04",
    "sourceUrl": "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/UX18_07@1.png",
    "sourceSha256": "f6bbbd7467c470fedc0761e2290557d0a715b4bddc88040b332d0cfe7639bf30",
    "sourceBytes": 236306,
    "path": "assets/bey-catalog/ux18/ux18-04.webp",
    "width": 586,
    "height": 709,
    "bytes": 35522,
    "sha256": "a27b3b0a51d4c14db1cb449c89196b56cda0fa84428cd408e5c6162d91dae1c7",
    "originalName": "ソルブレイブC9-70TP",
    "optionId": "option_000009"
  },
  {
    "optionCode": "05",
    "sourceUrl": "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/UX18_04@1.png",
    "sourceSha256": "4b46df7767c6a52fb167c3e6c28e94d87b6037d671db08e6c3c9a796034dc4ac",
    "sourceBytes": 229232,
    "path": "assets/bey-catalog/ux18/ux18-05.webp",
    "width": 586,
    "height": 709,
    "bytes": 31824,
    "sha256": "cae4857fc81a2a48547aca02f47fe0bbe40903cd2b83745f9ab9951b86399be1",
    "originalName": "ドランダガー7-55G",
    "optionId": "option_000010"
  },
  {
    "optionCode": "06",
    "sourceUrl": "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/UX18_05@1.png",
    "sourceSha256": "ff951457d3444adc6eae73d2afe07f23cf3822aac6f4874c64d66a042bc9208e",
    "sourceBytes": 238548,
    "path": "assets/bey-catalog/ux18/ux18-06.webp",
    "width": 586,
    "height": 709,
    "bytes": 34640,
    "sha256": "87c8e8a9e9f24a2fe76cbcb891e770ff929bb5deedb711568902a7681eb74e44",
    "originalName": "ヴァイスタイガー4-80LR",
    "optionId": "option_000011"
  }
].map(image => Object.freeze(image)));
  function optionImage(product, option) {
    if (!product || !option || product.productId !== "product_000006" || product.productCode !== "UX-18" || product.originalName !== "ランダムブースターVol.8" || option.productId !== product.productId) return null;
    return OPTION_IMAGES.find(image => image.optionId === option.optionId && image.optionCode === option.optionCode && image.originalName === option.originalName) || null;
  }
  // Exact reviewed URLs only. Neither payload nor query parameters can extend this allowlist.
  const SOURCE_URLS = new Set([
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_UX18.png",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_bx03.png",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_bx33.png",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_bx34.png",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_bx38.png",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_ux07_r.png",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_ux11.png",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx01.html",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx20.html",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/cx07.html",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/cx13.html",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/ux03.html",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/ux18.html",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/ux19.html",
    "https://beyblade.takaratomy.co.jp/beyblade-x/lineup/ux20.html",
    "https://beyblade.takaratomy.co.jp/beyblade-x/manual/BX-01_manual.pdf",
    "https://beyblade.takaratomy.co.jp/beyblade-x/manual/BX-20_manual.pdf",
    "https://beyblade.takaratomy.co.jp/beyblade-x/manual/CX-07_manual.pdf",
    "https://beyblade.takaratomy.co.jp/beyblade-x/manual/CX-13_manual.pdf",
    "https://beyblade.takaratomy.co.jp/beyblade-x/manual/UX-03_manual.pdf",
    "https://beyblade.takaratomy.co.jp/beyblade-x/manual/UX-18_manual.pdf",
    "https://beyblade.takaratomy.co.jp/beyblade-x/manual/UX-19_manual.pdf",
    "https://beyblade.takaratomy.co.jp/beyblade-x/manual/UX-20_manual.pdf",
    "https://takaratomymall.jp/shop/g/g8202610953715/",
    "https://www.takaratomy.co.jp/support/manual/items/4904810097167_%EF%BC%B5%EF%BC%B8%EF%BC%8D%EF%BC%91%EF%BC%98%E3%80%80%E3%83%A9%E3%83%B3%E3%83%80%E3%83%A0%E3%83%96%E3%83%BC%E3%82%B9%E3%82%BF%E3%83%BC%EF%BC%B6%EF%BD%8F%EF%BD%8C%EF%BC%8E%EF%BC%98.pdf"
]);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function fail() { throw new Error('INVALID_PUBLIC_CATALOG'); }
  function exactKeys(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
        required.some(key => !own(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail();
  }
  function text(value, maximum = 200) {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) fail();
  }
  function id(value, prefix) { if (typeof value !== 'string' || !new RegExp('^' + prefix + '_[0-9]{6}$').test(value)) fail(); }
  function safeSourceUrl(value) {
    if (typeof value !== 'string' || !SOURCE_URLS.has(value)) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash ? value : null;
    } catch (_) { return null; }
  }
  function sourceList(value) {
    if (!Array.isArray(value) || !value.length || value.length > 25 || new Set(value).size !== value.length || value.some(url => !safeSourceUrl(url))) fail();
  }
  function sources(value, fields) {
    exactKeys(value, fields);
    fields.forEach(field => sourceList(value[field]));
  }
  function index(items, key, prefix) {
    const map = new Map();
    for (const item of items) {
      if (!item || typeof item !== 'object') fail();
      id(item[key], prefix);
      if (map.has(item[key])) fail();
      map.set(item[key], item);
    }
    return map;
  }
  function validateCatalog(data) {
    exactKeys(data, Object.keys(COUNTS));
    for (const [key, count] of Object.entries(COUNTS)) if (!Array.isArray(data[key]) || data[key].length !== count) fail();
    const products = index(data.products, 'productId', 'product');
    const parts = index(data.parts, 'partId', 'part');
    const options = index(data.options, 'optionId', 'option');
    const groups = index(data.assemblyRelations, 'groupId', 'group');
    const facts = index(data.contentFacts, 'contentClaimId', '(?:content|claim)');
    for (const item of data.products) {
      exactKeys(item, ['productId', 'productCode', 'originalName', 'packageType', 'sourceUrls', 'compositionComplete']);
      if (!/^(BX|UX|CX)-[0-9]{2}$/.test(item.productCode) || !own(PACKAGE_LABELS, item.packageType) || item.compositionComplete !== false) fail();
      text(item.originalName); sources(item.sourceUrls, ['productCode', 'originalName', 'packageType']);
    }
    if (new Set(data.products.map(item => item.productCode)).size !== data.products.length) fail();
    for (const item of data.parts) {
      exactKeys(item, ['partId', 'originalName', 'category', 'sourceUrls']);
      text(item.originalName); if (!own(CATEGORY_LABELS, item.category)) fail();
      sources(item.sourceUrls, ['originalName', 'category']);
    }
    for (const item of data.options) {
      exactKeys(item, ['optionId', 'productId', 'sourceUrls', 'compositionComplete'], ['optionCode', 'originalName']);
      if (!products.has(item.productId) || item.compositionComplete !== false || own(item, 'optionCode') !== own(item, 'originalName')) fail();
      if (own(item, 'optionCode')) {
        if (!/^[0-9]{2}$/.test(item.optionCode)) fail();
        text(item.originalName); sources(item.sourceUrls, ['optionCode', 'originalName']);
      } else sources(item.sourceUrls, ['optionId', 'productId']);
    }
    const usedClaims = new Set();
    for (const item of data.assemblyRelations) {
      exactKeys(item, ['groupId', 'productId', 'optionId', 'sourceUrls', 'compositionComplete', 'expectedParts', 'compositionSourceUrls'], ['originalName']);
      if (!products.has(item.productId) || options.get(item.optionId)?.productId !== item.productId || item.compositionComplete !== true) fail();
      if (own(item, 'originalName')) text(item.originalName);
      sources(item.sourceUrls, own(item, 'originalName') ? ['originalName'] : []); sourceList(item.compositionSourceUrls);
      if (!Array.isArray(item.expectedParts) || !item.expectedParts.length || item.expectedParts.length > 10) fail();
      const partIds = new Set();
      for (const relation of item.expectedParts) {
        exactKeys(relation, ['contentClaimId', 'partId', 'category', 'quantity']);
        const part = parts.get(relation.partId), fact = facts.get(relation.contentClaimId);
        if (!part || relation.category !== part.category || partIds.has(relation.partId) || usedClaims.has(relation.contentClaimId) ||
            !Number.isSafeInteger(relation.quantity) || relation.quantity < 1 || relation.quantity > 20 ||
            !fact || fact.groupId !== item.groupId || fact.productId !== item.productId || fact.optionId !== item.optionId ||
            fact.partId !== relation.partId || fact.quantity !== relation.quantity) fail();
        partIds.add(relation.partId); usedClaims.add(relation.contentClaimId);
      }
    }
    for (const item of data.contentFacts) {
      exactKeys(item, ['contentClaimId', 'productId', 'optionId', 'groupId', 'partId', 'quantity', 'sourceUrls']);
      if (!usedClaims.has(item.contentClaimId) || !groups.has(item.groupId)) fail();
      sources(item.sourceUrls, ['partId', 'quantity']);
    }
    return data;
  }
  async function decodeSnapshot(buffer, cryptoApi = globalThis.crypto) {
    if (!cryptoApi?.subtle) throw new Error('SECURE_CONTEXT_REQUIRED');
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== EXPECTED_BYTES) throw new Error('SNAPSHOT_VERSION_MISMATCH');
    const digest = await cryptoApi.subtle.digest('SHA-256', buffer);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== EXPECTED_SHA256) throw new Error('SNAPSHOT_VERSION_MISMATCH');
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer)); }
    catch (_) { throw new Error('INVALID_PUBLIC_CATALOG'); }
    return validateCatalog(data);
  }
  function uniqueSources(...records) {
    return [...new Set(records.flatMap(record => Object.values(record?.sourceUrls || {}).flat().concat(record?.compositionSourceUrls || [])))].filter(safeSourceUrl);
  }
  function displayName(record, fallback = '中文名稱待補') {
    const original = typeof record?.originalName === 'string' ? record.originalName : '';
    if (!original) return Object.freeze({primary: fallback, original: '', status: 'missing', label: ''});
    if (own(DISPLAY_NAMES, original)) return Object.freeze({primary: DISPLAY_NAMES[original], original, status: 'provisional_translation', label: '中文暫譯'});
    // A code plus an already validated category is a description, never a translated
    // official name. Do not expand DB, Tr, or other codes into performance claims.
    if (own(CATEGORY_LABELS, record.category) && /^[A-Za-z0-9]+(?:-[0-9]+)*$/u.test(original)) {
      return Object.freeze({primary: original + ' ' + CATEGORY_LABELS[record.category], original, status: 'code_label', label: '代碼＋分類'});
    }
    return Object.freeze({primary: fallback, original, status: 'untranslated', label: '中文名稱待補'});
  }
  function normalized(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/[\s\-‐‑–—]+/gu, ''); }
  function filterCatalog(data, tab = 'products', query = '', category = 'all') {
    if (!['products', 'parts'].includes(tab)) return [];
    const needle = normalized(query).slice(0, 120);
    const partMap = new Map(data.parts.map(item => [item.partId, item]));
    const productMap = new Map(data.products.map(item => [item.productId, item]));
    return data[tab].filter(item => {
      const kind = tab === 'products' ? item.packageType : item.category;
      if (category !== 'all' && category !== kind) return false;
      const fields = [item.originalName, displayName(item).primary, item.productCode, PACKAGE_LABELS[kind], CATEGORY_LABELS[kind]];
      if (tab === 'products') {
        for (const option of data.options.filter(option => option.productId === item.productId)) {
          if (option.originalName) fields.push(option.originalName, displayName(option).primary);
          fields.push(option.optionCode);
          if (option.optionCode) fields.push(item.productCode + '-' + option.optionCode);
        }
        for (const group of data.assemblyRelations.filter(group => group.productId === item.productId)) {
          if (group.originalName) fields.push(group.originalName, displayName(group).primary);
        }
        for (const fact of data.contentFacts.filter(fact => fact.productId === item.productId)) {
          const part = partMap.get(fact.partId);
          if (part) fields.push(part.originalName, displayName(part).primary);
        }
      } else {
        for (const fact of data.contentFacts.filter(fact => fact.partId === item.partId)) fields.push(productMap.get(fact.productId)?.productCode);
      }
      return !needle || fields.some(field => normalized(field).includes(needle));
    });
  }
  return Object.freeze({EXPECTED_SHA256, EXPECTED_BYTES, DATA_URL, COUNTS, PACKAGE_LABELS, CATEGORY_LABELS, DISPLAY_NAMES, OPTION_IMAGES, optionImage, displayName, safeSourceUrl, validateCatalog, decodeSnapshot, uniqueSources, filterCatalog});
});
