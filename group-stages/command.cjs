'use strict';

function createGroupStageCommand(coordinator) {
  return async request => {
    const actorUid = request.auth?.uid;
    const { action, parentCode, stage, roomCode } = request.data || {};
    switch (action) {
      case 'routing': return coordinator.readRouting(parentCode, actorUid);
      case 'prepare': return coordinator.prepare(parentCode, actorUid);
      case 'open': return coordinator.openNext(parentCode, stage, actorUid);
      case 'collect': return coordinator.collect(parentCode, stage, roomCode, actorUid);
      default: throw Object.assign(new Error('group-invalid-action'), { code: 'group-invalid-action' });
    }
  };
}

module.exports = { createGroupStageCommand };
