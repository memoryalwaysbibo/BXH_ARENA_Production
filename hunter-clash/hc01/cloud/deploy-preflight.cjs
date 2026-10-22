'use strict';
function assertDeployment(env){
  if(env.GCLOUD_PROJECT!=='bxh-hc-test'||(env.GOOGLE_CLOUD_PROJECT&&env.GOOGLE_CLOUD_PROJECT!=='bxh-hc-test')||env.FIRESTORE_EMULATOR_HOST||env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('hc01-cloud-test-project-only');
  return 'bxh-hc-test';
}
if(require.main===module){assertDeployment(process.env);process.stdout.write('PASS HC01 isolated cloud test project\n');}
module.exports={assertDeployment};
