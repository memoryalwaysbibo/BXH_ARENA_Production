// Core P1E — pure title display/classification utilities.
// Keep this module side-effect free: no DOM, Firebase, storage, or app-state access.
function titleDisplayName(name){return name==='審判者'?'裁決者':name;}
const TITLE_TIER_LABELS=Object.freeze({common:"一般",rare:"稀有",epic:"史詩",legendary:"傳說",eternal:"永恆",unrated:"待分級"});
const TITLE_LIMITED_LABELS=Object.freeze({none:"",event:"活動限定",season:"賽季限定",identity:"身分限定",unique:"唯一限定",launch:"開服限定",beta:"封測限定",legacy:"限定（舊制）"});
function titleRarityLabel(r){return r==="limited"?"待分級":TITLE_TIER_LABELS[r]||"一般";}
function titleTierValue(t){
  if(typeof t==="string")return t==="limited"?"unrated":(TITLE_TIER_LABELS[t]?t:"common");
  const explicit=String(t&&t.rarityTier||"");
  if(TITLE_TIER_LABELS[explicit])return explicit;
  const legacy=String(t&&t.rarity||"common");
  return legacy==="limited"?"unrated":(TITLE_TIER_LABELS[legacy]?legacy:"common");
}
function titleTierClass(t){const v=titleTierValue(t);return v==="unrated"?"limited":v;}
function titleTierLabel(t){return TITLE_TIER_LABELS[titleTierValue(t)]||"一般";}
function titleLimitedTypeValue(t){
  const explicit=String(t&&t.limitedType||"");
  if(Object.prototype.hasOwnProperty.call(TITLE_LIMITED_LABELS,explicit))return explicit;
  return t&&(t.isLimited===true||String(t.rarity||"")==="limited")?"legacy":"none";
}
function titleLimitedLabel(t){return TITLE_LIMITED_LABELS[titleLimitedTypeValue(t)]||"";}
function titlePermanentLabel(t){return t&&t.isPermanent===false?"期間制":"永久持有";}
function titleClassificationText(t){const tag=titleLimitedLabel(t);return titleTierLabel(t)+(tag?"｜"+tag:"")+"｜"+titlePermanentLabel(t);}
function titleClassificationHtml(t){
  const tier=titleTierValue(t),tag=titleLimitedLabel(t);
  return '<span class="rarity-badge rarity-'+esc(titleTierClass(t))+'">'+esc(titleTierLabel(t))+'</span>'+(tag?' <span class="rarity-badge title-limit-badge">'+esc(tag)+'</span>':'');
}
function formatTitleDisplay(realName,gameId,titleName,format,enabled=true){
  const real=String(realName||"").trim()||"玩家";
  const game=String(gameId||"").trim()||real;
  if(!enabled || !titleName) return `${real}${game!==real?`（${game}）`:""}`;
  if(format==="realname_title") return `${real}（${titleName}）`;
  if(format==="nickname_title") return `${game}（${titleName}）`;
  if(format==="realname_dash_nickname_title") return `${real}－${game}（${titleName}）`;
  return `${real}${game!==real?`（${game}）`:""}・${titleName}`;
}

Object.assign(window.BXHTitleUtils||(window.BXHTitleUtils={}),{titleDisplayName,TITLE_TIER_LABELS,TITLE_LIMITED_LABELS,titleRarityLabel,titleTierValue,titleTierClass,titleTierLabel,titleLimitedTypeValue,titleLimitedLabel,titlePermanentLabel,titleClassificationText,formatTitleDisplay});
