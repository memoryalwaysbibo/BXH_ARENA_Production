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
    '新銳獵人':'assets/title-common-rookie-hunter-v1.webp',
    '戰場熟面孔':'assets/title-rare-familiar-face-v1.webp',
    '初來乍到':'assets/title-common-first-checkin-v1.webp',
    '七日常客':'assets/title-common-seven-day-guest-v1.webp',
    '三冠王':'assets/title-legendary-triple-crown-v3.webp',
    '二當家':'assets/title-limited-co-leader.webp',
    '三當家':'assets/title-limited-third-leader.webp',
    'BXH 工作人員':'assets/title-limited-bxh-staff.webp',
    '封測先鋒':'assets/title-limited-closed-beta.webp',
    '百戰磨練':'assets/title-milestone-100.webp',
    '雙生修羅':'assets/title-milestone-200.webp',
    '三途橫渡':'assets/title-milestone-300.webp',
    '四神俱滅':'assets/title-milestone-400.webp',
    '五嶽崩摧':'assets/title-milestone-500.webp',
    '六道輪迴':'assets/title-milestone-600.webp',
    '七星隕落':'assets/title-milestone-700.webp',
    '八荒血帝':'assets/title-milestone-800.webp',
    '九天終焉':'assets/title-milestone-900.webp',
    '千古不滅':'assets/title-milestone-1000.webp',
    '四強霸主':'assets/title-epic-top4-overlord.webp',
    '冠軍獵人':'assets/title-epic-champion-hunter.webp',
    '百日戰士':'assets/title-epic-hundred-day-warrior.webp',
    '準時回家':'assets/title-common-home-on-time-v2.webp',
    '開場即結束':'assets/title-rare-over-at-start-v2.webp',
    '誰能比我慘':'assets/title-epic-unluckiest-heartbreak-v5.webp',
    '晚點回家':'assets/title-common-home-later-v1.webp',
    '連勝之刃':'assets/title-rare-winning-blade-kai-v3.webp',
    '勢如破竹':'assets/title-epic-unstoppable-bamboo-v1.webp',
    '不敗傳說':'assets/title-legendary-undefeated-kai-v2.webp',
    'S1 賽季王者':'assets/title-legendary-season-king-s1-kai-v2.webp',
    'S1賽季王者':'assets/title-legendary-season-king-s1-kai-v2.webp',
    '初代戰士':'assets/title-epic-first-generation-warrior-v1.webp',
    '四方征戰':'assets/title-epic-four-venues-v1.webp',
    '八強逐鹿':'assets/title-rare-top8-zhulu-v1.webp',
    '初入鋒芒':'assets/title-rare-top16-first-edge-v2.webp',
    '八強壁壘':'assets/title-epic-top8-bastion-v2.webp',
    '初次開局':'assets/title-rare-first-match.webp',
    '整裝待發':'assets/title-common-ready-zhulu-v2.webp',
    '初次上陣':'assets/title-common-debut-zhulu-v2.webp',
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
// Display-only limited marker: eligibility remains the five-event achievement contract.
function titleLimitedLabel(t){
  if(t&&((t.id||t.titleId)==='first_exit_5'||t.displayLimitedLabel==='限定'))return '限定';
  return TITLE_LIMITED_LABELS[titleLimitedTypeValue(t)]||"";
}
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
