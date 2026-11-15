'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {archiveGeneral}=require('../../referee-seats/functions/bucket-general-archive.cjs');
function fixture(){return {room:{eventAuthority:'official',ladderMode:'general'},state:{meta:{eventAuthority:'official',ladderMode:'general',formatType:'single'},players:[{id:'a'},{id:'b'}],matches:[{id:'f',bracket:'SE',round:0,completed:true,winnerId:'a',loserId:'b'}],championId:'a',runnerUpId:'b'}};}
test('general final closes root, public lifecycle and response in the confirming transaction',()=>{
 const {room,state}=fixture(),result=archiveGeneral(room,state,1000);assert.deepEqual(result.document,{archiveStatus:'completed',tournamentPhase:'done',registrationStatus:'closed'});assert.equal(state.archivedAt,1000);assert.equal(state.settlementPhase,'completed');assert.equal(state.ladderPointsAwarded,false);assert.equal(state.championId,'a');
});
test('ranked and incomplete results cannot take the no-ladder archive path',()=>{
 for(const mutate of [f=>f.room.ladderMode='ranked',f=>f.state.meta.ladderMode='ranked',f=>f.state.matches[0].completed=false,f=>f.state.championId='missing',f=>f.state.runnerUpId='a',f=>f.state.matches[0].winnerId='b',f=>f.state.meta.formatType='double']){
  const f=fixture();mutate(f);const before=JSON.stringify(f.state);assert.equal(archiveGeneral(f.room,f.state,1000),null);assert.equal(JSON.stringify(f.state),before);
 }
});
test('required bronze placements must be distinct and present before archive',()=>{
 const f=fixture();f.state.meta.bronzeMatch=true;f.state.players.push({id:'c'},{id:'d'});assert.equal(archiveGeneral(f.room,f.state,1000),null);f.state.thirdId='c';f.state.fourthId='c';assert.equal(archiveGeneral(f.room,f.state,1000),null);f.state.fourthId='d';assert(archiveGeneral(f.room,f.state,1000));
});
