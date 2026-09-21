const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const cname=fs.readFileSync(path.join(root,'CNAME'),'utf8').trim();
const version=JSON.parse(fs.readFileSync(path.join(root,'version.json'),'utf8'));
function must(re,msg){if(!re.test(html))throw new Error(msg)}
function mustNot(re,msg){if(re.test(html))throw new Error(msg)}
function mustInclude(text,msg){if(!html.includes(text))throw new Error(msg)}
if(cname!=='arena.bxh.com.tw')throw new Error('Unexpected CNAME: '+cname);
mustInclude('<meta name="bxh-build" content="'+String(version.build||'')+'">','index.html bxh-build must match version.json');
mustInclude('CURRENT_BUILD="'+String(version.build||'')+'"','CURRENT_BUILD must match version.json');
mustInclude('const APP_VERSION = "'+String(version.version||'')+'"','APP_VERSION must match version.json');
must(/projectId:\s*["']bxh-arena["']/, 'Production projectId missing');
must(/authDomain:\s*["']bxh-arena\.firebaseapp\.com["']/, 'Production authDomain missing');
must(/async\s+applyPlayerAccount\([\s\S]*?role:\s*["']player["'][\s\S]*?provider:\s*["']password["']/, 'Self-service signup must create role=player with password provider');
must(/async\s+completeNewPlayerProfile\([\s\S]*?role:\s*["']player["'][\s\S]*?provider:\s*["']password["']/, 'Missing-profile recovery must create role=player with password provider');
must(/function\s+canCreateOfficialTournament\(\)\{[^\n]*!isTester\(\)/, 'Tester must be excluded from official tournament creation');
mustNot(/if\(action===["']player-google-signin["']\)/, 'Google sign-in action is still active');
mustNot(/async\s+signInWithGoogle\s*\(/, 'Google sign-in runtime method is still active');
mustNot(/GoogleAuthProvider:\s*authMod\.GoogleAuthProvider/, 'GoogleAuthProvider is still wired into runtime');
mustNot(/getRedirectResult\(authHandle\)/, 'Google redirect result runtime is still active');
mustNot(/popupRedirectResolver:\s*authMod\.browserPopupRedirectResolver/, 'Popup/redirect resolver is still active');
mustNot(/role:\s*["']tester["'],\s*active:\s*true,\s*provider:\s*["'](?:password|google)["']/, 'Public signup/recovery still creates tester role');
must(/PUBLIC_TOURNAMENTS_RECONCILE_MS\s*=\s*90000/, 'Lobby reconciliation must be 90 seconds');
must(/subscribePublicTournaments\(callback\)/, 'Realtime public tournament listener missing');
must(/visibilitychange[\s\S]*?reconcilePublicTournamentsNow\(["']foreground["']\)/, 'Foreground reconciliation missing');
must(/window\.addEventListener\(["']focus["'][\s\S]*?reconcilePublicTournamentsNow\(["']focus["']\)/, 'Focus reconciliation missing');
mustNot(/PUBLIC_TOURNAMENTS_AUTO_REFRESH_MS\s*=\s*15000/, 'Legacy 15-second lobby polling is still active');
console.log('PASS Production frontend target');
console.log('PASS Email/Password-only runtime');
console.log('PASS self-service role=player');
console.log('PASS tester official-event UI guard');
console.log('PASS realtime lobby sync guard');
console.log('PASS build/version metadata consistency');
