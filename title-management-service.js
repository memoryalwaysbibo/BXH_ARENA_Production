/**
 * BXH ARENA Title Management Service v1
 *
 * Single management path for admin UI and assisted maintenance.
 * Existing hard-coded title artwork remains a compatibility fallback.
 */
(function(){
  'use strict';

  const COLLECTION='titleCatalog';
  const AUDIT_COLLECTION='adminAuditLogs';
  const STORAGE_ROOT='managed/titles';

  function db(){
    if(!window.firebase||!firebase.firestore) throw new Error('Firestore unavailable');
    return firebase.firestore();
  }
  function storage(){
    if(!window.firebase||!firebase.storage) throw new Error('Firebase Storage unavailable');
    return firebase.storage();
  }
  function actor(){
    const u=firebase.auth&&firebase.auth().currentUser;
    return {uid:u&&u.uid||'',email:u&&u.email||''};
  }
  function cleanId(v){
    return String(v||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
  }
  function normalize(input){
    const x=input||{};
    const id=cleanId(x.id||x.slug||x.name);
    if(!id) throw new Error('稱號 ID 不可為空');
    if(!String(x.name||'').trim()) throw new Error('稱號名稱不可為空');
    return {
      id,
      name:String(x.name).trim(),
      description:String(x.description||'').trim(),
      unlockText:String(x.unlockText||'').trim(),
      rarity:String(x.rarity||'common').trim().toLowerCase(),
      category:String(x.category||'general').trim().toLowerCase(),
      grantMode:String(x.grantMode||'manual').trim().toLowerCase(),
      unique:Boolean(x.unique),
      enabled:x.enabled!==false,
      sortOrder:Number.isFinite(Number(x.sortOrder))?Number(x.sortOrder):0,
      imagePath:String(x.imagePath||'').trim(),
      imageUrl:String(x.imageUrl||'').trim()
    };
  }
  async function audit(action,id,before,after){
    const a=actor();
    return db().collection(AUDIT_COLLECTION).add({
      module:'titles',action,titleId:id,actorUid:a.uid,actorEmail:a.email,
      before:before||null,after:after||null,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  async function get(id){
    const s=await db().collection(COLLECTION).doc(cleanId(id)).get();
    return s.exists?Object.assign({id:s.id},s.data()):null;
  }
  async function list(options){
    let q=db().collection(COLLECTION);
    if(options&&options.enabledOnly) q=q.where('enabled','==',true);
    const s=await q.get();
    return s.docs.map(d=>Object.assign({id:d.id},d.data())).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)||String(a.name).localeCompare(String(b.name),'zh-Hant'));
  }
  async function save(input){
    const data=normalize(input);
    const ref=db().collection(COLLECTION).doc(data.id);
    const snap=await ref.get();
    const before=snap.exists?snap.data():null;
    const now=firebase.firestore.FieldValue.serverTimestamp();
    const payload=Object.assign({},data,{
      updatedAt:now,updatedBy:actor().uid,
      schemaVersion:1
    });
    delete payload.id;
    if(!snap.exists){payload.createdAt=now;payload.createdBy=actor().uid;}
    await ref.set(payload,{merge:true});
    await audit(snap.exists?'update':'create',data.id,before,payload);
    return Object.assign({id:data.id},payload);
  }
  async function setEnabled(id,enabled){
    const ref=db().collection(COLLECTION).doc(cleanId(id));
    const snap=await ref.get();
    if(!snap.exists) throw new Error('找不到稱號');
    const before=snap.data();
    const patch={enabled:Boolean(enabled),updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:actor().uid};
    await ref.set(patch,{merge:true});
    await audit(enabled?'enable':'disable',ref.id,before,Object.assign({},before,patch));
  }
  async function uploadImage(id,file){
    if(!file) throw new Error('請選擇圖片');
    if(!/^image\//.test(file.type||'')) throw new Error('檔案必須是圖片');
    if(file.size>8*1024*1024) throw new Error('圖片不可超過 8MB');
    const titleId=cleanId(id);
    if(!titleId) throw new Error('請先設定稱號 ID');
    const ext=((file.name||'').split('.').pop()||'webp').toLowerCase().replace(/[^a-z0-9]/g,'')||'webp';
    const path=STORAGE_ROOT+'/'+titleId+'/icon.'+ext;
    const ref=storage().ref().child(path);
    await ref.put(file,{contentType:file.type||undefined,customMetadata:{module:'titles',titleId}});
    const url=await ref.getDownloadURL();
    return {imagePath:path,imageUrl:url};
  }
  async function resolveArtwork(title){
    if(!title) return '';
    if(title.imageUrl) return title.imageUrl;
    if(title.imagePath){
      try{return await storage().ref().child(title.imagePath).getDownloadURL();}catch(_){}
    }
    return '';
  }

  window.BXHTitleManagement={
    version:1,COLLECTION,AUDIT_COLLECTION,STORAGE_ROOT,
    normalize,get,list,save,setEnabled,uploadImage,resolveArtwork
  };
})();
