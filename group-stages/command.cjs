'use strict';

function createGroupStageCommand(coordinator) {
  return async request => {
    const actorUid = request.auth?.uid;
    const { action, parentCode, stage, roomCode, groupCount, court, revision } = request.data || {};
    switch (action) {
      case 'routing': return coordinator.readRouting(parentCode, actorUid);
      case 'status': return coordinator.readOperatorStatus(parentCode, actorUid);
      case 'prepare': return coordinator.prepare(parentCode, actorUid, groupCount);
      case 'open-all': return coordinator.openAllGroups(parentCode, actorUid);
      case 'open': return coordinator.openNext(parentCode, stage, actorUid);
      case 'publish-draw': return coordinator.publishDraw(parentCode, stage, roomCode, actorUid);
      case 'collect': return coordinator.collect(parentCode, stage, roomCode, actorUid);
      case 'release-court':
      case 'claim-court': return coordinator.changeCourt(parentCode, stage, court, revision, action === 'claim-court', actorUid);
      default: throw Object.assign(new Error('group-invalid-action'), { code: 'group-invalid-action' });
    }
  };
}

module.exports = { createGroupStageCommand };
