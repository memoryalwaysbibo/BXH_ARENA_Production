(function(){
// Core P1E — pure title display/classification utilities.
// Keep this module side-effect free: no DOM, Firebase, storage, or app-state access.
function titleArtworkPath(name,rarity){
  const key=String(name||'');
  const map={
    '創世者':'assets/title-eternal-creator.webp',
    '裁決者':'assets/title-eternal-adjudicator.webp',
    '審判者':'assets/title-eternal-adjudicator.webp',
    '開拓者':'assets/title-limited-pioneer.webp',
    '諸神典藏者':'assets/title-limited-gods-collector.webp',
    '諸神收藏家':'assets/title-limited-gods-collector.webp',
    'S2總冠軍':'assets/title-limited-s2-champion.webp',
    'S3總冠軍':'assets/title-limited-s3-champion.webp',
    '三冠王':'assets/title-legendary-triple-crown.webp',
    '二當家':'assets/title-limited-co-leader.webp',
    '三當家':'assets/title-limited-third-leader.webp',
    'BXH 工作人員':'assets/title-limited-bxh-staff.webp',
    '封測先鋒':'assets/title-limited-closed-beta.webp',
    '百戰磨練':'assets/title-epic-hundred-battles.webp',
    '四強霸主':'assets/title-epic-top4-overlord.webp',
    '冠軍獵人':'assets/title-epic-champion-hunter.webp',
    '百日戰士':'assets/title-epic-hundred-day-warrior.webp',
    '初次開局':'assets/title-rare-first-match.webp',
    '整裝待發':'assets/title-common-ready.svg',
    '初次上陣':'assets/title-common-debut.svg',
    '對戰召集人':'assets/title-rare-host-3.webp',
    '賽事推手':'assets/title-rare-host-10.webp',
    '資深主辦':'assets/title-rare-host-20.webp',
    '競技場主':'assets/title-rare-host-30.webp'
  };
  return map[key]||'';
}
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

Object.assign(window.BXHTitleUtils||(window.BXHTitleUtils={}),{titleArtworkPath,titleDisplayName,TITLE_TIER_LABELS,TITLE_LIMITED_LABELS,titleRarityLabel,titleTierValue,titleTierClass,titleTierLabel,titleLimitedTypeValue,titleLimitedLabel,titlePermanentLabel,titleClassificationText,formatTitleDisplay,titleClassificationHtml});

})();
