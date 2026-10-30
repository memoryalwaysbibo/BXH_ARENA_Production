'use strict';
// Pure, fail-closed patcher. Source packages and Function metadata remain private.
// Each existing Function must be patched from its own captured deployed source.
function once(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw Error('live-source-anchor-changed:' + needle.slice(0, 70));
  return source.replace(needle, replacement);
}
function patchLive(index, {evaluator = false, snapshot = false, definitionEditor = false, counter = false} = {}) {
  if (!evaluator && !snapshot && !definitionEditor && !counter) throw Error('explicit-patch-role-required');
  if (index.includes('case "total_online_minutes"') || index.includes('onlineTimeTitleService')) throw Error('already-patched');
  const changes = [];
  if (evaluator || counter) {
    index = once(index, '    case "total_checkins": return Number(stats.totalCheckInDays || 0);',
      '    case "total_online_minutes": {\n' +
      '      const ms = stats.officialOnlineTimeMs;\n' +
      '      return Number.isSafeInteger(ms) && ms >= 0 ? Math.floor(ms / 60000) : 0;\n' +
      '    }\n    case "total_checkins": return Number(stats.totalCheckInDays || 0);');
    changes.push('online-minutes-condition');
    // The independent counter owns online progress and awards. Legacy generic
    // evaluators must not write a stale stats snapshot over its newer progress.
    const start=index.indexOf('async function evaluateTitles('),end=index.indexOf('\n}',start);
    if(start<0||end<=start)throw Error('generic-evaluator-boundary-changed');
    const evaluatorSource=once(index.slice(start,end),'      const def = doc.data();',
      '      const def = doc.data();\n      if (def.conditionType === "total_online_minutes") continue;');
    index=index.slice(0,start)+evaluatorSource+index.slice(end);
    changes.push('independent-online-progress-owner');
  }
  if (snapshot) {
    const start = index.indexOf('function publicDefinition(id, definition) {');
    const end = index.indexOf('\nfunction conditionProgress(', start);
    if (start < 0 || end <= start) throw Error('public-projection-boundary-changed');
    let projection = index.slice(start, end);
    if (!projection.includes('conditionType:')) {
      projection = once(projection, '    hint: String(definition.hint || ""),',
        '    hint: String(definition.hint || ""),\n' +
        '    ...(definition.conditionType === "total_online_minutes" ? {\n' +
        '      conditionType: "total_online_minutes",\n' +
        '      rarityTier: String(definition.rarityTier || definition.rarity || "common"),\n' +
        '      limitedType: "none"\n' +
        '    } : {}),');
      index = index.slice(0, start) + projection + index.slice(end);
      changes.push('online-title-projection');
    }
  }
  if (definitionEditor) {
    if (!index.includes('const EXECUTABLE_TITLE_CONDITIONS = new Set(')) throw Error('definition-editor-contract-changed');
    index += '\nEXECUTABLE_TITLE_CONDITIONS.add("total_online_minutes");\n';
    changes.push('definition-editor-condition');
  }
  if (counter) {
    if (!index.includes('async function awardTitle(') || !/\bonDocumentWritten\b/.test(index)) throw Error('counter-native-award-contract-changed');
    index += '\nconst onlineTimeTitleService=require("./online-time-titles/service.cjs").createService(db,{awardTitle});\n' +
      'exports.onlineTimeTitlePresenceWritten=onDocumentWritten({document:"onlinePresence/{uid}",region:REGION,retry:true},onlineTimeTitleService);\n';
    changes.push('new-independent-counter');
  }
  return {index, changes, deployAllowed: false};
}
module.exports = {patchLive};
