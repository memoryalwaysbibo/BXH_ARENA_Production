'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAuthorizers,canReview}=require('./permissions.cjs');
const room={eventAuthority:'official',ownerUid:'owner',createdBy:'owner',assignedStaffUids:['staff'],
 tournamentPhase:'waiting',data:JSON.stringify({meta:{},players:[],matches:[]}),registrationEnabled:true,
 visibility:'public',registrationVisibility:'public',publishedAt:1,registrationOpenAt:1,registrationCloseAt:100,cancellationDeadline:90};
const user={active:true,role:'player',realName:'A',phone:'123',profileCompleted:true};
test('normal room roles, ownership and staff assignments govern review',()=>{
 const ctx={room,now:50,user:{...user,role:'staff'},uid:'staff'};
 assert.equal(canReview(ctx),true);
 assert.equal(canReview({...ctx,uid:'unassigned'}),false);
 assert.equal(canReview({...ctx,uid:'owner'}),true);
 assert.equal(canReview({...ctx,user,uid:'owner'}),false);
 assert.equal(canReview({...ctx,user,uid:'owner',room:{...room,eventAuthority:'community'}}),true);
 assert.equal(canReview({...ctx,user:{...user,role:'super_admin'},uid:'other'}),true);
 assert.equal(canReview({...ctx,user:{...user,role:'super_admin',isTestAccount:true}}),false);
});
test('join respects identity, timing, visibility, profile and password grant',async()=>{
 let grant;
 const auth=createAuthorizers({db:{doc:x=>x}});
 const ctx={tx:{getAll:async()=>[{data:()=>grant}]},uid:'player',registrationId:'player',user,room,now:50,code:'BXH-ABC123'};
 assert.equal(await auth.authorizeJoin(ctx),true);
 assert.equal(await auth.authorizeJoin({...ctx,registrationId:'other'}),false);
 assert.equal(await auth.authorizeJoin({...ctx,now:100}),false);
 assert.equal(await auth.authorizeJoin({...ctx,room:{...room,visibility:'private'}}),false);
 assert.equal(await auth.authorizeJoin({...ctx,user:{...user,profileCompleted:false}}),false);
 const locked={...ctx,room:{...room,roomAccessMode:'password',roomAccessVersion:2}};
 assert.equal(await auth.authorizeJoin(locked),false);
 grant={accessVersion:2,expiresAt:80};
 assert.equal(await auth.authorizeJoin(locked),true);
});
test('self cancellation follows deadline; assigned staff can administer other players',()=>{
 const {authorizeCancel}=createAuthorizers({});
 const ctx={room,user,uid:'player',registrationId:'player',now:50};
 assert.equal(authorizeCancel(ctx),true);
 assert.equal(authorizeCancel({...ctx,now:90}),false);
 assert.equal(authorizeCancel({...ctx,registrationId:'another'}),false);
 assert.equal(authorizeCancel({...ctx,uid:'staff',registrationId:'another',user:{...user,role:'staff'}}),true);
});
