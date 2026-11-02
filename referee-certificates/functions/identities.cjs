'use strict';
const D=require('./domain.cjs');
// Exact, owner-confirmed account link. Never merge evidence across these UIDs automatically.
const OWNER='dFNwrNCZKASxabKsOCcQoMJkryA2';
const ALIAS='nDBFtNYOgjfkBK0E2lpUoreJYwM2';
const INITIAL=require('./initial-preview.json');
function requiredPersonId(uid) {const i=INITIAL.people.find(p=>p.uid===uid);return i?.personId||null;}
function validatePrimary(uid,personId) {
  if(uid===ALIAS)D.fail('failed-precondition','known-alias-cannot-receive-certificate');
  const required=requiredPersonId(uid);
  if(required&&required!==personId)D.fail('failed-precondition','initial-person-identity-mismatch');
}
function checkSequence(uid,last,approved){
  const candidate=INITIAL.people.find(p=>p.uid===uid);
  if(last<18){
    if(approved!==true)D.fail('failed-precondition','initialization-preview-only');
    if(!candidate||candidate.order!==last+1)D.fail('failed-precondition','initial-sequence-not-ready');
  }else if(candidate)D.fail('failed-precondition','initial-certificate-missing-requires-reconciliation');
}
module.exports={checkSequence,OWNER,ALIAS,requiredPersonId,validatePrimary};
