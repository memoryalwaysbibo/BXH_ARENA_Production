'use strict';
// Server-only quota preparation for the existing ranked start transaction.
// No callable export, independent start writer, grant or production rollout.
const {createHash}=require('node:crypto');
const {validateSealedSnapshot}=require('./rdw-sealed-snapshot-verifier.cjs');
const POLICY='start-v1';
const validUid=v=>typeof v==='string'&&/^[-\w]{1,128}$/.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fail(code){throw Error(code);}
function active(p){return !!p&&p.active===true&&p.isTestAccount!==true&&p.deleted!==true&&!['disabled','deleted','frozen'].includes(p.accountStatus);}
function partnerRoom(room){return !!room&&(room.createdByRole==='partner_organizer'||!!room.partnerContractOrderCode||!!room.partnerOrganizationCode);}
function stateOf(room){try{const v=typeof room?.data==='string'?JSON.parse(room.data):room?.data;return v&&typeof v==='object'&&!Array.isArray(v)?v:null;}catch{return null;}}
function period(v){
 const ms=raw=>typeof raw==='number'?raw:typeof raw==='string'&&raw.trim()?Number.isFinite(Number(raw))?Number(raw):Date.parse(raw):NaN;
 return [ms(v?.startsAtMs??v?.startsAt),ms(v?.expiresAtMs??v?.expiresAt)];
}
function context({db,eventCode,actorUid,drawRevision,expectedRosterRevision}){
 if(typeof db?.doc!=='function'||!/^BXH-[A-Z0-9]{6}$/.test(eventCode||'')||!validUid(actorUid)||!Number.isSafeInteger(drawRevision)||drawRevision<0||!Number.isSafeInteger(expectedRosterRevision)||expectedRosterRevision<0)fail('partner-quota-context-invalid');
 return {eventRef:db.doc('tournaments/'+eventCode),publicRef:db.doc('publicTournaments/'+eventCode),snapshotRef:db.doc('rdwSnapshots/'+eventCode),receiptRef:db.doc('partnerEventDebits/'+eventCode),actorRef:db.doc('users/'+actorUid)};
}
function identity(room,args){
 const {eventCode,drawRevision,expectedRosterRevision}=args;
 if(room?.createdByRole!=='partner_organizer'||(room.code&&room.code!==eventCode)||!validUid(room.createdBy)||!/^BXH-CO-\d{8}-[A-F0-9]{12,}$/.test(room.partnerContractOrderCode||'')||typeof room.partnerOrganizationCode!=='string'||!room.partnerOrganizationCode.trim())fail('partner-room-authority-invalid');
 return {policy:POLICY,eventCode,orderCode:room.partnerContractOrderCode,organizationCode:room.partnerOrganizationCode,organizerUid:room.createdBy,drawRevision,rosterRevision:expectedRosterRevision};
}
function actorMayRead(profile,actorUid,organizerUid){return active(profile)&&(actorUid===organizerUid||['admin','super_admin'].includes(profile.role));}
function checkReplay({room,publicDoc,snapshot,receipt,actorProfile,args}){
 const id=identity(room,args),p=stateOf(room),q=stateOf({data:publicDoc?.bracketView});
 if(!actorMayRead(actorProfile,args.actorUid,id.organizerUid))fail('partner-quota-actor-denied');
 if(!receipt||receipt.source!=='server'||receipt.verified!==true||receipt.debit!==1||receipt.identityHash!==hash(id)||Object.keys(id).some(k=>receipt[k]!==id[k])||!Number.isSafeInteger(receipt.startedAt)||receipt.startedAt<=0||!Number.isSafeInteger(receipt.usedBefore)||receipt.usedBefore<0||receipt.usedAfter!==receipt.usedBefore+1)fail('partner-quota-receipt-conflict');
 if(!p||!q||p.meta?.ladderMode!=='ranked'||p.meta?.eventAuthority!=='official'||p.startedAt!==receipt.startedAt||q.startedAt!==receipt.startedAt||p.registrationRosterRevision!==id.rosterRevision||q.registrationRosterRevision!==id.rosterRevision||room.partnerQuotaDebit?.identityHash!==receipt.identityHash||room.partnerQuotaDebit?.snapshotDigest!==receipt.snapshotDigest||room.rdwSnapshotDigest!==receipt.snapshotDigest||p.rdwSnapshotDigest!==receipt.snapshotDigest||snapshot?.source!=='server'||snapshot?.verified!==true||snapshot?.sealed!==true||snapshot?.eventCode!==id.eventCode||snapshot?.drawRevision!==id.drawRevision||snapshot?.snapshotDigest!==receipt.snapshotDigest)fail('partner-start-receipt-not-committed');
 const uids=(p.players||[]).map(player=>player?.uid);
 if(receipt.rosterDigest!==hash(uids)||Object.keys(receipt).some(k=>room.partnerQuotaDebit[k]!==receipt[k])||!validateSealedSnapshot({snapshot,eventCode:id.eventCode,drawRevision:id.drawRevision,rosterUids:uids}).ok)fail('partner-start-receipt-not-committed');
 return {replayed:true,startedAt:receipt.startedAt,receipt};
}

// Runs before tier preflight, so a lost response can be recovered even if the
// original contract has since expired or a renewal replaced the current grant.
// This only reads a prior success; it grants no ongoing/new event permission.
async function readPartnerStartReplay(args){
 const refs=context(args),{tx}=args;if(typeof tx?.get!=='function')fail('partner-transaction-required');
 const r=await tx.get(refs.eventRef);if(!r.exists||!partnerRoom(r.data()))return null;
 const room=r.data(),receiptSnap=await tx.get(refs.receiptRef);if(!receiptSnap.exists)return null;
 const [actor,mirror,snapshot]=await Promise.all([tx.get(refs.actorRef),tx.get(refs.publicRef),tx.get(refs.snapshotRef)]);
 return checkReplay({room,receipt:receiptSnap.data(),actorProfile:actor.data(),publicDoc:mirror.data(),snapshot:snapshot.data(),args});
}

async function preparePartnerStartQuota(args){
 const {tx,privateDoc:room,privateState:p,publicDoc,snapshot,serverTime}=args;
 if(!partnerRoom(room))return null;
 const refs=context(args),id=identity(room,args);
 if(typeof tx?.get!=='function'||typeof tx?.create!=='function'||typeof tx?.update!=='function'||!Number.isSafeInteger(serverTime)||serverTime<=0)fail('partner-transaction-required');
 const [receiptSnap,actorSnap]=await Promise.all([tx.get(refs.receiptRef),tx.get(refs.actorRef)]);
 if(receiptSnap.exists)return checkReplay({room,publicDoc,snapshot,receipt:receiptSnap.data(),actorProfile:actorSnap.data(),args});
 // Existing creation-time contracts/rooms are NOT guessed to have zero usage.
 // They require a separately reviewed reconciliation proof before migration.
 if(room.partnerQuotaPolicy!==POLICY)fail('legacy-partner-quota-reconciliation-required');
 const contractRef=args.db.doc('partnerContracts/'+id.orderCode),ownerRef=args.db.doc('users/'+id.organizerUid);
 const [contractSnap,ownerSnap]=await Promise.all([tx.get(contractRef),tx.get(ownerRef)]);
 const contract=contractSnap.data(),owner=ownerSnap.data(),grant=owner?.partnerOrganizer;
 if(!actorMayRead(actorSnap.data(),args.actorUid,id.organizerUid)||!(args.actorUid===id.organizerUid||['admin','super_admin'].includes(actorSnap.data()?.role)))fail('partner-quota-actor-denied');
 if(!active(owner)||owner.role!=='player'||grant?.status!=='active'||grant.scope!=='contract'||grant.rankedMode!==true||grant.orderCode!==id.orderCode||owner.partnerContractOrderCode!==id.orderCode||grant.organizationId!==id.organizationCode)fail('partner-organizer-ineligible');
 if(!contractSnap.exists||contract?.quotaPolicy!==POLICY||contract.status!=='active'||contract.orderCode!==id.orderCode||contract.targetUid!==id.organizerUid||contract.organizationCode!==id.organizationCode||contract.signedBy!==id.organizerUid||!/^[a-f0-9]{64}$/.test(contract.signatureHash||'')||!/^[a-f0-9]{64}$/.test(contract.termsHash||'')||!Number.isSafeInteger(contract.termsVersion)||contract.termsVersion<1||typeof contract.paymentReference!=='string'||!contract.paymentReference.trim())fail('partner-contract-ineligible');
 const [start,end]=period(contract),[grantStart,grantEnd]=period(grant);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||start>serverTime||end<=serverTime||end<=start||grantStart!==start||grantEnd!==end)fail('partner-contract-period-invalid');
 if(!Number.isSafeInteger(contract.includedEvents)||contract.includedEvents<1||!Number.isSafeInteger(contract.usedEvents)||contract.usedEvents<0||contract.usedEvents>=contract.includedEvents)fail('partner-quota-unavailable');
 if(!p||room.eventAuthority!=='official'||p.meta?.ladderMode!=='ranked'||p.meta?.eventAuthority!=='official'||p.testMode===true||p.startedAt!=null||(p.createdBy&&p.createdBy!==id.organizerUid)||(p.cloudCode&&p.cloudCode!==id.eventCode)||p.registrationRosterRevision!==id.rosterRevision||!Array.isArray(p.players))fail('partner-ranked-roster-required');
 const uids=p.players.map(player=>player?.uid);
 if(!Number.isSafeInteger(contract.minParticipants)||contract.minParticipants<2||!Number.isSafeInteger(contract.maxParticipants)||contract.maxParticipants<contract.minParticipants||uids.length<contract.minParticipants||uids.length>contract.maxParticipants||uids.some(uid=>!validUid(uid))||new Set(uids).size!==uids.length||p.players.some(player=>player.isTestAccount===true||player.isVirtual===true||player.synthetic===true))fail('partner-participant-limits');
 if(!/^[a-f0-9]{64}$/.test(snapshot?.snapshotDigest||''))fail('partner-snapshot-required');
 const receipt=Object.freeze({...id,source:'server',verified:true,debit:1,identityHash:hash(id),startedAt:serverTime,startedBy:args.actorUid,snapshotDigest:snapshot.snapshotDigest,rosterDigest:hash(uids),participants:uids.length,termsHash:contract.termsHash,termsVersion:contract.termsVersion,usedBefore:contract.usedEvents,usedAfter:contract.usedEvents+1});
 let applied=false;
 return {replayed:false,receipt,apply(transaction){
  if(transaction!==tx||applied)fail('partner-quota-plan-already-used');
  applied=true;
  // No reads here. Caller stages snapshot + both start mirrors in this tx.
  tx.create(refs.receiptRef,receipt);
  tx.update(contractRef,{usedEvents:receipt.usedAfter,lastRoomCode:id.eventCode});
 }};
}
module.exports={POLICY,partnerRoom,readPartnerStartReplay,preparePartnerStartQuota};
