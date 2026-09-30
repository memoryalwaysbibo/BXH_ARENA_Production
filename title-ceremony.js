(function(){
'use strict';
const TIER_LABELS={common:'一般',rare:'稀有',epic:'史詩',legendary:'傳說',eternal:'永恆'};
const LIMIT_LABELS={event:'活動限定',season:'賽季限定',identity:'身分限定',unique:'唯一限定',launch:'開服限定',beta:'封測限定',legacy:'限定'};
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function artFor(title){
  if(title?.artwork)return title.artwork;
  const map={'S2總冠軍':'assets/title-limited-s2-champion.webp','S3總冠軍':'assets/title-limited-s3-champion.webp'};
  return map[String(title?.name||'')]||'';
}
function tier(title){return String(title?.rarityTier||title?.rarity||'common');}
function limit(title){return String(title?.limitedType||'none');}
function reduceMotion(){return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;}
function haptic(pattern){try{if(navigator.vibrate)navigator.vibrate(pattern);}catch(_){}}
function close(root){root?.remove();document.documentElement.classList.remove('title-ceremony-open');}
function particles(root,count){
  if(reduceMotion())return;
  const layer=root.querySelector('.tc-particles');
  for(let i=0;i<count;i++){
    const p=document.createElement('i');
    const a=(Math.PI*2*i/count)+(Math.random()*.25);
    const dist=100+Math.random()*220;
    p.style.setProperty('--x',Math.cos(a)*dist+'px');
    p.style.setProperty('--y',Math.sin(a)*dist+'px');
    p.style.setProperty('--d',(Math.random()*.9)+'s');
    p.style.setProperty('--s',(2+Math.random()*5)+'px');
    layer.appendChild(p);
  }
}
function play(options={}){
  const title=options.title||{};
  const rarity=tier(title),limited=limit(title),unique=limited==='unique';
  const art=artFor(title),name=String(title.name||'榮譽稱號');
  const root=document.createElement('div');
  root.className='title-ceremony tc-'+rarity+(unique?' tc-unique':'')+(options.replay?' tc-replay':'');
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','稱號授勳');
  root.innerHTML='<div class="tc-bg"></div><div class="tc-rays"></div><div class="tc-particles"></div><button class="tc-skip" type="button">略過</button><main class="tc-stage"><div class="tc-kicker">BXH ARENA · TITLE CEREMONY</div><div class="tc-pretitle">'+(options.replay?'榮耀重現':'恭喜獲得')+'</div><div class="tc-art-wrap"><div class="tc-halo"></div>'+(art?'<img class="tc-art" src="'+esc(art)+'" alt="'+esc(name)+'">':'<div class="tc-fallback">👑</div>')+'<div class="tc-sweep"></div></div><div class="tc-class"><span>'+esc(TIER_LABELS[rarity]||rarity)+'</span>'+(limited!=='none'?'<b>・</b><span>'+esc(LIMIT_LABELS[limited]||limited)+'</span>':'')+'</div><h1>'+esc(name)+'</h1>'+(title.description?'<p class="tc-description">'+esc(title.description)+'</p>':'')+'<div class="tc-seal">'+(unique?'ONLY ONE · UNIQUE HONOR':'HONOR RECORDED')+'</div><button class="tc-done" type="button">'+(options.replay?'結束回放':'收藏這份榮耀')+'</button></main>';
  document.body.appendChild(root);document.documentElement.classList.add('title-ceremony-open');
  particles(root,rarity==='eternal'?56:rarity==='legendary'?42:28);
  const finish=()=>{haptic(20);close(root);options.onComplete?.();};
  root.querySelector('.tc-skip').addEventListener('click',finish);
  root.querySelector('.tc-done').addEventListener('click',finish);
  root.addEventListener('keydown',e=>{if(e.key==='Escape')finish();});
  requestAnimationFrame(()=>root.classList.add('tc-play'));
  if(!options.replay){setTimeout(()=>haptic([18,45,28]),700);setTimeout(()=>haptic([35,35,70]),1850);}
  return root;
}
function demoS2(){return play({title:{name:'S2總冠軍',rarityTier:'eternal',limitedType:'unique',description:'2026 BXH 美食盃第二屆總決賽總冠軍榮譽稱號。'}});}
window.BXHTitleCeremony={play,demoS2,version:'1.0.0'};
})();