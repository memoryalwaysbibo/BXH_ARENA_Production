'use strict';
const admin=require('firebase-admin/firestore');
const {guardFirestore}=require('./guard-firestore.cjs');
module.exports={...admin,getFirestore:(...args)=>guardFirestore(admin.getFirestore(...args))};
