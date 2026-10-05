
  // ▼▼▼ 請將您在 Firebase Console 取得的設定值貼在這裡 ▼▼▼
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBdJhRYtsEKteWRTvjVmz01zP82H4AjmBM",
    authDomain: "bxh-arena.firebaseapp.com",
    projectId: "bxh-arena",
    storageBucket: "bxh-arena.firebasestorage.app",
    messagingSenderId: "87261141693",
    appId: "1:87261141693:web:acfaff5d0d53879e5335d4",
    measurementId: "G-4SX451ETV5"
  };
  // ▲▲▲ 貼上設定值後存檔即可，不需要修改下面的程式碼 ▲▲▲

  const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 排除易混淆字元 O 0 I 1 L
  const ROOM_CODE_LENGTH = 6;
  const ROOM_CODE_PREFIX = "BXH-";
  const FIREBASE_SDK_VERSION = "10.13.0";
  const ENGAGEMENT_CALL_TIMEOUT_MS = 30000;
  const ENGAGEMENT_BACKFILL_TIMEOUT_MS = 120000;

  let cloudEnabled = false;
  let dbHandle = null;
  let fx = null; // firestore function references
  let initPromise = null;

  function isConfigPresent(){
    return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId === "bxh-arena");
  }

  let authHandle = null;
  let ax = null; // firebase-auth function references
  let authReady = false;
  let functionsHandle = null;
  let fnx = null;

  // Races a promise against a timeout. Never throws for the timeout case —
  // resolves to `fallbackValue` instead, so callers can treat "timed out" and
  // "resolved with a value" uniformly without needing a separate catch path
  // for the timeout branch specifically.
  function withTimeout(promise, ms, fallbackValue){
    return new Promise((resolve)=>{
      let settled = false;
      const timer = setTimeout(()=>{ if(!settled){ settled = true; resolve(fallbackValue); } }, ms);
      promise.then((v)=>{ if(!settled){ settled = true; clearTimeout(timer); resolve(v); } },
                   ()=>{ if(!settled){ settled = true; clearTimeout(timer); resolve(fallbackValue); } });
    });
  }

  async function tryInitFirebase(){
    if(initPromise) return initPromise;
    initPromise = (async ()=>{
      if(!isConfigPresent()){
        cloudEnabled = false;
        return false;
      }
      try{
        const appMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`);
        const fsMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`);
        const authMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`);
        const app = appMod.initializeApp(FIREBASE_CONFIG);
        dbHandle = fsMod.getFirestore(app);
        // Functions 是附加服務；載入失敗時不可拖垮既有 Auth／Firestore。
        try{
          const functionsMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-functions.js`);
          functionsHandle = functionsMod.getFunctions(app,"asia-east1");
          fnx = { httpsCallable:functionsMod.httpsCallable };
        }catch(functionsError){
          console.warn("BXH ARENA：稱號／簽到服務未載入，核心賽事功能維持可用",functionsError);
          functionsHandle=null; fnx=null;
        }
        fx = {
          doc: fsMod.doc, setDoc: fsMod.setDoc, getDoc: fsMod.getDoc, getDocFromServer: fsMod.getDocFromServer, deleteDoc: fsMod.deleteDoc,
          onSnapshot: fsMod.onSnapshot, serverTimestamp: fsMod.serverTimestamp,
          collection: fsMod.collection, query: fsMod.query, where: fsMod.where, getDocs: fsMod.getDocs, updateDoc: fsMod.updateDoc,
          runTransaction: fsMod.runTransaction, writeBatch: fsMod.writeBatch, deleteField: fsMod.deleteField,
          increment: fsMod.increment, collectionGroup: fsMod.collectionGroup, orderBy: fsMod.orderBy, limit: fsMod.limit
        };
        // Select durable storage at initialization; avoid racing persistence migrations.
        authHandle = authMod.initializeAuth(app, {
          persistence: [authMod.browserLocalPersistence, authMod.browserSessionPersistence]
        });
        ax = {
          onAuthStateChanged: authMod.onAuthStateChanged,
          signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
          createUserWithEmailAndPassword: authMod.createUserWithEmailAndPassword,
          signOut: authMod.signOut,
          sendPasswordResetEmail: authMod.sendPasswordResetEmail,
          updatePassword: authMod.updatePassword,
          reauthenticateWithCredential: authMod.reauthenticateWithCredential,
          EmailAuthProvider: authMod.EmailAuthProvider,
          GoogleAuthProvider: authMod.GoogleAuthProvider,
          linkWithPopup: authMod.linkWithPopup,
          linkWithRedirect: authMod.linkWithRedirect,
          getRedirectResult: authMod.getRedirectResult,
          signInWithPopup: authMod.signInWithPopup,
          unlink: authMod.unlink,
          browserPopupRedirectResolver: authMod.browserPopupRedirectResolver
        };
        authReady = true;
        cloudEnabled = true;
        // A redirect fallback returns here in a fresh page load. Consume and
        // validate its credential before the app's auth-state listener routes
        // the user, then pass a one-shot result to the UI for feedback.
        let redirectContext = null;
        try{
          const raw = sessionStorage.getItem(GOOGLE_LINK_REDIRECT_SESSION_KEY);
          if(raw) redirectContext = JSON.parse(raw);
        }catch(e){}
        if(redirectContext){
          try{
            const result = await ax.getRedirectResult(authHandle, ax.browserPopupRedirectResolver);
            const linked = result?.user;
            if(!linked){
              pendingGoogleLinkRedirectOutcome = {ok:false,error:"沒有取得 Google 綁定結果，請重新嘗試。"};
            }else if(linked.uid !== redirectContext.uid){
              pendingGoogleLinkRedirectOutcome = {ok:false,error:"登入帳號已變更，未完成 Google 綁定。"};
            }else{
              const snap = await withTimeout(fx.getDoc(fx.doc(dbHandle, USERS_COLLECTION, linked.uid)),7000,null);
              const profile = snap?.exists() ? snap.data() : null;
              const oldEmail = String(redirectContext.email||"").trim().toLowerCase();
              const profileEmail = String(profile?.email||"").trim().toLowerCase();
              const googleEmail = String(linked.providerData.find(p=>p.providerId==="google.com")?.email||"").trim().toLowerCase();
              const eligible = profile?.active===true && profile?.isTestAccount!==true;
              if(!eligible || profileEmail!==oldEmail || googleEmail!==oldEmail){
                try{
                  if(linked.providerData.some(p=>p.providerId==="google.com")) await ax.unlink(linked,"google.com");
                  pendingGoogleLinkRedirectOutcome = {ok:false,error:"帳號資格或 Google 信箱未通過核對，已取消連結。"};
                }catch(unlinkError){
                  pendingGoogleLinkRedirectOutcome = {ok:false,error:"綁定核對失敗且無法解除連結，請聯絡管理員檢查帳號。"};
                }
              }else{
                pendingGoogleLinkRedirectOutcome = {ok:true};
              }
            }
          }catch(e){
            pendingGoogleLinkRedirectOutcome = {ok:false,error:"Google 綁定失敗："+String(e?.code||"請稍後重試")};
          }finally{
            try{sessionStorage.removeItem(GOOGLE_LINK_REDIRECT_SESSION_KEY);}catch(e){}
          }
        }
        return true;
      }catch(e){
        console.warn("BXH ARENA 雲端同步：Firebase 初始化失敗，自動退回僅本機模式。", e);
        cloudEnabled = false;
        return false;
      }
    })();
    return initPromise;
  }

  function friendlyAuthError(e){
    const code = (e && e.code) || "";
    if(code==="auth/invalid-email") return "電子郵件格式不正確";
    if(code==="auth/user-not-found" || code==="auth/wrong-password" || code==="auth/invalid-credential") return "帳號或密碼錯誤";
    if(code==="auth/too-many-requests") return "嘗試次數過多，請稍後再試";
    if(code==="auth/email-already-in-use") return "此電子郵件已被使用";
    if(code==="auth/weak-password") return "密碼強度不足";
    if(code==="auth/network-request-failed") return "網路連線失敗，請確認網路狀態";
    if(code==="auth/user-disabled") return "此帳號已被停用，請聯絡系統管理員";
    return (code ? code+"：" : "") + ((e && e.message) || "發生未知錯誤");
  }

  const USERS_COLLECTION = "users";
  const BOOTSTRAP_DOC_PATH = ["system","bootstrap"];
  const GOOGLE_LINK_PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;
  const googleLinkProfileCache = new Map();
  const GOOGLE_LINK_REDIRECT_SESSION_KEY = "bxh_google_link_redirect_v1";
  let pendingGoogleLinkRedirectOutcome = null;

  window.cloudAuth = {
    isReady(){ return authReady; },
    // Direct, synchronous read of Firebase's own current-user state — used as
    // a manual recovery check if onAuthStateChanged's event itself never
    // fires after a successful sign-in (an observed possibility in some
    // restricted mobile WebViews). Returns {uid, email} or null; never throws.
    getCurrentUser(){
      try{
        const u = authHandle && authHandle.currentUser;
        return u ? { uid: u.uid, email: u.email, providers:(u.providerData||[]).map(p=>p.providerId) } : null;
      }catch(e){ return null; }
    },

    async linkMyGoogleAccount(){
      if(!authReady || !authHandle?.currentUser) return {ok:false,error:"請先使用原本的 ARENA 帳密登入。"};
      const user=authHandle.currentUser,uid=user.uid,oldEmail=String(user.email||"").trim().toLowerCase();
      if(!oldEmail) return {ok:false,error:"原帳號缺少登入信箱，請聯絡管理員。"};
      // The profile is fetched while the signed-in profile is loaded, before
      // the user taps this button. Do not wait on Firestore here: mobile browsers
      // can block Firebase's popup after transient user activation expires.
      const profileEntry=googleLinkProfileCache.get(uid);
      if(!profileEntry || Date.now()-profileEntry.loadedAt>GOOGLE_LINK_PROFILE_CACHE_TTL_MS)return {ok:false,error:"帳號資料已逾時，請重新開啟「我的資料」後再試。"};
      const profile=profileEntry.profile;
      const profileEmail=String(profile?.email||"").trim().toLowerCase();
      if(profile?.active!==true||profile?.isTestAccount===true)return {ok:false,error:"此帳號目前不符合 Google 綁定資格。"};
      if(profileEmail!==oldEmail)return {ok:false,error:"登入信箱與會員資料不一致，請先核對。"};
      if(user.providerData.some(p=>p.providerId==="google.com"))return {ok:true,uid};
      try{
        const provider=new ax.GoogleAuthProvider();
        provider.setCustomParameters({login_hint:oldEmail,prompt:"select_account"});
        // Start the popup synchronously in the original button-click stack.
        const popupPromise=ax.linkWithPopup(user,provider,ax.browserPopupRedirectResolver);
        let result;
        try{
          result=await popupPromise;
        }catch(popupError){
          if(popupError?.code!=="auth/popup-blocked" && popupError?.code!=="auth/operation-not-supported-in-this-environment") throw popupError;
          try{
            sessionStorage.setItem(GOOGLE_LINK_REDIRECT_SESSION_KEY,JSON.stringify({uid,email:oldEmail}));
            await ax.linkWithRedirect(user,provider,ax.browserPopupRedirectResolver);
            return {ok:true,redirecting:true};
          }catch(redirectError){
            try{sessionStorage.removeItem(GOOGLE_LINK_REDIRECT_SESSION_KEY);}catch(e){}
            return {ok:false,error:"此瀏覽器無法開啟 Google 綁定，請改用 Safari 或 Chrome 重試。"};
          }
        }
        const linked=result.user;
        if(linked.uid!==uid)throw Error("uid-changed");
        const freshProfile=await this.getUserProfile(uid);
        const freshEmail=String(freshProfile?.email||"").trim().toLowerCase();
        if(freshProfile?.active!==true||freshProfile?.isTestAccount===true||freshEmail!==oldEmail){
          try{await ax.unlink(linked,"google.com");}
          catch(unlinkError){return {ok:false,error:"帳號資格重新核對失敗，解除連結也失敗。請停止操作並由管理員檢查帳號。"};}
          return {ok:false,error:"帳號資格已變更或無法確認，已取消 Google 連結。"};
        }
        const googleEmail=String(linked.providerData.find(p=>p.providerId==="google.com")?.email||"").trim().toLowerCase();
        if(googleEmail!==oldEmail){
          // A chosen Google account can differ from login_hint. Keep the original
          // password account intact; email correction is a separate verified flow.
          try{await ax.unlink(linked,"google.com");}
          catch(unlinkError){return {ok:false,error:"選取的 Google 帳號不同，解除連結失敗。請停止操作並由管理員檢查帳號。"};}
          return {ok:false,error:"選取的 Google 信箱與 ARENA 登入信箱不同，已取消連結。誤填信箱需另行核對修正。"};
        }
        return {ok:true,uid};
      }catch(e){
        if(e?.code==="auth/popup-closed-by-user"||e?.code==="auth/cancelled-popup-request")return {ok:false,error:"已取消 Google 帳號選擇。"};
        if(e?.code==="auth/credential-already-in-use"||e?.code==="auth/email-already-in-use")return {ok:false,error:"這個 Google 帳號已連到其他 ARENA 帳號，請聯絡管理員。"};
        if(e?.code==="auth/requires-recent-login")return {ok:false,error:"請登出後用原帳密重新登入，再連結 Google。"};
        return {ok:false,error:"Google 連結失敗："+String(e?.code||e?.message||"請稍後重試")};
      }
    },

    async signInWithLinkedGoogle(){
      if(!authReady)return {ok:false,error:"雲端服務尚未連線。"};
      try{
        const provider=new ax.GoogleAuthProvider();
        provider.setCustomParameters({prompt:"select_account"});
        const result=await ax.signInWithPopup(authHandle,provider,ax.browserPopupRedirectResolver);
        if(!result.user.providerData.some(p=>p.providerId==="google.com"))throw Error("google-provider-missing");
        return {ok:true,uid:result.user.uid};
      }catch(e){
        if(e?.code==="auth/popup-closed-by-user"||e?.code==="auth/cancelled-popup-request")return {ok:false,error:"已取消 Google 登入。"};
        if(e?.code==="auth/permission-denied"||e?.code==="auth/internal-error")return {ok:false,error:"此 Google 帳號尚未綁定 ARENA；請先用原帳密登入並完成綁定。"};
        if(e?.code==="auth/account-exists-with-different-credential")return {ok:false,error:"請先以原帳密登入，並在我的資料綁定 Google 帳號。"};
        return {ok:false,error:"Google 登入失敗："+String(e?.code||"請稍後再試")};
      }
    },

    async hasSuperAdmin(){
      if(!authReady) return null; // unknown, caller should treat conservatively
      try{
        const snap = await fx.getDoc(fx.doc(dbHandle, BOOTSTRAP_DOC_PATH[0], BOOTSTRAP_DOC_PATH[1]));
        return !!(snap.exists() && snap.data().superAdminExists===true);
      }catch(e){
        console.warn("檢查最高管理員狀態失敗", e);
        return null;
      }
    },

    async createSuperAdmin({ email, password, displayName }){
      if(!authReady) return { ok:false, error:"雲端服務尚未就緒" };
      try{
        const cred = await ax.createUserWithEmailAndPassword(authHandle, email, password);
        const uid = cred.user.uid;
        const now = Date.now();
        await fx.setDoc(fx.doc(dbHandle, USERS_COLLECTION, uid), {
          displayName: displayName||email, email, role:"super_admin", active:true,
          createdAt: now, lastLoginAt: now
        });
        await fx.setDoc(fx.doc(dbHandle, BOOTSTRAP_DOC_PATH[0], BOOTSTRAP_DOC_PATH[1]), { superAdminExists:true });
        return { ok:true, uid };
      }catch(e){
        return { ok:false, error: friendlyAuthError(e) };
      }
    },

    async signIn(email, password){
      if(!authReady) return { ok:false, error:"雲端服務尚未就緒" };
      try{
        const cred = await ax.signInWithEmailAndPassword(authHandle, email, password);
        return { ok:true, uid: cred.user.uid };
      }catch(e){
        return { ok:false, error: friendlyAuthError(e), code:(e&&e.code)||"auth/unknown" };
      }
    },

    async signOutUser(){
      try{sessionStorage.removeItem("bxh_prod_auth_view_v1");}catch(e){}
      if(!authReady) return;
      const signedInUid=String((authHandle&&authHandle.currentUser&&authHandle.currentUser.uid)||"");
      if(signedInUid){
        const pushKey="bxh.call.push.token:"+signedInUid;
        let pushToken="";
        try{pushToken=String(localStorage.getItem(pushKey)||"");}catch(e){}
        if(pushToken&&functionsHandle&&fnx&&typeof fnx.httpsCallable==="function"){
          try{
            const unregister=fnx.httpsCallable(functionsHandle,"courtCallPushService",{timeout:5000});
            await withTimeout(unregister({action:"unregister",token:pushToken}),2500,null);
          }catch(e){
            console.warn("[BXH CALL push] logout unregister unavailable");
          }
        }
        try{localStorage.removeItem(pushKey);}catch(e){}
      }
      try{ await ax.signOut(authHandle); }catch(e){}
      googleLinkProfileCache.clear();
    },

    onAuthChange(callback){
      if(!authReady) return ()=>{};
      return ax.onAuthStateChanged(authHandle, user=>{
        const redirectOutcome=pendingGoogleLinkRedirectOutcome;
        pendingGoogleLinkRedirectOutcome=null;
        callback(user,redirectOutcome);
      });
    },

    async getUserProfile(uid){
      if(!authReady || !uid) return null;
      try{
        const snap = await fx.getDoc(fx.doc(dbHandle, USERS_COLLECTION, uid));
        const profile=snap.exists() ? snap.data() : null;
        if(profile)googleLinkProfileCache.set(uid,{profile,loadedAt:Date.now()});
        else googleLinkProfileCache.delete(uid);
        return profile;
      }catch(e){
        googleLinkProfileCache.delete(uid);
        console.warn("讀取使用者資料失敗", e);
        return null;
      }
    },

    async saveInterfaceTheme(uid,theme){
      if(!authReady || !uid || authHandle.currentUser?.uid!==uid) return {ok:false};
      if(!BXH_INTERFACE_THEME_OPTIONS.some(item=>item.id===theme)) return {ok:false};
      try{
        await fx.updateDoc(fx.doc(dbHandle,USERS_COLLECTION,uid),{interfaceTheme:theme});
        return {ok:true};
      }catch(e){
        console.warn("儲存帳號介面主題失敗",e);
        return {ok:false};
      }
    },

    async touchLastLogin(uid){
      if(!authReady || !uid) return;
      try{ await fx.updateDoc(fx.doc(dbHandle, USERS_COLLECTION, uid), { lastLoginAt: Date.now() }); }catch(e){}
    },

    // Uses a SEPARATE, temporary Firebase app instance to create the new Auth
    // account. This avoids a real Firebase SDK behavior: calling
    // createUserWithEmailAndPassword on the PRIMARY app instance automatically
    // signs the client in AS the newly created user, silently replacing the
    // calling admin's own session — which would also make the following
    // Firestore write happen under the NEW user's identity, not the admin's,
    // tripping the (correctly) stricter users/{uid} create rule. Using a
    // disposable secondary app keeps the admin's own session on `authHandle`
    // completely untouched throughout.
    async createManagedUser({ email, password, displayName, role }){
      if(!authReady) return { ok:false, error:"雲端服務尚未就緒" };
      let secondaryApp = null;
      try{
        const appMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`);
        const authMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`);
        secondaryApp = appMod.initializeApp(FIREBASE_CONFIG, "bxh-managed-user-creation-"+Date.now());
        const secondaryAuth = authMod.getAuth(secondaryApp);
        const cred = await authMod.createUserWithEmailAndPassword(secondaryAuth, email, password);
        const uid = cred.user.uid;
        try{ await authMod.signOut(secondaryAuth); }catch(e){}
        try{ await appMod.deleteApp(secondaryApp); }catch(e){}
        secondaryApp = null;
        const now = Date.now();
        // Happens under the CALLING admin's own (untouched) session, so this
        // satisfies the isAdminOrAbove() branch of the create rule, not the
        // self-creation branch.
        await fx.setDoc(fx.doc(dbHandle, USERS_COLLECTION, uid), {
          displayName: displayName||email, email, role: role||"staff", active:true,
          createdAt: now, lastLoginAt: null
        });
        return { ok:true, uid };
      }catch(e){
        if(secondaryApp){
          try{
            const appMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`);
            await appMod.deleteApp(secondaryApp);
          }catch(e2){}
        }
        return { ok:false, error: friendlyAuthError(e) };
      }
    },

    // Player self-service Email/Password application. Role is ALWAYS hardcoded
    // to 'player' here — this endpoint can never be used to create staff/admin
    // accounts, regardless of what the caller passes in.
    async applyPlayerAccount({ email, password, realName, nickname, phone }){
      if(!authReady) return { ok:false, error:"雲端服務尚未就緒" };
      try{
        const cred = await ax.createUserWithEmailAndPassword(authHandle, email, password);
        const uid = cred.user.uid;
        const now = Date.now();
        const publicName = nickname || realName;
        await fx.setDoc(fx.doc(dbHandle, USERS_COLLECTION, uid), {
          uid, email, displayName: publicName, realName, nickname: nickname||"", gameId:nickname||"",
          phone: phone||"", phoneVerified:false, birthDate:"", gender:"", region:"", preferredNameMode:"realName",
          realNameVerified:false, realNameVerifiedAt:null, realNameVerifiedBy:null,
          role: "player", active: true, provider: "password", profileCompleted: true, profileCompletedAt:fx.serverTimestamp(), avatarUrl:null,
          createdAt: now, updatedAt: now, lastLoginAt: now
        });
        // Public-safe mirror only — never includes email/phone/role/points.
        try{
          await fx.setDoc(fx.doc(dbHandle, "publicPlayers", uid), {
            publicName, avatarUrl: null, updatedAt: now
          });
        }catch(e){ console.warn("建立公開玩家資料失敗", e); }
        return { ok:true, uid };
      }catch(e){
        return { ok:false, error: friendlyAuthError(e) };
      }
    },

    // Repairs/completes a player profile when Firebase Auth is valid but the
    // users/{uid} document is missing. Production self-service accounts are
    // always created as role=player with password provider.
    async completeNewPlayerProfile(uid, { email, realName, nickname, phone }){
      if(!authReady) return { ok:false, error:"雲端服務尚未就緒" };
      try{
        const now = Date.now();
        const publicName = nickname || realName;
        await fx.setDoc(fx.doc(dbHandle, USERS_COLLECTION, uid), {
          uid, email, displayName: publicName, realName, nickname: nickname||"", gameId:nickname||"",
          phone: phone||"", phoneVerified:false, birthDate:"", gender:"", region:"", preferredNameMode:"realName",
          realNameVerified:false, realNameVerifiedAt:null, realNameVerifiedBy:null,
          role: "player", active: true, provider: "password", profileCompleted: true, profileCompletedAt:fx.serverTimestamp(), avatarUrl:null,
          createdAt: now, updatedAt: now, lastLoginAt: now
        });
        try{
          await fx.setDoc(fx.doc(dbHandle, "publicPlayers", uid), {
            publicName, avatarUrl: null, updatedAt: now
          });
        }catch(e){ console.warn("建立公開玩家資料失敗", e); }
        return { ok:true };
      }catch(e){
        return { ok:false, error: friendlyAuthError(e) };
      }
    },

    // For an EXISTING super_admin/admin/staff account entering player mode for
    // the first time. Unlike completeNewPlayerProfile(), this NEVER touches role
    // or creates a new document — it only fills in the player-facing fields
    // that are missing on the SAME users/{uid} doc, via updateDoc (which the
    // Security Rules' self-update whitelist branch permits regardless of the
    // account's role). The account's uid, email, and role are all untouched.
    async completeExistingAccountPlayerProfile(uid, { realName, nickname, phone }){
      if(!authReady) return { ok:false, error:"雲端服務尚未就緒" };
      try{
        const now = Date.now();
        const publicName = nickname || realName;
        await fx.updateDoc(fx.doc(dbHandle, USERS_COLLECTION, uid), {
          realName, nickname: nickname||"", gameId:nickname||"", phone: phone||"", birthDate:"", gender:"", region:"", preferredNameMode:"realName",
          realNameVerified:false, realNameVerifiedAt:null, realNameVerifiedBy:null, profileCompleted:true, profileCompletedAt:fx.serverTimestamp(), updatedAt: now
        });
        try{
          await fx.setDoc(fx.doc(dbHandle, "publicPlayers", uid), {
            publicName, avatarUrl: null, updatedAt: now
          }, { merge:true });
        }catch(e){ console.warn("建立公開玩家資料失敗", e); }
        return { ok:true };
      }catch(e){
        return { ok:false, error: friendlyAuthError(e) };
      }
    },

    async updateMyPlayerProfile(uid, data){
      if(!authReady || !uid || !authHandle.currentUser || authHandle.currentUser.uid!==uid) return {ok:false,error:"登入狀態失效"};
      try{
        const ref=fx.doc(dbHandle,USERS_COLLECTION,uid);
        const snap=await fx.getDoc(ref);
        if(!snap.exists()) return {ok:false,error:"找不到會員資料"};
        const old=snap.data()||{};
        const realName=String(data.realName||"").trim();
        const gameId=String(data.gameId||"").trim();
        const now=Date.now();
        const payload={
          realName,
          gameId,
          nickname:gameId,
          displayName:gameId||realName,
          phone:String(data.phone||"").trim(),
          birthDate:String(data.birthDate||"").trim(),
          gender:["female","male","other"].includes(data.gender)?data.gender:"",
          region:String(data.region||"").trim(),
          preferredNameMode:data.preferredNameMode==="gameId"?"gameId":"realName",
          profileCompleted:!!realName,
          updatedAt:now
        };
        if(realName && !old.profileCompletedAt) payload.profileCompletedAt=fx.serverTimestamp();
        if(String(old.realName||"").trim()!==realName){
          payload.realNameVerified=false;
          payload.realNameVerifiedAt=null;
          payload.realNameVerifiedBy=null;
        }
        await fx.updateDoc(ref,payload);
        await fx.setDoc(fx.doc(dbHandle,"publicPlayers",uid),{
          publicName:gameId||realName,
          avatarUrl:old.avatarUrl||null,
          updatedAt:now
        },{merge:true});
        return {ok:true,profile:Object.assign({},old,payload)};
      }catch(e){
        console.warn("更新會員資料失敗",e);
        return {ok:false,error:friendlyAuthError(e)};
      }
    },

    async verifyPlayerRealName(uid){
      if(!authReady || !uid) return {ok:false};
      try{
        const verifier=(authHandle&&authHandle.currentUser&&authHandle.currentUser.uid)||null;
        if(!verifier) return {ok:false};
        await fx.updateDoc(fx.doc(dbHandle,USERS_COLLECTION,uid),{
          realNameVerified:true,
          realNameVerifiedAt:Date.now(),
          realNameVerifiedBy:verifier,
          updatedAt:Date.now()
        });
        return {ok:true};
      }catch(e){
        console.warn("確認玩家本名失敗",e);
        return {ok:false,error:friendlyAuthError(e)};
      }
    },

    async updatePlayerAvatar(uid, avatarUrl){
      if(!authReady || !uid || typeof avatarUrl!=="string") return { ok:false, error:"invalid-avatar" };
      try{
        const now=Date.now();
        await fx.updateDoc(fx.doc(dbHandle, USERS_COLLECTION, uid), {
          avatarUrl, updatedAt:now
        });
        await fx.setDoc(fx.doc(dbHandle, "publicPlayers", uid), {
          publicName:(userProfile && (userProfile.displayName||userProfile.nickname||userProfile.realName)) || "",
          avatarUrl,
          updatedAt:now
        }, { merge:true });
        return { ok:true };
      }catch(e){
        console.warn("更新玩家頭像失敗",e);
        return { ok:false, error:friendlyAuthError(e) };
      }
    },

    // Checks whether publicPlayers/{uid} already exists; if not, creates it
    // with ONLY safe public fields. Safe to call on every player-mode entry —
    // a no-op once the document exists.
    async ensurePublicPlayerDoc(uid, { publicName, avatarUrl }){
      if(!authReady) return { ok:false };
      try{
        const ref = fx.doc(dbHandle, "publicPlayers", uid);
        const snap = await fx.getDoc(ref);
        if(snap.exists()) return { ok:true, created:false };
        await fx.setDoc(ref, { publicName: publicName||"", avatarUrl: avatarUrl||null, updatedAt: Date.now() });
        return { ok:true, created:true };
      }catch(e){
        console.warn("檢查/建立公開玩家資料失敗", e);
        return { ok:false, error: friendlyAuthError(e) };
      }
    },

    async ensureMyStaffDirectory(){
      if(!authReady || !authHandle.currentUser) return {ok:false};
      const uid=authHandle.currentUser.uid;
      try{
        const us=await fx.getDoc(fx.doc(dbHandle,USERS_COLLECTION,uid));
        if(!us.exists()) return {ok:false};
        const u=us.data()||{};
        if(!["staff","admin","super_admin","tester"].includes(u.role)||u.active===false) return {ok:false};
        await fx.setDoc(fx.doc(dbHandle,"staffDirectory",uid),{uid,displayName:u.displayName||u.realName||u.email||uid,role:u.role,active:u.active!==false,updatedAt:Date.now()},{merge:true});
        return {ok:true};
      }catch(e){ return {ok:false}; }
    },

    async listStaffDirectory(){
      if(!authReady) return [];
      try{
        const snap=await fx.getDocs(fx.collection(dbHandle,"staffDirectory"));
        const out=[]; snap.forEach(d=>out.push(Object.assign({uid:d.id},d.data())));
        return out.filter(u=>u.active!==false&&["staff","admin","super_admin","tester"].includes(u.role)).sort((a,b)=>String(a.displayName||"").localeCompare(String(b.displayName||""),"zh-Hant"));
      }catch(e){ console.warn("讀取裁判安全目錄失敗",e); return []; }
    },

    async syncStaffDirectory(users){
      if(!authReady || !Array.isArray(users)) return false;
      try{
        const batch=fx.writeBatch(dbHandle); let count=0;
        users.filter(u=>u&&u.uid&&u.active!==false&&["staff","admin","super_admin"].includes(u.role)).forEach(u=>{
          batch.set(fx.doc(dbHandle,"staffDirectory",u.uid),{uid:u.uid,displayName:u.displayName||u.realName||u.email||u.uid,role:u.role,active:true,updatedAt:Date.now()},{merge:true}); count++;
        });
        if(count) await batch.commit();
        return true;
      }catch(e){ console.warn("同步裁判安全目錄失敗",e); return false; }
    },

    async listUsers(){
      if(!authReady) return [];
      try{
        const snap = await fx.getDocs(fx.collection(dbHandle, USERS_COLLECTION));
        const out = [];
        snap.forEach(d=> out.push(Object.assign({ uid: d.id }, d.data())));
        return out;
      }catch(e){
        console.warn("讀取使用者清單失敗", e);
        return [];
      }
    },

    async setUserRole(uid, role){
      if(!authReady) return false;
      try{ const result=await callEngagementFunction("changeManagedAccounts",{uids:[uid],patch:{role},operationId:crypto.randomUUID()},30000);return result.ok&&result.results.every(r=>r.status!=="failed"); }
      catch(e){ console.warn("更新角色失敗", e); return false; }
    },

    async setUserActive(uid, active){
      if(!authReady) return false;
      try{ const result=await callEngagementFunction("changeManagedAccounts",{uids:[uid],patch:{active},operationId:crypto.randomUUID()},30000);return result.ok&&result.results.every(r=>r.status!=="failed"); }
      catch(e){ console.warn("更新啟用狀態失敗", e); return false; }
    },

    async sendResetEmail(email){
      if(!authReady) return { ok:false, error:"雲端服務尚未就緒" };
      try{ await ax.sendPasswordResetEmail(authHandle, email); return { ok:true }; }
      catch(e){ return { ok:false, error: friendlyAuthError(e) }; }
    },

    async changePassword(currentPassword, newPassword){
      if(!authReady) return { ok:false, error:"雲端服務尚未就緒" };
      const user = authHandle.currentUser;
      if(!user || !user.email) return { ok:false, error:"尚未登入" };
      try{
        const credential = ax.EmailAuthProvider.credential(user.email, currentPassword);
        await ax.reauthenticateWithCredential(user, credential);
        await ax.updatePassword(user, newPassword);
        return { ok:true };
      }catch(e){
        return { ok:false, error: friendlyAuthError(e) };
      }
    },

    // Verifies the currently signed-in user's password WITHOUT changing anything —
    // used to re-confirm identity before a sensitive action (e.g. correcting an
    // already-archived historical result).
    async reauthenticate(password){
      if(!authReady) return { ok:false, error:"雲端服務尚未就緒" };
      const user = authHandle.currentUser;
      if(!user || !user.email) return { ok:false, error:"尚未登入" };
      try{
        const credential = ax.EmailAuthProvider.credential(user.email, password);
        await ax.reauthenticateWithCredential(user, credential);
        return { ok:true };
      }catch(e){
        return { ok:false, error: friendlyAuthError(e) };
      }
    }
  };

  // v13.29.3：稱號與每日簽到一律經 Callable Functions，並限制單次等待時間。
  // 前端不直接寫入 earnedTitles、dailyCheckIns、playerStats 或稽核紀錄。
  async function callEngagementFunction(name,payload,timeoutMs=ENGAGEMENT_CALL_TIMEOUT_MS,allowAnonymous=false){
    const epoch=engagementSessionEpoch;
    const uid=firebaseUser&&firebaseUser.uid;
    const initialized=await withTimeout(tryInitFirebase(),10000,false);
    if(initialized===false){const err=new Error('initialization-timeout');err.code='functions/deadline-exceeded';throw err;}
    if(epoch!==engagementSessionEpoch || uid!==(firebaseUser&&firebaseUser.uid)) throw new Error('stale-session');
    if(!allowAnonymous&&(!authReady || !authHandle || !authHandle.currentUser)) throw new Error("auth-required");
    if(!functionsHandle || !fnx) throw new Error("service-unavailable");
    try{
      const call=fnx.httpsCallable(functionsHandle,name,{timeout:timeoutMs});
      const response=await call(payload||{});
      if(epoch!==engagementSessionEpoch || uid!==(firebaseUser&&firebaseUser.uid)) throw new Error('stale-session');
      return response&&response.data ? response.data : {ok:false,error:"empty-response"};
    }catch(e){
      const detailReason=e&&e.details&&typeof e.details==="object"?e.details.reason:e&&e.details;
      const raw=[e&&e.message,detailReason,e&&e.code].filter(Boolean).map(String).join(" ");
      const normalized=raw.includes("feature-disabled")?"feature-disabled":raw.includes("title-not-earned")?"title-not-earned":raw||"request-failed";
      const err=new Error(normalized); err.code=String((e&&e.code)||"functions/unknown"); err.details=e&&e.details; throw err;
    }
  }
  window.engagementService={
    connectionInfo(){return {projectId:FIREBASE_CONFIG.projectId||'未設定',region:'asia-east1',signedIn:!!(authHandle&&authHandle.currentUser),sdkReady:!!fnx};},
    async changeManagedAccounts(payload){return callEngagementFunction("changeManagedAccounts",payload,30000);},
    async tournamentOperation(name,payload){return callEngagementFunction(name,payload,30000);},
    async playerCard(payload){return callEngagementFunction("playerCardService",payload,120000);},
    async health(){return callEngagementFunction('getEngagementHealth',{});},
    async presence(payload){return callEngagementFunction("onlinePresence",payload,15000);},
    async mood(payload){return callEngagementFunction("moodStation",payload,20000);},
    async mailbox(payload){return callEngagementFunction("mailboxService",payload,30000);},
    async eventStaff(payload){return callEngagementFunction("eventStaffService",payload,30000);},
    async mailboxAttachment(payload){return callEngagementFunction("mailboxAttachmentService",payload,60000);},
    async listPartnerPlans(payload){return callEngagementFunction("listPartnerPlans",payload,30000);},
    async savePartnerPlan(payload){return callEngagementFunction("savePartnerPlan",payload,30000);},
    async createPartnerContractDraft(payload){return callEngagementFunction("createPartnerContractDraft",payload,30000);},
    async sendPartnerContract(payload){return callEngagementFunction("sendPartnerContract",payload,30000);},
    async getPartnerContract(payload){return callEngagementFunction("getPartnerContract",payload,30000);},
    async signPartnerContract(payload){return callEngagementFunction("signPartnerContract",payload,60000);},
    async activatePartnerContract(payload){return callEngagementFunction("activatePartnerContract",payload,60000);},
    async familyRegistration(payload){return callEngagementFunction("familyRegistration",payload,60000);},
    async teamRegistration(payload){return callEngagementFunction("teamRegistration",payload,60000);},
    async teamLineup(payload){return callEngagementFunction("teamLineup",payload,60000);},
    async teamScoring(payload){return callEngagementFunction("teamScoring",payload,60000);},
    async roomAccess(payload){return callEngagementFunction("roomAccess",payload,60000);},
    async eventTemplate(payload){return callEngagementFunction("eventTemplateService",payload,30000);},
    async aiCreateParser(payload){return callEngagementFunction("parseTournamentAnnouncementV1",payload,45000);},
    async aiCreatePosterParser(payload){return callEngagementFunction("parseTournamentPosterV1",payload,60000);},
    async roomPosterCover(payload){return callEngagementFunction("roomPosterCover",payload,45000);},
    async family(payload){return callEngagementFunction("familyPlayers",payload,60000);},
    async familyTransfer(payload){return callEngagementFunction("familyTransfer",payload,60000);},
    async inventory(payload){return callEngagementFunction("inventoryService",payload,30000);},
    async cardAlbum(payload){return callEngagementFunction("cardAlbumService",payload,30000);},
    async catalog(payload){return callEngagementFunction("inventoryCatalog",payload,30000);},
    async courtCall(payload){return callEngagementFunction("courtCallService",payload,60000);},
    async enchantment(payload){return callEngagementFunction("enchantmentService",payload,60000);},
    async courtCallPush(payload){return callEngagementFunction("courtCallPushService",payload,60000);},
    async raffle(payload){return callEngagementFunction("memberRaffle",payload,540000,['list','get','announcements'].includes(payload?.action));},
    async getSnapshot(){ return callEngagementFunction("getEngagementSnapshot",{}); },
    async syncHunterAchievements(){ return callEngagementFunction("syncHunterAchievements",{},120000); },
    async dailyCheckIn(){ return callEngagementFunction("dailyCheckIn",{}); },
    async setTitlePreferences(payload){ return callEngagementFunction("setTitlePreferences",payload); },
    async seedInitialTitles(){ return callEngagementFunction("seedInitialTitles",{}); },
    async saveSettings(payload){ return callEngagementFunction("saveEngagementSettings",payload); },
    async grantTitle(payload){ return callEngagementFunction("grantTitle",payload); },
    async claimTitleReward(payload){ return callEngagementFunction("claimTitleReward",payload,30000); },
    async claimCardReward(payload){ return callEngagementFunction("claimCardReward",payload,30000); },
    async getCardRewardMessage(payload){ return callEngagementFunction("getCardRewardMessage",payload,30000); },
    async issueSelfCardRewardE2ETest(){ return callEngagementFunction("issueSelfCardRewardE2ETest",{},30000); },
    async revokeTitle(payload){ return callEngagementFunction("revokeTitle",payload); },
    async getAdminOverview(){ return callEngagementFunction("getEngagementAdminOverview",{}); },
    async runBackfill(payload){ return callEngagementFunction("runTitleBackfill",payload,ENGAGEMENT_BACKFILL_TIMEOUT_MS); },
    async syncMyHostingProgress(payload){return callEngagementFunction("syncMyHostingProgress",payload,120000);},
    async lotteryRegistration(payload){return callEngagementFunction("lotteryRegistration",payload,60000);},
    async manageRegistrationSelection(payload){return callEngagementFunction("manageRegistrationSelection",payload,120000);},
    async manageEntrySelection(payload){return callEngagementFunction("manageEntrySelection",payload,60000);},
    async deleteTournamentSafely(payload){return callEngagementFunction("deleteTournamentSafely",payload,540000);},
    async settleLadder(payload){return callEngagementFunction("settleLadderTournament",payload,120000);},
    async deleteTitleDefinition(payload){return callEngagementFunction("deleteTitleDefinition",payload);},
    async previewPioneerAwards(){return callEngagementFunction("previewPioneerAwards",{},120000);},
    async executePioneerAwards(payload){return callEngagementFunction("executePioneerAwards",payload,120000);},
    async updateTitleDefinition(payload){ return callEngagementFunction("updateTitleDefinition",payload); }
  };


  function generateRoomCode(){
    let code = "";
    for(let i=0;i<ROOM_CODE_LENGTH;i++) code += ROOM_CODE_CHARS[Math.floor(Math.random()*ROOM_CODE_CHARS.length)];
    return ROOM_CODE_PREFIX + code;
  }

  function computeTournamentPhase(data){
    const realMatches = ((data && data.matches) || []).filter(m=>!m.isBye);
    if(data && data.meta && data.meta.eventCancelled) return "cancelled";
    if(data && data.archiveStatus==="completed") return "done";
    if(!data || !data.startedAt) return "waiting";
    if(realMatches.length===0) return "waiting";
    if(!realMatches.every(m=>m.completed)) return "live";
    return "settling";
  }

  // Confirmed security fix: publicTournaments must NEVER contain the full
  // private state (which is what `data: JSON.stringify(state)` was doing —
  // a raw spread that could carry player phone numbers, internal notes,
  // staff assignment data, or anything else added to the state shape later).
  // This function rebuilds an EXPLICIT, hand-picked set of fields safe for
  // an unauthenticated public reader — bracket/score viewing still works
  // (that IS meant to be public), but nothing beyond match structure and
  // player id/name/checked-in status is ever included. Stored under
  // "bracketView", never "data" — the field name itself is part of the
  // fix, so nothing can accidentally keep reading the old private blob.
  function buildPublicMirrorFields(state){
    // Explicit, hand-picked whitelist — NEVER a spread of the full private
    // state. This is the content that ends up INSIDE the "bracketView" JSON
    // string field (see the top-level payload built by createRoom/pushUpdate/
    // confirmMatchTransaction, which separately also writes visibility,
    // registrationStatus, registrationOpenAt/CloseAt, publishedAt, capacity,
    // etc as TOP-LEVEL document fields — those are NOT part of this
    // function's return value, and are listed in full in the write-site
    // functions themselves).
    const sanitizedCourtAssignments = {};
    Object.keys(state.courtAssignments||{}).forEach(key=>{
      const c = state.courtAssignments[key];
      if(!c) return;
      // Explicit per-field whitelist: never wholesale-copy a court's record,
      // since it also carries lockedBy (a staff uid) and lockedAt (internal
      // timing) — neither has any business being visible to an
      // unauthenticated public reader.
      sanitizedCourtAssignments[key] = {
        currentMatchId: c.currentMatchId || null,
        nextMatchId: c.nextMatchId || null,
        status: c.status || "idle"
      };
    });
    return {
      callRevision:Number(state.callRevision||0),
      systemClosure:state.systemClosure?{reason:'idle-24h',label:state.systemClosure.label||'',closedAt:state.systemClosure.closedAt||null,lastActivityAt:state.systemClosure.lastActivityAt||null,restoredAt:state.systemClosure.restoredAt||null}:null,
      eventInfo:buildPublicEventInfo(state),
      meta: {
        name: (state.meta && state.meta.name) || "",
        location: (state.meta && state.meta.location) || "",
        date: (state.meta && state.meta.date) || "",
        battleMode: (state.meta && state.meta.battleMode)==="team" ? "team" : "individual",
        teamSize: Math.max(3,Number(state.meta && state.meta.teamSize)||3),
        playMode: (state.meta && state.meta.playMode)==="enchantment" ? "enchantment" : "standard",
        formatType: (state.meta && state.meta.formatType) || "single",
        format: (state.meta && state.meta.format) || "",
        ladderMode: (state.meta && state.meta.ladderMode) === "ranked" ? "ranked" : "general",
        startTime: (state.meta && state.meta.startTime) || "",
        checkin: (state.meta && state.meta.checkin) || "",
        bronzeMatch: !!(state.meta && state.meta.bronzeMatch),
        stations: (state.meta && state.meta.stations) || 1,
        refereeStationRestrictionEnabled: !!(state.meta && state.meta.refereeStationRestrictionEnabled),
        refereeStationNames: (state.meta && state.meta.refereeStationNames && typeof state.meta.refereeStationNames==="object") ? state.meta.refereeStationNames : {},
        eventAuthority: (state.meta && state.meta.eventAuthority) || "official"
      },
      testMode: state.testMode===true,
      testCreatedAt: state.testCreatedAt||null,
      testExpiresAtMs: state.testExpiresAtMs||state.expiresAtMs||null,
      // Only id/name/checkedIn — no phone, no email, no internal player
      // fields of any kind.
      players: (state.players||[]).map(p=>({ id:p.id, name:p.name, checkedIn:!!p.checkedIn })),
      teams: (state.teams||[]).map(team=>({
        id:team.id, name:team.name,
        memberPlayerIds:Array.isArray(team.memberPlayerIds)?team.memberPlayerIds.slice():[]
      })),
      // Only structural/scoring fields needed to render a public bracket or
      // live scoreboard — no referee uid, no lock info, no internal notes.
      matches: (state.matches||[]).map(m=>({
        id:m.id, seq:m.seq, bracket:m.bracket, round:m.round, indexInRound:m.indexInRound, station:m.station,
        teamIds:Array.isArray(m.teamIds)?m.teamIds.slice(0,2):null,
        a: m.a ? { playerId:m.a.playerId } : null, b: m.b ? { playerId:m.b.playerId } : null,
        isBye:!!m.isBye,
        scoreA:m.scoreA==null?null:Number(m.scoreA), scoreB:m.scoreB==null?null:Number(m.scoreB), log:m.log||[],
        winnerId:m.winnerId||null, loserId:m.loserId||null, completed:!!m.completed,
        resultMethod:m.resultMethod||null, completedAt:Number(m.completedAt)||null, confirmedAt:Number(m.confirmedAt)||null,
        status:m.status||"pending", skippedAt:m.skippedAt||null,callPass:m.callPass||null,
        skipWaitFor:Array.isArray(m.skipWaitFor)?m.skipWaitFor.slice():[], skipManualOnly:m.skipManualOnly===true, resumeQueuedAt:m.resumeQueuedAt||null
      })),
      courtAssignments: sanitizedCourtAssignments,
      // Bracket progression fields — explicit list, not "progression fields"
      // as a vague catch-all: bracketSize, drawnAt, archiveStatus, and the
      // named result-slot ids below are the complete set.
      bracketSize: state.bracketSize||0, drawnAt: state.drawnAt||null, archiveStatus: state.archiveStatus||"ongoing",
      startedAt: state.startedAt||null, completedAt: state.completedAt||null, archivedAt: state.archivedAt||null,
      ladderPointsAwarded: state.ladderPointsAwarded===true,
      championId: state.championId||null, runnerUpId: state.runnerUpId||null,
      thirdId: state.thirdId||null, fourthId: state.fourthId||null,
      gfMatchId: state.gfMatchId||null, gfResetMatchId: state.gfResetMatchId||null,
      bronzeMatchId: state.bronzeMatchId||null, rrRounds: state.rrRounds||0,
      teamResultRevision: Number(state.teamResultRevision)||0,
      teamStandings: Array.isArray(state.teamStandings)?state.teamStandings.map(r=>({id:r.id,name:r.name,rank:r.rank,tied:!!r.tied,played:r.played,wins:r.wins,losses:r.losses,scoreFor:r.scoreFor,scoreAgainst:r.scoreAgainst,diff:r.diff})):null
    };
  }

  function currentUserUidForWrites(){
    try{ const u=(authHandle&&authHandle.currentUser) || ((typeof firebaseUser!=="undefined"&&firebaseUser)?firebaseUser:null); return u ? u.uid : null; }
    catch(e){ return null; }
  }

  function currentUserDisplayNameForWrites(){
    try{
      return String((userProfile && (userProfile.displayName || userProfile.realName || userProfile.nickname)) || adminDisplayName || "").trim();
    }catch(e){ return ""; }
  }

  async function docExists(code){
    const snap = await fx.getDoc(fx.doc(dbHandle, "tournaments", code));
    return snap.exists();
  }

  // Reconstructs a state-shaped object for guest-viewing from a
  // publicTournaments document, supporting BOTH the new safe "bracketView"
  // field and (for backward compatibility with not-yet-migrated documents)
  // the old "data" field — never breaking guest viewing for older tournament
  // codes that haven't been through the cleanup tool yet.
  function reconstructPublicStateFromDoc(id, d){
    let out=null;
    if(d.bracketView){
      try{ out=Object.assign({ id }, JSON.parse(d.bracketView)); }catch(e){ /* fall through */ }
    }
    if(!out&&d.data){
      try{ out=JSON.parse(d.data); }catch(e){ /* fall through */ }
    }
    if(!out)throw new Error("corrupt-public-document");
    out.meta=out.meta||{};out.meta.roomAccessMode=d.roomAccessMode||out.meta.roomAccessMode||"public";
    return out;
  }


  // ==== BXH Ladder module helpers ====
  function cloudLadderTier(points){
    return window.BXHLadderV1.tier(points);
  }
  function cloudLadderTierIndex(t){ return Math.max(0,window.BXHLadderV1.tiers.findIndex(x=>x.name===t)); }
  const OFFICIAL_S1_START_AT = Date.parse("2026-10-01T00:00:00+08:00");
  const OFFICIAL_S1_END_AT = Date.parse("2027-01-31T23:59:59.999+08:00");
  function cloudLadderSeasonEnd(startMs){
    const d=new Date(startMs);
    d.setMonth(d.getMonth()+4);
    return d.getTime()-1;
  }
  function cloudNextSeasonId(cur){ const m=String(cur||"S1").match(/^(?:S)?(\d+)$/i); return "S"+((m?parseInt(m[1],10):1)+1); }
  function cloudSafeTimestampMs(v){ try{ if(v&&typeof v.toMillis==="function") return v.toMillis(); }catch(e){} return typeof v==="number"?v:0; }

  window.cloudSync = {
    async connect(){ return await tryInitFirebase(); },
    isConfigured(){ return isConfigPresent(); },
    isEnabled(){ return cloudEnabled; },

    // Player-facing browsing (Phase 2): fetches public tournaments for the
    // "找賽事" screen. Deliberately uses a SINGLE where() clause (visibility
    // == 'public') to avoid requiring a composite index — everything else
    // (phase, registration status, keyword/date/region/format) is filtered
    // client-side in the calling code. Fine for the scale BXH actually runs
    // at; would need real indexes + pagination if this ever needs to handle
    // thousands of concurrent public tournaments.
    async queryPublicTournaments(){
      // Structured result — never silently collapses a real failure into an
      // empty array. {ok:true, items, rawCount} on success (even if items is
      // empty — that's a legitimate "no public tournaments" result, distinct
      // from a query that never ran), or {ok:false, reason, error} when the
      // query itself failed. Per-document parse failures are logged with the
      // document's own code and excluded individually WITHOUT failing the
      // whole query — but they ARE logged, never silent.
      if(!cloudEnabled) return { ok:false, reason:"network", items:[] };
      try{
        const q = fx.query(fx.collection(dbHandle,"publicTournaments"), fx.where("visibility","==","public"));
        const snap = await fx.getDocs(q);
        const results = [];
        const excluded = [];
        snap.forEach(docSnap=>{
          const d = docSnap.data();
          try{
            const reconstructed = reconstructPublicStateFromDoc(docSnap.id, d);
            results.push(Object.assign({ code: docSnap.id }, d, { parsedData: reconstructed }));
          }catch(e){
            excluded.push({ code: docSnap.id, reason: "parse-error" });
          }
        });

        // Performance: never block first lobby paint on privileged N+1 lifecycle checks.
        // Public results return immediately; authorized self-heal runs best-effort in
        // the background and the existing realtime public listener delivers repairs.
        const actorUid=currentUserUidForWrites();
        const actorPrivileged=!!(userProfile&&userProfile.active!==false&&userProfile.isTestAccount!==true&&["super_admin","admin","staff"].includes(userProfile.role));
        const lifecycleCandidates=results.filter(pub=>actorPrivileged || (!!actorUid && pub.eventAuthority==="community" && pub.ownerUid===actorUid));
        if(lifecycleCandidates.length){
          const cloudApi=this;
          Promise.resolve().then(async()=>{
            for(const pub of lifecycleCandidates){
              try{
                const privateSnap=await fx.getDoc(fx.doc(dbHandle,"tournaments",pub.code));
                if(!privateSnap.exists()) continue;
                const privateDoc=privateSnap.data()||{};
                let privateState=null;
                try{ privateState=typeof privateDoc.data==="string"?JSON.parse(privateDoc.data):privateDoc.data; }catch(e){}
                if(!privateState) continue;
                const privatePhase=computeTournamentPhase(privateState);
                const publicPhase=canonicalPublicTournamentPhase(pub);
                const privateUpdated=Number(privateDoc.updatedAt||privateState.updatedAt||0);
                const publicUpdated=Number(pub.updatedAt||0);
                if(privatePhase===publicPhase && privateUpdated<=publicUpdated) continue;
                const repaired=await cloudApi.repairTournamentLifecycle(pub.code);
                if(repaired&&repaired.ok) console.warn("[queryPublicTournaments] background repaired stale public mirror",pub.code,publicPhase,"=>",privatePhase);
              }catch(e){
                console.warn("[queryPublicTournaments] background lifecycle self-heal skipped",pub.code,e);
              }
            }
          });
        }

        console.log("[queryPublicTournaments] raw doc count:", snap.size, "| usable:", results.length, "| excluded:", JSON.stringify(excluded));
        return { ok:true, items: results, rawCount: snap.size, excluded };
      }catch(e){
        const code = (e && e.code) || "unknown";
        console.warn("[queryPublicTournaments] query FAILED — this is why the list may look empty even though documents exist. Firebase error code:", code, "| query: where(visibility==public) on publicTournaments | raw error:", e);
        let reason = "network";
        if(code==="permission-denied") reason = "permission-denied";
        else if(code==="failed-precondition") reason = "failed-precondition";
        else if(code==="unavailable") reason = "network";
        return { ok:false, reason, error: code, items:[] };
      }
    },

    // Realtime lobby feed: Firestore pushes only actual public-tournament changes.
    // The 90-second reconciliation path below remains as a low-frequency self-heal.
    subscribePublicTournaments(callback){
      if(!cloudEnabled || typeof callback!=="function") return ()=>{};
      try{
        const q=fx.query(fx.collection(dbHandle,"publicTournaments"),fx.where("visibility","==","public"));
        return fx.onSnapshot(q,{includeMetadataChanges:true},snap=>{
          const results=[],excluded=[];
          snap.forEach(docSnap=>{
            const d=docSnap.data();
            try{
              const reconstructed=reconstructPublicStateFromDoc(docSnap.id,d);
              results.push(Object.assign({code:docSnap.id},d,{parsedData:reconstructed}));
            }catch(e){
              excluded.push({code:docSnap.id,reason:"parse-error"});
            }
          });
          callback({ok:true,items:results,rawCount:snap.size,excluded,fromCache:!!(snap.metadata&&snap.metadata.fromCache)});
        },err=>{
          const code=(err&&err.code)||"unknown";
          const reason=code==="permission-denied"?"permission-denied":code==="failed-precondition"?"failed-precondition":"network";
          callback({ok:false,reason,error:code,items:[]});
        });
      }catch(e){
        const code=(e&&e.code)||"unknown";
        const reason=code==="permission-denied"?"permission-denied":code==="failed-precondition"?"failed-precondition":"network";
        callback({ok:false,reason,error:code,items:[]});
        return ()=>{};
      }
    },

    // Legacy-public-data cleanup (spec section 5). Preview step: counts how
    // many publicTournaments documents still carry the old, insecure
    // top-level `data` (full private state spread) and/or `assignedStaffUids`
    // fields, WITHOUT changing anything — shown to the admin before they
    // confirm. Never deletes tournaments, never touches document IDs/codes.
    async previewLegacyPublicDocs(){
      if(!cloudEnabled) return { count:0, total:0 };
      const snap = await fx.getDocs(fx.collection(dbHandle,"publicTournaments"));
      let count = 0;
      snap.forEach(d=>{
        const data = d.data();
        if(data.data !== undefined || data.assignedStaffUids !== undefined) count++;
      });
      return { count, total: snap.size };
    },

    // Rebuilds ONLY the public-safe fields for every legacy document found by
    // previewLegacyPublicDocs(), removing the old `data`/`assignedStaffUids`
    // fields via deleteField(). Idempotent — running it again on an
    // already-cleaned document is a no-op (skipped by the `continue` check),
    // so it can be safely re-run without creating duplicates or side effects.
    // Only ever touches existing documents in place; never creates new ones,
    // never deletes the tournament, never changes the document id/code.
    async cleanupLegacyPublicDocs(){
      if(!cloudEnabled) return { processed:0, failed:0, skipped:0 };
      const snap = await fx.getDocs(fx.collection(dbHandle,"publicTournaments"));
      let processed=0, failed=0, skipped=0;
      for(const docSnap of snap.docs){
        const d = docSnap.data();
        const hasLegacyData = d.data !== undefined;
        const hasLegacyStaff = d.assignedStaffUids !== undefined;
        if(!hasLegacyData && !hasLegacyStaff){ skipped++; continue; }
        try{
          let stateForRebuild = null;
          if(hasLegacyData){ stateForRebuild = JSON.parse(d.data); }
          else if(d.bracketView){ stateForRebuild = JSON.parse(d.bracketView); }
          if(!stateForRebuild) throw new Error("no source data to rebuild from");
          const updatePayload = { bracketView: JSON.stringify(buildPublicMirrorFields(stateForRebuild)) };
          if(hasLegacyData) updatePayload.data = fx.deleteField();
          if(hasLegacyStaff) updatePayload.assignedStaffUids = fx.deleteField();
          await fx.setDoc(docSnap.ref, updatePayload, { merge:true });
          processed++;
        }catch(e){
          failed++;
          console.warn("[cleanupLegacyPublicDocs] failed to clean document", docSnap.id, e);
        }
      }
      return { processed, failed, skipped };
    },

    // ==== Phase 3：線上報名 Transaction（設計已經過十一輪安全審查，詳見
    // 對話紀錄；資料模型為 3 份文件：registrations 子集合／tournaments／
    // publicTournaments，registrationRefs 已移除，改用 collectionGroup
    // 查詢玩家自己的報名記錄。這四個函式尚未在真實 Firestore Emulator
    // 執行過，僅通過人工邏輯審查。====

    async joinTournamentAsPlayer(code,childEligibilityConfirmed,participantMode="self"){
      const uid=(authReady&&authHandle&&authHandle.currentUser)?authHandle.currentUser.uid:null;
      if(!uid)throw{code:"auth-required"};
      const selectionDoc=await fx.getDoc(fx.doc(dbHandle,"publicTournaments",code));
      if(authHandle?.currentUser?.uid!==uid)throw Error('auth-required');
      if(selectionDoc.exists()&&selectionDoc.data().roomAccessMode==="password"){
        const access=await window.engagementService.roomAccess({action:"status",code});
        if(!access?.hasAccess)throw Error("room-password-required");
      }
      const mode=participantMode==='children'?'children':'self';
      if(selectionDoc.exists()&&selectionDoc.data().registrationSelection){
        if(mode==='children')throw Error('child-registration-unavailable');
        return window.engagementService.lotteryRegistration({code,action:'join',childEligibilityConfirmed});
      }
      const selection=await chooseFamilyParticipant(selectionDoc.exists()?selectionDoc.data():{},code,childEligibilityConfirmed,mode);
      if(authHandle?.currentUser?.uid!==uid)throw Error('auth-required');
      return window.engagementService.familyRegistration({action:'join',code,childIds:selection.childIds,allocation:selection.allocation,childEligibilityConfirmed:childEligibilityConfirmed===true,operationId:crypto.randomUUID()});
    },

    async cancelRegistrationAsPlayer(code){
      const uid = (authReady && authHandle && authHandle.currentUser) ? authHandle.currentUser.uid : null;
      if(!uid) throw { code: "auth-required" };
      const selectionDoc=await fx.getDoc(fx.doc(dbHandle,"publicTournaments",code));
      if(selectionDoc.exists()&&selectionDoc.data().registrationSelection)return window.engagementService.lotteryRegistration({code,action:'cancel'});
      const mine=await window.engagementService.familyRegistration({action:'mine',code});
      if(!mine?.ok)throw Error('unavailable');
      const registrationId=await chooseFamilyRegistrationToCancel(mine.rows||[]);
      if(authHandle?.currentUser?.uid!==uid)throw Error('auth-required');
      const result=await window.engagementService.familyRegistration({action:'cancel',code,registrationId,operationId:crypto.randomUUID()});
      if(!result?.ok)throw Error('cancel-failed');
      return result;
    },

    async mutateRegistrationRoster(code,registrationId,action,options={}){
      const staffUid=(authReady&&authHandle&&authHandle.currentUser)?authHandle.currentUser.uid:null;
      if(!staffUid)throw Object.assign(new Error("auth-required"),{code:"auth-required"});
      if(!["promote","demote","cancel"].includes(action))throw Object.assign(new Error("invalid-action"),{code:"invalid-action"});
      const eventCode=String(code||"").toUpperCase(),regId=String(registrationId||"");
      if(!eventCode||!regId)throw Object.assign(new Error("not-found"),{code:"not-found"});
      const expandBy=Number(options.expandBy||0);
      if(expandBy!==0&&expandBy!==8)throw Object.assign(new Error("invalid-capacity-step"),{code:"invalid-capacity-step"});

      const tourRef=fx.doc(dbHandle,"tournaments",eventCode);
      const pubRef=fx.doc(dbHandle,"publicTournaments",eventCode);
      const regRef=fx.doc(dbHandle,"tournaments",eventCode,"registrations",regId);

      const txResult=await fx.runTransaction(dbHandle,async tx=>{
        const tourSnap=await tx.get(tourRef);
        const pubSnap=await tx.get(pubRef);
        const regSnap=await tx.get(regRef);
        if(!tourSnap.exists()||!pubSnap.exists()||!regSnap.exists())throw Object.assign(new Error("not-found"),{code:"not-found"});

        const tour=tourSnap.data()||{},pub=pubSnap.data()||{},reg=Object.assign({registrationId:regId},regSnap.data()||{});
        let runtime={};
        try{runtime=typeof tour.data==="string"?JSON.parse(tour.data):(tour.data||{});}catch(e){throw Object.assign(new Error("corrupt-state"),{code:"corrupt-state"});}
        runtime.meta=runtime.meta||{};
        if(tour.registrationSelection||pub.registrationSelection||(runtime.entrySelection&&runtime.entrySelection.mode==="registration"))throw Object.assign(new Error("selection-managed"),{code:"selection-managed"});
        if(runtime.startedAt||runtime.bracketSize||["live","settling","done","cancelled"].includes(String(pub.tournamentPhase||"")))throw Object.assign(new Error("bracket-locked"),{code:"bracket-locked"});

        let capacity=Math.max(0,Number(pub.capacity||tour.capacity||runtime.meta.registrationCapacity||0));
        let confirmed=Math.max(0,Number(pub.confirmedCount??tour.confirmedCount??0));
        let waiting=Math.max(0,Number(pub.waitlistCount??tour.waitlistCount??0));
        const oldStatus=String(reg.status||"");
        const players=Array.isArray(runtime.players)?runtime.players.slice():[];
        const waitlist=Array.isArray(runtime.waitlistPlayers)?runtime.waitlistPlayers.slice():[];
        const guardian=String(reg.guardianUid||reg.uid||"");
        const participant=String(reg.registrationId||regId);
        const familyId=reg.familyPlayerId?String(reg.familyPlayerId):"";
        const matchesPlayer=p=>{
          if(!p)return false;
          if(String(p.registrationId||"")===participant)return true;
          if(guardian&&String(p.registrationUid||p.guardianUid||"")===guardian){
            if(familyId)return String(p.familyPlayerId||"")===familyId;
            return !p.familyPlayerId;
          }
          return false;
        };
        const existing=players.find(matchesPlayer)||waitlist.find(matchesPlayer)||null;
        const displayName=String(reg.displayName||reg.publicName||reg.participantName||reg.realName||(existing&&existing.name)||"").trim();
        const makePlayer=()=>{
          const p=Object.assign({},existing||{});
          p.id=familyId?"family_"+familyId:(p.id||("reg_"+participant.replace(/[^A-Za-z0-9_-]/g,"_")));
          p.name=displayName||p.name||"未命名選手";
          p.source="online";
          p.registrationUid=guardian||String(reg.uid||"");
          p.registrationId=participant;
          p.checkedIn=existing?existing.checkedIn===true:!runtime.meta.checkinRequired;
          if(familyId){p.familyPlayerId=familyId;p.participantId=familyId;p.guardianUid=guardian;}
          return p;
        };

        let nextConfirmed=confirmed,nextWaiting=waiting,newCapacity=capacity;
        let nextPlayers=players.filter(p=>!matchesPlayer(p));
        let nextWait=waitlist.filter(p=>!matchesPlayer(p));
        let regPatch={updatedAt:fx.serverTimestamp()};

        if(action==="promote"){
          if(oldStatus!=="waitlist")throw Object.assign(new Error("not-waitlist"),{code:"not-waitlist"});
          if(capacity>0&&confirmed>=capacity){
            if(expandBy!==8)throw Object.assign(new Error("capacity-full"),{code:"capacity-full",capacity,confirmedCount:confirmed});
            newCapacity=capacity+8;
          }
          nextConfirmed=confirmed+1;nextWaiting=Math.max(0,waiting-1);
          nextPlayers.push(makePlayer());
          regPatch=Object.assign(regPatch,{status:"confirmed",promotedAt:fx.serverTimestamp(),promotedBy:staffUid});
        }else if(action==="demote"){
          if(oldStatus!=="confirmed")throw Object.assign(new Error("not-confirmed"),{code:"not-confirmed"});
          nextConfirmed=Math.max(0,confirmed-1);nextWaiting=waiting+1;
          const wp=makePlayer();wp.waitRank=waiting+1;wp.waitlistedAt=Date.now();nextWait.push(wp);
          regPatch=Object.assign(regPatch,{status:"waitlist",waitRank:waiting+1});
        }else{
          if(oldStatus!=="confirmed"&&oldStatus!=="waitlist")throw Object.assign(new Error("nothing-to-cancel"),{code:"nothing-to-cancel"});
          if(oldStatus==="confirmed")nextConfirmed=Math.max(0,confirmed-1);else nextWaiting=Math.max(0,waiting-1);
          regPatch=Object.assign(regPatch,{status:"cancelled",cancelledAt:fx.serverTimestamp(),cancelledBy:staffUid});
        }

        runtime.players=nextPlayers;
        runtime.waitlistPlayers=nextWait;
        runtime.meta.registrationCapacity=newCapacity;
        let nextRegStatus=String(pub.registrationStatus||tour.registrationStatus||runtime.meta.registrationStatus||"open");
        if(nextRegStatus==="full"&&(!newCapacity||nextConfirmed<newCapacity))nextRegStatus="open";
        if(newCapacity>0&&nextConfirmed>=newCapacity)nextRegStatus="full";
        runtime.meta.registrationStatus=nextRegStatus;

        const common={
          capacity:newCapacity,
          confirmedCount:nextConfirmed,
          waitlistCount:nextWaiting,
          registrationStatus:nextRegStatus,
          updatedAt:Date.now(),
          lastRegistrationMutationUid:regId,
          lastRegistrationMutationType:action+(newCapacity!==capacity?"_expand8":""),
          lastRegistrationMutationBy:staffUid
        };
        tx.update(regRef,regPatch);
        tx.update(tourRef,Object.assign({},common,{data:JSON.stringify(runtime)}));
        tx.update(pubRef,Object.assign({},common,{bracketView:JSON.stringify(buildPublicMirrorFields(runtime))}));
        return {capacity:newCapacity,confirmedCount:nextConfirmed,waitlistCount:nextWaiting,status:action==="cancel"?"cancelled":action==="demote"?"waitlist":"confirmed",participantRegistrationId:participant};
      });

      // Server round-trip verification: do not announce success until all authoritative
      // surfaces agree with the transaction result.
      const [tourSnap,pubSnap,regSnap]=await Promise.all([fx.getDoc(tourRef),fx.getDoc(pubRef),fx.getDoc(regRef)]);
      const tourExists=tourSnap.exists(),pubExists=pubSnap.exists(),regExists=regSnap.exists();
      if(!tourExists||!pubExists||!regExists){
        console.warn("[roster verify missing document]",{action,regId,participantRegistrationId:txResult.participantRegistrationId||"",tourExists,pubExists,regExists,txResult});
        // The atomic transaction has already committed. Tournament/public mirrors are the
        // authoritative roster surfaces; a transient registration read miss must not turn
        // a successful mutation into a false failure.
        if(!tourExists||!pubExists)throw Object.assign(new Error("roster-sync-mismatch"),{code:"roster-sync-mismatch"});
      }
      const tour=tourSnap.data()||{},pub=pubSnap.data()||{},reg=regExists?(regSnap.data()||{}):{};
      let remoteState={};try{remoteState=typeof tour.data==="string"?JSON.parse(tour.data):(tour.data||{});}catch(e){}
      const expectedStatus=txResult.status;
      const stateCap=Number(remoteState&&remoteState.meta&&remoteState.meta.registrationCapacity||0);
      const countsOk=Number(tour.confirmedCount||0)===Number(txResult.confirmedCount)&&Number(pub.confirmedCount||0)===Number(txResult.confirmedCount)&&Number(tour.waitlistCount||0)===Number(txResult.waitlistCount)&&Number(pub.waitlistCount||0)===Number(txResult.waitlistCount);
      const capOk=Number(tour.capacity||0)===Number(txResult.capacity)&&Number(pub.capacity||0)===Number(txResult.capacity)&&stateCap===Number(txResult.capacity);
      const statusOk=!regExists||String(reg.status||"")===String(expectedStatus);
      let publicRuntime={};try{publicRuntime=pub.bracketView?JSON.parse(pub.bracketView):{};}catch(e){}
      const pubPlayerIds=new Set((publicRuntime.players||[]).map(p=>String(p.id||"")));
      const verifyRegistrationId=String(txResult.participantRegistrationId||regId);
      const privateCandidate=(remoteState.players||[]).find(p=>String(p.registrationId||"")===verifyRegistrationId)||null;
      const rosterOk=action==="promote"
        ? !!privateCandidate&&pubPlayerIds.has(String(privateCandidate.id||""))
        : !privateCandidate&&!(publicRuntime.players||[]).some(p=>String(p.id||"")&&pubPlayerIds.has(String(p.id||""))&&
            (remoteState.waitlistPlayers||[]).some(w=>String(w.registrationId||"")===verifyRegistrationId&&String(w.id||"")===String(p.id||"")));
      if(!countsOk||!capOk||!statusOk||!rosterOk){
        console.warn("[roster verify mismatch]",{action,regId,verifyRegistrationId,countsOk,capOk,statusOk,rosterOk,txResult});
        // The transaction has already committed atomically. A read-back mismatch is
        // diagnostic only: do not report a successful roster mutation as a failure.
        // The authoritative tournament state returned here is applied by the caller,
        // and live roster listeners will reconcile any lagging mirror immediately.
        return Object.assign({ok:true,verified:false,verificationWarning:"roster-sync-mismatch",state:remoteState,registrationId:verifyRegistrationId},txResult);
      }
      return Object.assign({ok:true,verified:true,state:remoteState,registrationId:verifyRegistrationId},txResult);
    },

    async promoteEarliestWaitlist(code){
      const staffUid = (authReady && authHandle && authHandle.currentUser) ? authHandle.currentUser.uid : null;
      if(!staffUid) throw { code: "auth-required" };

      const q = fx.query(
        fx.collection(dbHandle, "tournaments", code, "registrations"),
        fx.where("status", "==", "waitlist"),
        fx.orderBy("createdAt", "asc"),
        fx.limit(1)
      );
      const snap = await fx.getDocs(q);
      if(snap.empty) throw { code: "no-waitlist-candidate" };
      const candidateUid = snap.docs[0].id;

      const tourRef = fx.doc(dbHandle, "tournaments", code);
      const pubRef = fx.doc(dbHandle, "publicTournaments", code);
      const regRef = fx.doc(dbHandle, "tournaments", code, "registrations", candidateUid);

      return await fx.runTransaction(dbHandle, async (tx) => {
        const pubSnap = await tx.get(pubRef);
        if(!pubSnap.exists()) throw { code:"not-found" };
        const pub=pubSnap.data();
        let publicRuntime=null;
        try{ publicRuntime=pub.bracketView?JSON.parse(pub.bracketView):null; }catch(e){}
        if(pub.tournamentPhase === "live" || pub.tournamentPhase === "settling" || pub.tournamentPhase === "done" || pub.tournamentPhase === "cancelled" || (publicRuntime&&publicRuntime.archiveStatus==="completed")) throw { code:"tournament-started" };
        const regSnap = await tx.get(regRef);
        if(!regSnap.exists() || regSnap.data().status !== "waitlist") throw { code: "candidate-changed-retry" };

        tx.update(regRef, { status: "confirmed", promotedAt: fx.serverTimestamp(), promotedBy: staffUid, updatedAt: fx.serverTimestamp() });
        tx.update(tourRef, {
          confirmedCount: fx.increment(1), waitlistCount: fx.increment(-1), updatedAt: Date.now(),
          lastRegistrationMutationUid: candidateUid, lastRegistrationMutationType: "promote",
        });
        tx.update(pubRef, { confirmedCount: fx.increment(1), waitlistCount: fx.increment(-1), updatedAt: Date.now() });

        return { ok: true, promotedUid: candidateUid };
      });
    },

    async staffCancelRegistration(code, targetUid){
      const staffUid = (authReady && authHandle && authHandle.currentUser) ? authHandle.currentUser.uid : null;
      if(!staffUid) throw { code: "auth-required" };
      const tourRef = fx.doc(dbHandle, "tournaments", code);
      const pubRef = fx.doc(dbHandle, "publicTournaments", code);
      const regRef = fx.doc(dbHandle, "tournaments", code, "registrations", targetUid);

      return await fx.runTransaction(dbHandle, async (tx) => {
        const pubSnap = await tx.get(pubRef);
        if(!pubSnap.exists()) throw { code:"not-found" };
        const pub=pubSnap.data();
        let publicRuntime=null;
        try{ publicRuntime=pub.bracketView?JSON.parse(pub.bracketView):null; }catch(e){}
        if(pub.tournamentPhase === "live" || pub.tournamentPhase === "settling" || pub.tournamentPhase === "done" || pub.tournamentPhase === "cancelled" || (publicRuntime&&publicRuntime.archiveStatus==="completed")) throw { code:"tournament-started" };
        const regSnap = await tx.get(regRef);
        if(!regSnap.exists()) throw { code: "not-found" };
        const reg = regSnap.data();
        if(reg.status !== "confirmed" && reg.status !== "waitlist") throw { code: "nothing-to-cancel" };
        const field = reg.status === "confirmed" ? "confirmedCount" : "waitlistCount";
        const mutationType = reg.status === "confirmed" ? "cancel_confirmed" : "cancel_waitlist";

        tx.update(regRef, { status: "cancelled", cancelledAt: fx.serverTimestamp(), cancelledBy: staffUid, updatedAt: fx.serverTimestamp() });
        tx.update(tourRef, {
          [field]: fx.increment(-1), updatedAt: Date.now(),
          lastRegistrationMutationUid: targetUid, lastRegistrationMutationType: mutationType,
        });
        tx.update(pubRef, { [field]: fx.increment(-1), updatedAt: Date.now() });

        return { ok: true };
      });
    },

    // ==== BXH Ladder (database is the sole source of truth) ====
    async ensureLadderSystem(){
      if(!cloudEnabled) return {ok:false,reason:"network"};
      const controlRef=fx.doc(dbHandle,"ladderSystem","current");
      return await fx.runTransaction(dbHandle,async tx=>{
        const snap=await tx.get(controlRef);
        if(snap.exists()) return {ok:true,control:snap.data(),created:false};
        const startAt=OFFICIAL_S1_START_AT, endAt=OFFICIAL_S1_END_AT, seasonId="S1";
        tx.set(controlRef,{currentSeason:seasonId,startAt,endAt,status:"active",rolloverInProgress:false,seasonLengthMonths:4,createdAt:fx.serverTimestamp(),updatedAt:fx.serverTimestamp()});
        tx.set(fx.doc(dbHandle,"ladderSeasons",seasonId),{seasonId,startAt,endAt,status:"active",seasonLengthMonths:4,createdAt:fx.serverTimestamp(),createdBy:authHandle.currentUser&&authHandle.currentUser.uid||null});
        return {ok:true,control:{currentSeason:seasonId,startAt,endAt,status:"active",rolloverInProgress:false,seasonLengthMonths:4},created:true};
      });
    },

    async syncOfficialLadderSeasonSchedule(){
      if(!cloudEnabled) return {ok:false,reason:"network"};
      const actorUid=authHandle&&authHandle.currentUser&&authHandle.currentUser.uid;
      if(!actorUid) return {ok:false,reason:"auth-required"};
      const controlRef=fx.doc(dbHandle,"ladderSystem","current");
      return await fx.runTransaction(dbHandle,async tx=>{
        const cs=await tx.get(controlRef);
        if(!cs.exists()) return {ok:false,reason:"not-initialized"};
        const control=cs.data()||{};
        if((control.currentSeason||"S1")!=="S1") return {ok:true,skipped:true,reason:"not-s1"};
        const seasonRef=fx.doc(dbHandle,"ladderSeasons","S1");
        tx.set(controlRef,{
          startAt:OFFICIAL_S1_START_AT,
          endAt:OFFICIAL_S1_END_AT,
          seasonLengthMonths:4,
          updatedAt:fx.serverTimestamp()
        },{merge:true});
        tx.set(seasonRef,{
          seasonId:"S1",
          startAt:OFFICIAL_S1_START_AT,
          endAt:OFFICIAL_S1_END_AT,
          seasonLengthMonths:4,
          status:"active"
        },{merge:true});
        return {ok:true,startAt:OFFICIAL_S1_START_AT,endAt:OFFICIAL_S1_END_AT};
      });
    },

    async getPlayerBadges(uids){const call=fnx.httpsCallable(functionsHandle,'playerCardService',{timeout:15000});const r=await call({action:'badges',uids});return r.data;},
    async getLadderSnapshot(){
      if(!cloudEnabled) return {control:null,season:null,players:[]};

      // Control and player collection are independent: fetch them in parallel.
      // Previously these were serial, followed by another season read, causing
      // avoidable latency on mobile even with only one ladder player.
      const [controlSnap,ps]=await Promise.all([
        fx.getDoc(fx.doc(dbHandle,"ladderSystem","current")),
        fx.getDocs(fx.collection(dbHandle,"ladderPlayers"))
      ]);
      const control=controlSnap.exists()?controlSnap.data():null;
      const players=[]; ps.forEach(d=>players.push(Object.assign({uid:d.id},d.data())));

      let season=null;
      if(control&&control.currentSeason){
        const ss=await fx.getDoc(fx.doc(dbHandle,"ladderSeasons",control.currentSeason));
        if(ss.exists()) season=ss.data();
      }
      return {control,season,players};
    },

    async getLadderPlayer(uid){
      if(!cloudEnabled||!uid) return null;
      const s=await fx.getDoc(fx.doc(dbHandle,"ladderPlayers",uid));
      return s.exists()?Object.assign({uid:s.id},s.data()):null;
    },

    async getLadderTransactions(options={}){
      if(!cloudEnabled) return [];
      const uid=authHandle&&authHandle.currentUser&&authHandle.currentUser.uid;
      if(!uid) throw new Error("auth-required");
      const epoch=typeof engagementSessionEpoch!=="undefined"?engagementSessionEpoch:0;
      const admin=!!(userProfile&&userProfile.active!==false&&userProfile.isTestAccount!==true&&["admin","super_admin"].includes(userProfile.role));
      let q;
      if(admin){
        q=fx.query(fx.collection(dbHandle,"ladderTransactions"),fx.orderBy("createdAt","desc"),fx.limit(200));
      }else{
        const seasonId=String(options.seasonId||"");
        if(!seasonId) throw new Error("season-required");
        // Equality filters use Firestore's merged single-field indexes. Do not
        // require a new composite index or query other players' audit records.
        q=fx.query(fx.collection(dbHandle,"ladderTransactions"),fx.where("playerUid","==",uid),fx.where("seasonId","==",seasonId),fx.limit(200));
      }
      const s=await fx.getDocs(q);
      if(uid!==(authHandle&&authHandle.currentUser&&authHandle.currentUser.uid)) throw new Error("stale-session");
      if(epoch!==(typeof engagementSessionEpoch!=="undefined"?engagementSessionEpoch:0)) throw new Error("stale-session");
      const out=[]; s.forEach(d=>{const x=Object.assign({id:d.id},d.data()); x.createdAtMs=cloudSafeTimestampMs(x.createdAt); out.push(x);});
      // A capped unordered result cannot honestly be labelled "most recent".
      if(!admin&&out.length>=200) throw new Error("history-limit-reached");
      return out.sort((a,b)=>Number(b.createdAtMs||0)-Number(a.createdAtMs||0));
    },

    async getTestLadderRanking(){
      if(!cloudEnabled) return [];
      const snap=await fx.getDocs(fx.collection(dbHandle,"testLadderPlayers"));
      const out=[]; snap.forEach(d=>out.push(Object.assign({testPlayerKey:d.id},d.data())));
      return out.sort((a,b)=>(Number(b.seasonPoints||0)-Number(a.seasonPoints||0))||(Number(b.wins||0)-Number(a.wins||0))||String(a.testPlayerKey).localeCompare(String(b.testPlayerKey)));
    },

    async settleTestLadderTournament(code,payload){
      if(!cloudEnabled||!code) return {ok:false,reason:"network"};
      const actorUid=authHandle&&authHandle.currentUser&&authHandle.currentUser.uid;
      if(!actorUid) return {ok:false,reason:"auth-required"};
      const eventCode=String(code).toUpperCase();
      const tournamentSnap=await fx.getDoc(fx.doc(dbHandle,"tournaments",eventCode));
      if(!tournamentSnap.exists()) return {ok:false,reason:"event-not-found"};
      const tournament=tournamentSnap.data()||{};
      if(tournament.testMode!==true||tournament.eventAuthority!=="test"||tournament.ownerUid!==actorUid) return {ok:false,reason:"not-own-test-event",message:"只能結算自己建立的測試賽事"};
      const items=(payload&&payload.participants||[]).filter(x=>x&&x.source==="test"&&/^T\d{3}$/.test(String(x.testPlayerKey||"")));
      if(!items.length) return {ok:true,skipped:true,reason:"no-test-players",message:"本場皆為現場新增選手，未計入 TEST-S1；僅 T001～T064 實驗玩家可累積測試積分",results:[],skippedPlayers:(payload?.participants||[]).map(p=>p.playerName)};
      const results=[]; let newWrites=0;
      for(const item of items){
        const key=String(item.testPlayerKey);
        const txId=eventCode+"_"+key;
        const txRef=fx.doc(dbHandle,"testLadderTransactions",txId);
        const playerRef=fx.doc(dbHandle,"testLadderPlayers",key);
        const r=await fx.runTransaction(dbHandle,async tx=>{
          const prior=await tx.get(txRef);
          if(prior.exists()) return {already:true,points:Number(prior.data().delta||0)};
          const ps=await tx.get(playerRef);
          const old=ps.exists()?ps.data():{};
          const delta=Number(item.pointsEarned||0);
          const next={
            testPlayerKey:key, playerName:String(item.playerName||key), seasonId:"TEST-S1",
            seasonPoints:Number(old.seasonPoints||0)+delta, careerPoints:Number(old.careerPoints||0)+delta,
            totalEvents:Number(old.totalEvents||0)+1, wins:Number(old.wins||0)+Number(item.wins||0), losses:Number(old.losses||0)+Number(item.losses||0),
            championCount:Number(old.championCount||0)+(item.placement===1?1:0), runnerUpCount:Number(old.runnerUpCount||0)+(item.placement===2?1:0),
            thirdPlaceCount:Number(old.thirdPlaceCount||0)+(item.placement===3?1:0), fourthPlaceCount:Number(old.fourthPlaceCount||0)+(item.placement===4?1:0),
            updatedAt:Date.now()
          };
          tx.set(playerRef,next,{merge:true});
          tx.set(txRef,{type:"event",eventAuthority:"test",actorUid,testPlayerKey:key,playerName:String(item.playerName||key),seasonId:"TEST-S1",delta,eventCode,eventName:String(payload.eventName||""),placement:item.placement||null,wins:Number(item.wins||0),losses:Number(item.losses||0),createdAt:Date.now()});
          return {already:false,points:delta};
        });
        if(!r.already) newWrites++;
        results.push({testPlayerKey:key,playerName:item.playerName,pointsEarned:r.points,placement:item.placement||null,alreadyAwarded:!!r.already});
      }
      return {ok:true,seasonId:"TEST-S1",awardedAt:Date.now(),alreadyAwarded:newWrites===0,results};
    },

    async settleLadderTournament(code,payload){
      if(!cloudEnabled||!code) return {ok:false,reason:"network"};
      const actorUid=authHandle&&authHandle.currentUser&&authHandle.currentUser.uid;
      if(!actorUid) return {ok:false,reason:"auth-required"};
      if(!window.engagementService||typeof window.engagementService.settleLadder!=="function") throw new Error("service-unavailable");
      return window.engagementService.settleLadder({code:String(code).toUpperCase()});

    },

    async adjustLadderPoints(uid,newSeasonPoints,reason,actorName){
      if(!cloudEnabled||!uid||!reason) return {ok:false,reason:"invalid"};
      const actorUid=authHandle&&authHandle.currentUser&&authHandle.currentUser.uid;
      if(!actorUid) return {ok:false,reason:"auth-required"};
      const playerRef=fx.doc(dbHandle,"ladderPlayers",uid);
      const controlRef=fx.doc(dbHandle,"ladderSystem","current");
      const logRef=fx.doc(fx.collection(dbHandle,"ladderTransactions"));
      return await fx.runTransaction(dbHandle,async tx=>{
        const ps=await tx.get(playerRef), cs=await tx.get(controlRef);
        if(!ps.exists()) return {ok:false,reason:"not-found"};
        if(!cs.exists()||cs.data().rolloverInProgress===true) return {ok:false,reason:"season-unavailable"};
        const control=cs.data(); const isTrialSeason=String(control.currentSeason||"").toUpperCase()==="S0"||control.isTrialSeason===true;
        const old=ps.data(); const before=Math.max(0,Number(old.seasonPoints||0)); const after=Math.max(0,Number(newSeasonPoints)||0); const delta=after-before;
        const beforeCareer=Math.max(0,Number(old.careerPoints||0)); const afterCareer=isTrialSeason?beforeCareer:Math.max(0,beforeCareer+delta);
        const rankTier=cloudLadderTier(after); const oldHigh=old.highestRankTier||"黑鐵"; const highest=isTrialSeason?oldHigh:(cloudLadderTierIndex(rankTier)>cloudLadderTierIndex(oldHigh)?rankTier:oldHigh);
        tx.update(playerRef,{seasonPoints:after,careerPoints:afterCareer,rankTier,highestRankTier:highest,lastPointsUpdatedAt:fx.serverTimestamp()});
        tx.set(logRef,{type:"adjustment",playerUid:uid,playerName:old.playerName||"",seasonId:old.currentSeason||control.currentSeason||"S1",isTrialSeason,countsTowardCareer:!isTrialSeason,beforeSeasonPoints:before,afterSeasonPoints:after,beforeCareerPoints:beforeCareer,afterCareerPoints:afterCareer,delta,reason,actorUid,actorName:actorName||"",createdAt:fx.serverTimestamp()});
        return {ok:true,before,after,delta};
      });
    },

    async openNewLadderSeason(actorName){
      if(!cloudEnabled) return {ok:false,reason:"network"};
      const actorUid=authHandle&&authHandle.currentUser&&authHandle.currentUser.uid;
      if(!actorUid) return {ok:false,reason:"auth-required"};
      const controlRef=fx.doc(dbHandle,"ladderSystem","current");

      // Lock the ladder first. Event settlement checks this flag inside its own transaction.
      const lock=await fx.runTransaction(dbHandle,async tx=>{
        const cs=await tx.get(controlRef); if(!cs.exists()) return {ok:false,reason:"not-initialized"};
        const c=cs.data();
        if(String(c.currentSeason||"").toUpperCase()==="S0") return {ok:false,reason:"s0-auto-cutover",message:"S0 將於 10/1 00:00 自動切換為 S1，不需手動開季"};
        if(c.rolloverInProgress!==true && c.lastRolloverCompletedAtMs && (Date.now()-Number(c.lastRolloverCompletedAtMs)) < 10*60*1000){
          return {ok:true,alreadyCompleted:true,oldSeason:c.lastRolloverFromSeason||null,newSeason:c.currentSeason||"S1"};
        }
        if(c.rolloverInProgress!==true && Number(c.endAt||0) && Date.now()<=Number(c.endAt)){
          return {ok:false,reason:"season-not-ended",endAt:Number(c.endAt)};
        }
        const oldSeason=c.rolloverFromSeason||(c.currentSeason||"S1");
        const newSeason=c.rolloverTargetSeason||cloudNextSeasonId(oldSeason);
        const oldEndAt=Number(c.endAt||0);
        if(c.rolloverInProgress!==true){ tx.update(controlRef,{rolloverInProgress:true,rolloverFromSeason:oldSeason,rolloverTargetSeason:newSeason,updatedAt:fx.serverTimestamp()}); }
        return {ok:true,oldSeason,newSeason,oldEndAt};
      });
      if(!lock.ok) return lock;
      if(lock.alreadyCompleted) return {ok:true,alreadyCompleted:true,oldSeason:lock.oldSeason,newSeason:lock.newSeason};

      const ps=await fx.getDocs(fx.collection(dbHandle,"ladderPlayers"));
      const players=ps.docs.map(d=>Object.assign({uid:d.id},d.data()));
      // On retry, players already rolled use their saved old-season final values.
      const finalRows=players.map(p=>{
        const h=p.seasonHistory&&p.seasonHistory[lock.oldSeason];
        return Object.assign({},p,{__finalPoints:h&&h.finalPoints!=null?Number(h.finalPoints):Number(p.seasonPoints||0)});
      }).sort((a,b)=> (b.__finalPoints-a.__finalPoints) || (Number(b.championCount||0)-Number(a.championCount||0)) || (Number(b.runnerUpCount||0)-Number(a.runnerUpCount||0)) || (Number(b.thirdPlaceCount||0)-Number(a.thirdPlaceCount||0)) || (Number(b.fourthPlaceCount||0)-Number(a.fourthPlaceCount||0)) || (Number(b.careerPoints||0)-Number(a.careerPoints||0)) );
      let lastKey=null,lastRank=0;
      finalRows.forEach((p,i)=>{const k=[p.__finalPoints,p.championCount||0,p.runnerUpCount||0,p.thirdPlaceCount||0,p.fourthPlaceCount||0,p.careerPoints||0].join("|"); if(i===0||k!==lastKey)lastRank=i+1; p.__finalRanking=lastRank; lastKey=k;});
      const byUid=Object.fromEntries(finalRows.map(x=>[x.uid,x]));

      const pending=players.filter(p=>p.lastRolloverFromSeason!==lock.oldSeason);
      for(let offset=0;offset<pending.length;offset+=350){
        const batch=fx.writeBatch(dbHandle);
        for(const p of pending.slice(offset,offset+350)){
          const final=byUid[p.uid]; const finalPoints=Number(final.__finalPoints||0); const history=Object.assign({},p.seasonHistory||{});
          history[lock.oldSeason]={finalPoints,finalRankTier:cloudLadderTier(finalPoints),finalRanking:final.__finalRanking};
          const newPoints=Math.floor(finalPoints*0.5); const newTier=cloudLadderTier(newPoints);
          batch.set(fx.doc(dbHandle,"ladderPlayers",p.uid),{seasonHistory:history,seasonPoints:newPoints,rankTier:newTier,currentSeason:lock.newSeason,lastRolloverFromSeason:lock.oldSeason,lastPointsUpdatedAt:fx.serverTimestamp()},{merge:true});
        }
        await batch.commit();
      }

      const startAt=Number(lock.oldEndAt||0)+1 || Date.now(),endAt=cloudLadderSeasonEnd(startAt);
      const finishBatch=fx.writeBatch(dbHandle);
      finishBatch.set(fx.doc(dbHandle,"ladderSeasons",lock.oldSeason),{status:"completed",completedAt:fx.serverTimestamp(),completedBy:actorUid,finalPlayerCount:players.length},{merge:true});
      finishBatch.set(fx.doc(dbHandle,"ladderSeasons",lock.newSeason),{seasonId:lock.newSeason,startAt,endAt,status:"active",seasonLengthMonths:4,createdAt:fx.serverTimestamp(),createdBy:actorUid});
      finishBatch.set(controlRef,{currentSeason:lock.newSeason,startAt,endAt,status:"active",seasonLengthMonths:4,rolloverInProgress:false,rolloverFromSeason:null,rolloverTargetSeason:null,lastRolloverFromSeason:lock.oldSeason,lastRolloverToSeason:lock.newSeason,lastRolloverCompletedAtMs:now,updatedAt:fx.serverTimestamp()},{merge:true});
      await finishBatch.commit();
      return {ok:true,oldSeason:lock.oldSeason,newSeason:lock.newSeason,startAt:now,endAt};
    },

    // v13.14.4：刪除整場雲端賽事。Firestore 刪除父文件不會自動刪除子集合，
    // 因此先清 registrations / participants，再刪公開鏡像與主賽事文件。
    async deleteTournament(code){
      if(!cloudEnabled || !code) throw new Error("cloud-unavailable");
      const normalized = String(code).toUpperCase();
      if(!window.engagementService || !window.engagementService.deleteTournamentSafely) throw new Error("delete-service-unavailable");
      const result=await window.engagementService.deleteTournamentSafely({code:normalized,operationId:crypto.randomUUID()});
      if(!result || result.ok!==true || result.deleted!==true) throw new Error((result&&result.error)||"delete-failed");
      // A success toast is allowed only after the public entry point is gone.
      const publicAfter=await fx.getDoc(fx.doc(dbHandle,"publicTournaments",normalized));
      if(publicAfter.exists()) throw new Error("delete-not-confirmed");
      return true;
    },

    async cleanupMyExpiredTestRooms(){
      const uid=currentUserUidForWrites();
      if(!uid||!userProfile||(userProfile.role!=="tester"&&userProfile.isTestAccount!==true)) return {processed:0};
      const q=fx.query(fx.collection(dbHandle,"tournaments"),fx.where("createdBy","==",uid),fx.where("eventAuthority","==","test"));
      const snap=await fx.getDocs(q); let processed=0; const now=Date.now();
      for(const ds of snap.docs){
        const d=ds.data()||{};
        const exp=d.testExpiresAt&&typeof d.testExpiresAt.toMillis==="function"?d.testExpiresAt.toMillis():(d.expiresAt&&typeof d.expiresAt.toMillis==="function"?d.expiresAt.toMillis():0);
        if(exp&&exp<=now){ await this.deleteTournament(ds.id); processed++; }
      }
      return {processed};
    },

    // v13.14.0：管理後台雲端賽事清單。管理角色直接讀 tournaments 集合，
    // 顯示頂層安全管理摘要與報名計數；開啟單一賽事時仍走 joinRoom() 讀取完整 data。
    async repairTournamentLifecycle(code){
      if(!cloudEnabled || !code) return {ok:false,reason:"network"};
      try{
        const privateRef=fx.doc(dbHandle,"tournaments",code);
        const publicRef=fx.doc(dbHandle,"publicTournaments",code);
        const privateSnap=await fx.getDoc(privateRef);
        if(!privateSnap.exists()) return {ok:false,reason:"not-found"};
        const d=privateSnap.data()||{};
        let parsed;
        try{ parsed=JSON.parse(d.data); }catch(e){ return {ok:false,reason:"corrupt-data"}; }
        let phase=computeTournamentPhase(parsed);
        const archiveStatus=parsed.archiveStatus||d.archiveStatus||"ongoing";
        if(archiveStatus==="completed") phase="done";
        const registrationStatus=(phase==="live"||phase==="done")?"started":(d.registrationStatus||null);

        await fx.setDoc(privateRef,{tournamentPhase:phase,archiveStatus,registrationStatus,updatedAt:Date.now()},{merge:true});
        await fx.setDoc(publicRef,{
          bracketView:JSON.stringify(buildPublicMirrorFields(parsed)),
          tournamentPhase:phase,
          registrationStatus,
          updatedAt:Date.now()
        },{merge:true});
        return {ok:true,phase,archiveStatus};
      }catch(e){
        console.warn("[repairTournamentLifecycle]",code,e);
        return {ok:false,reason:(e&&e.code)||"error"};
      }
    },

    async queryAdminTournaments(){
      if(!cloudEnabled) return [];
      const actorUid=currentUserUidForWrites();
      const testerSession=!!(userProfile&&userProfile.active!==false&&(userProfile.role==="tester"||userProfile.isTestAccount===true)&&actorUid);
      const partnerSession=isPartnerOrganizerMode()&&actorUid;
      const eventStaffSession=isEventStaffMode()&&actorUid;
      let docs=[];
      if(eventStaffSession){
        const access=await window.engagementService.eventStaff({action:"listMine"});
        const codes=(access?.assignments||[]).filter(item=>item.status==="accepted"&&item.effective===true).map(item=>item.eventCode);
        docs=(await Promise.all(codes.map(code=>fx.getDoc(fx.doc(dbHandle,"tournaments",code))))).filter(snap=>snap.exists());
      }else{
        const source=testerSession
          ? fx.query(fx.collection(dbHandle,"tournaments"),fx.where("createdBy","==",actorUid),fx.where("eventAuthority","==","test"))
          : partnerSession
            ? fx.query(fx.collection(dbHandle,"tournaments"),fx.where("createdBy","==",actorUid),fx.where("partnerOrganizationCode","==",partnerOrganizerGrant().organizationId))
            : fx.collection(dbHandle,"tournaments");
        docs=(await fx.getDocs(source)).docs;
      }
      const items = [];
      docs.forEach(docSnap=>{
        const d = docSnap.data() || {};
        let savedState=null;
        try{savedState=typeof d.data==="string"?JSON.parse(d.data):d.data;}catch(e){}
        if(partnerSession&&(d.eventAuthority!=="official"||d.partnerOrganizationCode!==partnerOrganizerGrant().organizationId))return;
        if(eventStaffSession&&!((d.eventStaffAssignments||{})[actorUid]?.status==="accepted"))return;
        items.push({
          code: docSnap.id,
          name: d.name || "",
          eventDate: d.eventDate || "",
          startAt: d.startAt || "",
          location: d.location || "",
          posterUrl: typeof d.posterUrl==="string" ? d.posterUrl : "",
          battleMode:(d.battleMode||(savedState&&savedState.meta&&savedState.meta.battleMode))==="team"?"team":"individual",
          teamSize:Math.max(3,Number(d.teamSize||(savedState&&savedState.meta&&savedState.meta.teamSize))||3),
          formatType: d.formatType || "",
          ladderMode: d.ladderMode === "ranked" ? "ranked" : "general",
          testLadderEnabled: d.testLadderEnabled===true || savedState?.testLadderEnabled===true,
          ladderPointsAwarded: d.ladderPointsAwarded === true,
          ladderSeasonId: d.ladderSeasonId || null,
          ladderSkippedPlayers: Array.isArray(d.ladderSkippedPlayers) ? d.ladderSkippedPlayers : [],
          systemClosed:d.systemClosed===true,
          systemClosure:d.systemClosure||null,
          tournamentPhase: savedState?computeTournamentPhase(savedState):(d.tournamentPhase || "waiting"),
          archiveStatus: d.archiveStatus || "ongoing",
          registrationSelection:d.registrationSelection||null,registeredCount:Number(d.registeredCount||0),
          registrationEnabled: !!d.registrationEnabled,
          registrationStatus: d.registrationStatus || "",
          capacity: d.capacity || 0,
          confirmedCount: d.confirmedCount || 0,
          waitlistEnabled: !!d.waitlistEnabled,
          waitlistCapacity: d.waitlistCapacity || 0,
          waitlistCount: d.waitlistCount || 0,
          updatedAt: d.updatedAt || 0,
          visibility: d.visibility || "private",
          createdBy: d.createdBy || "",
          createdByName: d.createdByName || "",
          eventAuthority: d.eventAuthority || "official",
          ownerUid: d.ownerUid || null,
          partnerOrganizationCode:d.partnerOrganizationCode||null,
          partnerContractOrderCode:d.partnerContractOrderCode||null,
          expiresAt: d.expiresAt || null,
          testMode: d.testMode===true,
          testLabel: d.testLabel||null,
          createdByRole: d.createdByRole||null,
          testCreatedAt: d.testCreatedAt||null,
          testExpiresAt: d.testExpiresAt||d.expiresAt||null
        });
      });
      // v13.14.2：補齊賽事建立者名稱。新版賽事會直接保存 createdByName；
      // 舊版賽事若只有 createdBy UID，admin / super_admin 會嘗試從 users/{uid}
      // 補查顯示名稱。staff 若無 users 讀取權限則安全退回顯示 UID，不影響清單載入。
      const creatorIds = [...new Set(items.map(x=>x.createdBy).filter(Boolean))];
      const creatorNameMap = {};
      await Promise.all(creatorIds.map(async uid=>{
        try{
          const userSnap = await fx.getDoc(fx.doc(dbHandle, "users", uid));
          if(userSnap.exists()){
            const u = userSnap.data() || {};
            creatorNameMap[uid] = u.displayName || u.realName || u.nickname || "";
          }
        }catch(e){ /* staff 可能無 users 讀取權限；保留 UID 即可 */ }
      }));
      items.forEach(x=>{
        if(!x.createdByName && x.createdBy && creatorNameMap[x.createdBy]) x.createdByName = creatorNameMap[x.createdBy];
      });
      return items.sort((a,b)=>{
        const ad = String(a.eventDate||""), bd = String(b.eventDate||"");
        if(ad!==bd) return ad<bd ? 1 : -1;
        return Number(b.updatedAt||0)-Number(a.updatedAt||0);
      });
    },

    // v13.13.4：玩家「已報名」改為「先列出公開賽事，再逐場 get 自己的 registration」。
    // 原本使用 collectionGroup('registrations') + where(uid==currentUid)，在正式 Firestore
    // 環境可能因 collection-group 索引/Rules 查詢可證明性而直接拋出 failed-precondition
    // 或 permission-denied，導致玩家明明已成功報名，這個分頁卻只顯示未知錯誤。
    // 現在不需要 collection-group index；每筆 registration 仍只 get 自己 uid 的文件，
    // 因此沿用既有 Security Rules 的本人讀取限制，不會讀到其他玩家資料。
    async queryMyRegistrations(){
      const uid = (authReady && authHandle && authHandle.currentUser) ? authHandle.currentUser.uid : null;
      if(!uid) return [];

      const q = fx.query(
        fx.collection(dbHandle, "publicTournaments"),
        fx.where("visibility", "==", "public")
      );
      const tourSnap = await fx.getDocs(q);
      const codes = [];
      tourSnap.forEach(docSnap => codes.push(docSnap.id));
      if(codes.length===0) return [];

      const reads = await Promise.all(codes.map(async code=>{
        try{
          const regSnap = await fx.getDoc(fx.doc(dbHandle, "tournaments", code, "registrations", uid));
          if(!regSnap.exists()) return null;
          return Object.assign({ tournamentCode: code }, regSnap.data());
        }catch(e){
          // 一場讀取失敗不應讓整個「已報名」頁崩潰；但權限/連線類錯誤仍保留診斷資訊。
          console.warn("[queryMyRegistrations] registration read failed", code, e);
          return null;
        }
      }));

      return reads.filter(Boolean).sort((a,b)=>{
        const ta = a.createdAt && typeof a.createdAt.toMillis==="function" ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt && typeof b.createdAt.toMillis==="function" ? b.createdAt.toMillis() : 0;
        return tb-ta;
      });
    },

    // P3 Hunter Profile: reads only public tournament mirrors plus the signed-in user's own
    // registration documents. No new collection and no access to other players' private data.
    async queryMyHunterMatches(){
      const uid=(authReady&&authHandle&&authHandle.currentUser)?authHandle.currentUser.uid:null;
      if(!uid) return {ok:true,records:[],skipped:[]};
      const regs=await this.queryMyRegistrations();
      const selfRegs=(regs||[]).filter(r=>r&&r.status!=="cancelled"&&!r.familyPlayerId);
      const records=[],skipped=[];
      const idToken=v=>String(v||"").replace(/[^A-Za-z0-9_-]/g,"_");
      const cleanName=v=>String(v||"").trim().replace(/\s+/g," ").toLocaleLowerCase("zh-Hant");

      for(const reg of selfRegs){
        const code=String(reg.tournamentCode||"").toUpperCase();
        if(!code) continue;
        try{
          const snap=await fx.getDoc(fx.doc(dbHandle,"publicTournaments",code));
          if(!snap.exists()){ skipped.push({code,reason:"public-missing"}); continue; }
          const d=snap.data()||{};
          let runtime;
          try{ runtime=reconstructPublicStateFromDoc(code,d); }
          catch(e){ skipped.push({code,reason:"public-corrupt"}); continue; }
          runtime.cloudCode=code;
          runtime.meta=runtime.meta||{};
          runtime.meta.ladderMode=(d.ladderMode==="ranked"||runtime.meta.ladderMode==="ranked")?"ranked":"general";

          const players=Array.isArray(runtime.players)?runtime.players:[];
          const regId=String(reg.registrationId||reg.id||uid);
          const candidateIds=new Set([
            reg.localPlayerId,reg.playerId,reg.participantId,regId,uid,
            "reg_"+idToken(regId),"reg_"+idToken(uid)
          ].filter(Boolean).map(String));
          let participant=players.find(p=>p&&candidateIds.has(String(p.id||"")))||null;
          let identityConfidence="exact-id";

          if(!participant){
            const wantedNames=[reg.displayName,reg.publicName,reg.participantName,reg.realName]
              .map(cleanName).filter(Boolean);
            const byName=players.filter(p=>p&&wantedNames.includes(cleanName(p.name)));
            if(byName.length===1){
              participant=byName[0];
              identityConfidence="legacy-unique-name";
            }
          }
          if(!participant){
            skipped.push({code,reason:"identity-unresolved"});
            continue;
          }

          const built=buildHunterTournamentMatchRecords(runtime);
          built.forEach(rec=>{
            const side=rec.playerA&&rec.playerA.localPlayerId===participant.id?"A":
              (rec.playerB&&rec.playerB.localPlayerId===participant.id?"B":null);
            if(!side) return;
            const opponent=side==="A"?rec.playerB:rec.playerA;
            const scoreFor=side==="A"?rec.scoreA:rec.scoreB;
            const scoreAgainst=side==="A"?rec.scoreB:rec.scoreA;
            records.push(Object.assign({},rec,{
              participantLocalPlayerId:participant.id,
              playerSide:side,
              opponent:opponent||null,
              isWin:rec.winnerLocalPlayerId===participant.id,
              scoreFor:scoreFor==null?null:Number(scoreFor),
              scoreAgainst:scoreAgainst==null?null:Number(scoreAgainst),
              identityConfidence,
              dataTrust:rec.resultMethod==="quick_decision"?"quick-decision":(rec.analyzable?(identityConfidence==="exact-id"?"complete-round":"legacy-identity"):"round-incomplete"),
              roundsPerspective:(rec.rounds||[]).map(ev=>Object.assign({},ev,{
                perspective:ev.side===side?"for":"against",
                eventCode:rec.eventCode||code,
                eventName:rec.eventName||"",
                eventDate:rec.eventDate||"",
                matchId:rec.matchId||"",
                matchRound:rec.round,
                station:rec.station,
                opponentName:(opponent&&opponent.name)||"",
                isWin:rec.winnerLocalPlayerId===participant.id,
                scoreFor:scoreFor==null?null:Number(scoreFor),
                scoreAgainst:scoreAgainst==null?null:Number(scoreAgainst),
                resultMethod:rec.resultMethod||null,
                identityConfidence,
                dataTrust:rec.resultMethod==="quick_decision"?"quick-decision":(rec.analyzable?(identityConfidence==="exact-id"?"complete-round":"legacy-identity"):"round-incomplete")
              }))
            }));
          });
        }catch(e){
          console.warn("[queryMyHunterMatches] skipped",code,e);
          skipped.push({code,reason:"read-failed"});
        }
      }
      records.sort((a,b)=>Number(b.completedAt||b.confirmedAt||Date.parse(b.eventDate||"")||0)-Number(a.completedAt||a.confirmedAt||Date.parse(a.eventDate||"")||0));
      return {ok:true,records,skipped};
    },

    // 輕量讀取，供「已報名」分頁補上完整活動卡片資訊；只讀 publicTournaments
    // 的公開安全欄位，不含任何私人資料。
    async getPublicTournamentSummary(code){
      try{
        const snap = await fx.getDoc(fx.doc(dbHandle, "publicTournaments", code));
        if(!snap.exists()) return null;
        const d = snap.data();
        let parsedData=null;
        try{ parsedData=reconstructPublicStateFromDoc(code,d); }catch(e){}
        const view=Object.assign({code},d,{parsedData});
        return {
          systemClosed:d.systemClosed===true, eventCancelled:d.eventCancelled===true, registrationSelection:d.registrationSelection||null,
          name: d.name||"", date: d.eventDate||"", startAt: d.startAt||"",
          location: d.location||"", battleMode:(d.battleMode||(parsedData&&parsedData.meta&&parsedData.meta.battleMode))==="team"?"team":"individual",
          teamSize:Math.max(3,Number(d.teamSize||(parsedData&&parsedData.meta&&parsedData.meta.teamSize))||3),
          formatType: d.formatType||"", fee: d.fee,
          tournamentPhase: canonicalPublicTournamentPhase(view),
          registrationStatus: publicTournamentRegistrationLocked(view) ? "started" : (d.registrationStatus||""),
          archiveStatus: (parsedData&&parsedData.archiveStatus)||d.archiveStatus||"ongoing",
          parsedData
        };
      }catch(e){
        console.warn("[getPublicTournamentSummary] failed", code, e);
        return null;
      }
    },

    // 完整公開鏡像讀取，供賽事詳細頁使用（仍然只有公開安全欄位，因為
    // publicTournaments 這個集合本身就不含私人資料）。
    async getPublicTournamentFull(code){
      const snap = await fx.getDoc(fx.doc(dbHandle, "publicTournaments", code));
      if(!snap.exists()) return null;
      const d=snap.data();
      let parsedData=null;
      try{ parsedData=reconstructPublicStateFromDoc(code,d); }catch(e){}
      const out=Object.assign({code},d,{parsedData});
      out.tournamentPhase=canonicalPublicTournamentPhase(out);
      if(publicTournamentRegistrationLocked(out)) out.registrationStatus="started";
      return out;
    },

    // 玩家讀取自己在某一場賽事的報名狀態（單筆 get，Rules 允許本人讀取）。
    async getMyRegistrationForTournament(code){
      const uid = (authReady && authHandle && authHandle.currentUser) ? authHandle.currentUser.uid : null;
      if(!uid) return null;
      try{
        const snap = await fx.getDoc(fx.doc(dbHandle, "tournaments", code, "registrations", uid));
        if(!snap.exists()) return null;
        return snap.data();
      }catch(e){ return null; }
    },

    // 管理端即時監聽正取與備取；只處理伺服器已確認的快照。
    subscribeRegistrationsForAdmin(code, callback, onError){
      if(!cloudEnabled || !code) return ()=>{};
      const ref=fx.collection(dbHandle,"tournaments",String(code).toUpperCase(),"registrations");
      return fx.onSnapshot(ref,{includeMetadataChanges:true},snap=>{
        if(snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
        const rows=[];
        snap.forEach(docSnap=>rows.push(Object.assign({registrationId:docSnap.id},docSnap.data())));
        callback(rows);
      },onError);
    },

    // 管理端讀取完整 registration 文件；僅限 Rules 已授權的賽事管理者，
    // 因文件含聯絡資料，不可拿來實作「全體正式工作人員只看姓名」。
    async listRegistrationsForAdmin(code){
      const q = fx.collection(dbHandle, "tournaments", code, "registrations");
      const snap = await fx.getDocs(q);
      const results = [];
      snap.forEach(docSnap => { results.push(Object.assign({registrationId:docSnap.id},docSnap.data())); });
      return results;
    },

    // 隱私最小化名單：正式 staff/admin 可依既有 tournaments read Rules 跨賽事查看，
    // 回傳內容只含姓名與正取/備取狀態，不讀 registrations 子集合，因此不帶 phone/email。
    // 被正式指派的 event staff / 合作主辦也沿用其既有 tournament read 權限。
    async listRegistrationNamesForStaff(code){
      const eventCode=String(code||"").trim().toUpperCase();
      if(!eventCode) return [];
      const snap=await fx.getDoc(fx.doc(dbHandle,"tournaments",eventCode));
      if(!snap.exists()) throw Object.assign(new Error("not-found"),{code:"not-found"});
      const docData=snap.data()||{};
      let runtime={};
      try{ runtime=typeof docData.data==="string"?JSON.parse(docData.data):(docData.data||{}); }
      catch(e){ throw Object.assign(new Error("corrupt-state"),{code:"corrupt-state"}); }
      const rows=[];
      const append=(items,status)=>{
        (Array.isArray(items)?items:[]).forEach(player=>{
          if(!player)return;
          const publicName=String(player.name||player.displayName||player.publicName||"").trim();
          if(publicName)rows.push({status,publicName});
        });
      };
      append(runtime.players,"confirmed");
      append(runtime.waitlistPlayers,"waitlist");
      return rows;
    },

    async queryMyDutyLogs(){
      const uid=(authReady&&authHandle&&authHandle.currentUser)?authHandle.currentUser.uid:null;
      if(!uid) return [];
      const snap=await fx.getDocs(fx.collection(dbHandle,"staffActivityLogs",uid,"matches"));
      const items=[]; snap.forEach(ds=>items.push(Object.assign({id:ds.id},ds.data()||{})));
      return items.sort((a,b)=>Number(b.confirmedAt||0)-Number(a.confirmedAt||0));
    },

    // Real round-trip diagnostic: writes a small test document, reads it back,
    // deletes it, and reports exactly what happened at each stage (with the
    // raw Firebase error message if something fails) so this can be trusted
    // as ground truth rather than a guess.
    async testConnection(){
      const result = { configured:false, sdkLoaded:false, readOk:false, permissionLimited:false, latencyMs:null, error:null, projectId:FIREBASE_CONFIG.projectId||null, role:null };
      result.configured = isConfigPresent();
      if(!result.configured){ result.error = "尚未在 FIREBASE_CONFIG 填入設定值"; return result; }
      const t0 = Date.now();
      const ok = await tryInitFirebase();
      result.sdkLoaded = ok && cloudEnabled;
      if(!result.sdkLoaded){
        result.error = "Firebase SDK 初始化失敗（可能是網路被阻擋、專案設定錯誤，或此環境不允許對外連線）";
        return result;
      }
      try{
        const uid = (authReady && authHandle && authHandle.currentUser) ? authHandle.currentUser.uid : null;
        if(!uid) throw { code:"unauthenticated", message:"尚未登入 Firebase 帳號" };
        const snap = await fx.getDoc(fx.doc(dbHandle,"users",uid));
        result.readOk = snap.exists();
        if(snap.exists()){
          const d=snap.data()||{};
          result.role=d.role||null;
          result.permissionLimited = d.role==="staff";
        }
        result.latencyMs = Date.now()-t0;
      }catch(e){
        result.error = (e&&e.code) ? (e.code+"："+(e.message||"")) : String(e);
        result.latencyMs = Date.now()-t0;
      }
      return result;
    },

    async createCommunityRoom(data){
      if(!cloudEnabled || !data) throw Object.assign(new Error("cloud-disabled"),{code:"cloud-disabled"});
      const uid=currentUserUidForWrites();
      if(!uid) throw Object.assign(new Error("auth-not-ready"),{code:"auth-not-ready"});
      try{
        // Generate locally and let the atomic batch reject the rare collision.
        // Player accounts must not perform a preflight read against public mirrors.
        const code=generateRoomCode();
        const now=Date.now();
        data.meta=data.meta||{}; data.meta.eventAuthority="community"; data.meta.ladderMode="general"; data.meta.registrationEnabled=!!data.meta.registrationEnabled; data.meta.assignedStaffUids=[]; data.meta.roomAccessMode=data.meta.roomAccessMode==="password"?"password":"public";
        data.ownerUid=uid; data.createdByRole="player"; data.lastActivityAt=now;
        const hasStructure=(data.players||[]).some(p=>p&&p.isRoomOwner!==true)||(data.matches&&data.matches.length)||data.bracketSize;
        const expMs=data.expiresAtMs || now+(hasStructure?30*24*60*60*1000:6*60*60*1000); data.expiresAtMs=expMs;
        const regEnabled=!!data.meta.registrationEnabled;
        const regOpen=regEnabled?(data.meta.registrationOpenAt||now):null;
        const eventStartMs=Date.parse(String(data.meta.date||"")+"T"+String(data.meta.startTime||"23:59")+":00");
        const regClose=regEnabled?(data.meta.registrationCloseAt||(!isNaN(eventStartMs)?eventStartMs:now+7*24*60*60*1000)):null;
        const capacity=regEnabled?Math.max(1,Number(data.meta.registrationCapacity)||16):0;
        const waitlistCapacity=regEnabled?Math.max(0,Number(data.meta.waitlistCapacity)||0):0;
        const cancellationDeadline=regEnabled?(data.meta.cancellationDeadline||regClose):null;
        data.meta.registrationOpenAt=regOpen;
        data.meta.registrationCloseAt=regClose;
        data.meta.registrationCapacity=capacity;
        data.meta.waitlistCapacity=waitlistCapacity;
        data.meta.cancellationDeadline=cancellationDeadline;
        data.meta.registrationVisibility="public";
        data.meta.registrationStatus=regEnabled?"open":"closed";
        const base={
          eventAuthority:"community",ownerUid:uid,createdBy:uid,createdByName:currentUserDisplayNameForWrites(),createdByRole:"player",
          ladderMode:"general",ladderPointsAwarded:false,roomAccessMode:data.meta.roomAccessMode,roomAccessVersion:0,registrationEnabled:regEnabled,registrationStatus:regEnabled?"open":"closed",visibility:"public",
          registrationOpenAt:regOpen,registrationCloseAt:regClose,capacity,waitlistEnabled:waitlistCapacity>0,waitlistCapacity,
          confirmedCount:0,waitlistCount:0,registrationVisibility:"public",publishedAt:data.meta.publishedAt||now,
          cancellationDeadline,targetGroup:"open",participantNameMode:(data.meta.participantNameMode==="gameId"?"gameId":"realName"),
          tournamentPhase:computeTournamentPhase(data),archiveStatus:data.archiveStatus||"ongoing",name:data.meta.name||"",eventDate:data.meta.date||"",location:data.meta.location||"",startAt:data.meta.startTime||"",battleMode:data.meta.battleMode==="team"?"team":"individual",teamSize:Math.max(3,Number(data.meta.teamSize)||3),playMode:data.meta.playMode==="enchantment"?"enchantment":"standard",formatType:data.meta.formatType||"single",bracketSize:data.bracketSize||0,
          updatedAt:now,lastActivityAt:now,expiresAt:new Date(expMs)
        };
        const tournamentRef=fx.doc(dbHandle,"tournaments",code);
        const publicRef=fx.doc(dbHandle,"publicTournaments",code);
        const batch=fx.writeBatch(dbHandle);
        batch.set(tournamentRef,Object.assign({},base,{data:JSON.stringify(data)}));
        batch.set(publicRef,{
          bracketView:JSON.stringify(buildPublicMirrorFields(data)),updatedAt:now,visibility:"public",eventAuthority:"community",ownerUid:uid,ladderMode:"general",roomAccessMode:data.meta.roomAccessMode,roomAccessVersion:0,roomLocked:data.meta.roomAccessMode==="password",
          registrationEnabled:regEnabled,registrationStatus:regEnabled?"open":"closed",registrationOpenAt:regOpen,registrationCloseAt:regClose,
          capacity,waitlistEnabled:waitlistCapacity>0,waitlistCapacity,confirmedCount:0,waitlistCount:0,registrationVisibility:"public",
          publishedAt:data.meta.publishedAt||now,cancellationDeadline,targetGroup:"open",participantNameMode:(data.meta.participantNameMode==="gameId"?"gameId":"realName"),
          tournamentPhase:computeTournamentPhase(data),name:data.meta.name||"",eventDate:data.meta.date||"",location:data.meta.location||"",startAt:data.meta.startTime||"",battleMode:data.meta.battleMode==="team"?"team":"individual",teamSize:Math.max(3,Number(data.meta.teamSize)||3),playMode:data.meta.playMode==="enchantment"?"enchantment":"standard",formatType:data.meta.formatType||"single",lastActivityAt:now,expiresAt:new Date(expMs)
        });
        await batch.commit();
        return code;
      }catch(e){
        console.warn("[createCommunityRoom]",e);
        throw e;
      }
    },
    async queryMyCommunityEvents(){
      const uid=currentUserUidForWrites(); if(!uid) return [];
      // v13.23.8: player-owned room discovery must use the public mirror.
      // A list query against private tournaments must prove ALL owner rule
      // predicates (createdBy + ownerUid + eventAuthority) and can otherwise
      // be rejected/blocked by Firestore query authorization or composite-index
      // requirements. publicTournaments already has the safe room metadata and
      // supports the same single-field visibility query used by the lobby.
      const q=fx.query(fx.collection(dbHandle,"publicTournaments"),fx.where("visibility","==","public"));
      const snap=await fx.getDocs(q); const items=[];
      snap.forEach(ds=>{
        const d=ds.data()||{};
        if(d.eventAuthority!=="community" || d.ownerUid!==uid) return;
        let parsed=null;
        try{ parsed=d.bracketView?JSON.parse(d.bracketView):null; }catch(e){}
        items.push(Object.assign({code:ds.id,parsedData:parsed},d));
      });
      return items.sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
    },
    async queryMyCommunityHistory(){
      const uid=currentUserUidForWrites(); if(!uid) return [];
      const snap=await fx.getDocs(fx.collection(dbHandle,"communityHistories",uid,"events")); const items=[];
      snap.forEach(ds=>items.push(Object.assign({code:ds.id},ds.data()||{})));
      return items.sort((a,b)=>Number(b.completedAt||0)-Number(a.completedAt||0));
    },
    async saveCommunityHistory(st){
      const uid=currentUserUidForWrites(); if(!uid||!st||st.ownerUid!==uid||!(st.meta&&st.meta.eventAuthority==="community")||st.archiveStatus!=="completed") return false;
      const nameOf=id=>{const p=(st.players||[]).find(x=>x.id===id);return p?p.name:null;};
      const payload={ownerUid:uid,eventCode:st.cloudCode,name:st.meta.name||"",eventDate:st.meta.date||"",location:st.meta.location||"",formatType:st.meta.formatType||"single",format:st.meta.format||"",playerCount:(st.players||[]).length,championName:nameOf(st.championId),runnerUpName:nameOf(st.runnerUpId),thirdName:nameOf(st.thirdId),fourthName:nameOf(st.fourthId),completedAt:st.completedAt||Date.now(),updatedAt:Date.now(),eventAuthority:"community"};
      await fx.setDoc(fx.doc(dbHandle,"communityHistories",uid,"events",st.cloudCode),payload,{merge:true}); return true;
    },
    async deleteCommunityRoom(code){
      const uid=currentUserUidForWrites(); if(!uid||!code) throw new Error("auth-required");
      const ref=fx.doc(dbHandle,"tournaments",String(code).toUpperCase()); const snap=await fx.getDoc(ref); if(!snap.exists()) return true; const d=snap.data();
      if(d.eventAuthority!=="community"||d.createdBy!==uid) throw new Error("permission-denied");
      if(d.archiveStatus==="completed")await window.engagementService.syncMyHostingProgress({});
      await fx.deleteDoc(fx.doc(dbHandle,"publicTournaments",String(code).toUpperCase())); await fx.deleteDoc(ref); return true;
    },
    async cleanupMyExpiredCommunityRooms(){
      const items=await this.queryMyCommunityEvents(); const now=Date.now();
      for(const t of items){if(schedulePhase(t)==="done")continue;let ms=0;try{ms=t.expiresAt&&typeof t.expiresAt.toMillis==="function"?t.expiresAt.toMillis():0;}catch(e){} if(ms&&ms<=now){try{await this.deleteCommunityRoom(t.code);}catch(e){}}}
      return true;
    },

    async createRoom(data){
      if(!cloudEnabled) return null;
      try{
        // Generate the code locally. Do not preflight-read tournaments/{code}:
        // community hosts are not allowed to read private tournament documents
        // before they own one. The atomic create batch below prevents overwrites.
        const code = generateRoomCode();
        const creatorUid=currentUserUidForWrites();
        const partnerGrant=isPartnerOrganizerMode()?partnerOrganizerGrant():null;
        const partnerSession=!!(partnerGrant&&creatorUid);
        if(partnerSession&&partnerGrant.scope==="contract"&&window.BXHPartnerOrganizer?.remainingRooms?.(partnerGrant.orderCode)===0){
          throw Object.assign(new Error("partner-room-quota-exhausted"),{code:"partner-room-quota-exhausted"});
        }
        const testerSession=!!(userProfile&&userProfile.active!==false&&(userProfile.role==="tester"||userProfile.isTestAccount===true)&&creatorUid);
        if(testerSession){
          const created=Number(data.testCreatedAt||data.createdAt||Date.now());
          data.meta=data.meta||{};
          data.meta.name=ensureTestName(data.meta.name);
          data.meta.eventAuthority="test";
          data.meta.ladderMode="general";
          data.testMode=true;
          data.testCreatedAt=created;
          data.testExpiresAtMs=created+TEST_DATA_TTL_MS;
          data.expiresAtMs=data.testExpiresAtMs;
          data.createdBy=creatorUid;
          data.ownerUid=creatorUid;
          data.createdByRole="tester";
          data.ladderPointsAwarded=false;
        }
        if(partnerSession){
          data.meta=data.meta||{};
          data.meta.eventAuthority="official";
          data.meta.assignedStaffUids=[creatorUid];
          data.createdBy=creatorUid;
          data.createdByRole="partner_organizer";
          data.partnerOrganizationCode=partnerGrant.organizationId;
          data.partnerContractOrderCode=partnerGrant.orderCode||partnerGrant.contractOrderCode||userProfile.partnerContractOrderCode||null;
        }
        const m = (data && data.meta) || {};
        const lobbyVisibility = m.registrationVisibility==="private" ? "private" : "public";
        // BUG012: tester sandbox assignment normalization
        // A tester may only create a test tournament assigned to self (or none).
        // Clear stale admin/staff referee assignments carried by the draft before
        // registrationFields is built, so Firestore validTesterTestCreate() passes.
        if(testerSession){
          m.assignedStaffUids=[creatorUid];
          m.refereeStationAssignments={};
          m.refereeStationNames={};
          m.refereeStationRestrictionEnabled=false;
        }
        if(data && !data.createdBy) data.createdBy=creatorUid;
        if(data && data.meta && data.meta.eventAuthority==="community" && !data.ownerUid) data.ownerUid=creatorUid;
        const registrationFields = {
          registrationEnabled: !!m.registrationEnabled,
          registrationOpenAt: m.registrationOpenAt || null,
          registrationCloseAt: m.registrationCloseAt || null,
          registrationStatus: m.registrationStatus || null,
          capacity: m.registrationCapacity || null,
          waitlistEnabled: (Number(m.waitlistCapacity)||0) > 0,
          waitlistCapacity: m.waitlistCapacity || null,
          confirmedCount: 0,
          waitlistCount: 0,
          registrationVisibility: m.registrationVisibility || "public",
          publishedAt: m.publishedAt || null,
          eventDate: m.date || "",
          checkInAt: m.checkin || "",
          startAt: m.startTime || "",
          fee: (m.registrationFee!=null ? m.registrationFee : null),
          timezone: "Asia/Taipei",
          assignedStaffUids: Array.isArray(m.assignedStaffUids) ? m.assignedStaffUids : [],
          refereeStationAssignments: (m.refereeStationAssignments && typeof m.refereeStationAssignments==="object") ? m.refereeStationAssignments : {},
          refereeStationNames: (m.refereeStationNames && typeof m.refereeStationNames==="object") ? m.refereeStationNames : {},
          refereeStationUids: (()=>{ const out=[]; Object.values((m.refereeStationAssignments&&typeof m.refereeStationAssignments==="object")?m.refereeStationAssignments:{}).forEach(list=>{ if(Array.isArray(list)) list.forEach(uid=>{ if(uid&&!out.includes(uid)) out.push(uid); }); }); return out; })(),
          refereeStationRestrictionEnabled: !!m.refereeStationRestrictionEnabled,
          tournamentPhase: computeTournamentPhase(data),
          location: data.meta && data.meta.location || "",
          battleMode: data.meta && data.meta.battleMode==="team" ? "team" : "individual",
          teamSize: Math.max(3,Number(data.meta && data.meta.teamSize)||3),
          playMode: data.meta && data.meta.playMode==="enchantment" ? "enchantment" : "standard",
          formatType: data.meta && data.meta.formatType || "single",
          name: data.meta && data.meta.name || "",
          ladderMode: testerSession ? "general" : ((data.meta && data.meta.ladderMode==="ranked") ? "ranked" : "general"),
          targetGroup: (data.meta && (data.meta.targetGroup==="children"?"children":"open")) || "open",
          participantNameMode: (data.meta && data.meta.participantNameMode==="gameId") ? "gameId" : "realName",
          eventCancelled: !!(data.meta && data.meta.eventCancelled),
          cancellationDeadline: (data.meta && data.meta.cancellationDeadline) || null,
          eventDescription: (data.meta && data.meta.eventDescription) || "",
          registrationNotes: (data.meta && data.meta.registrationNotes) || "",
          eventAuthority: testerSession ? "test" : ((data.meta && data.meta.eventAuthority==="community") ? "community" : "official"),
          hostName: currentUserDisplayNameForWrites() || ((data.meta && data.meta.eventAuthority==="community") ? "玩家主辦" : "BXH")
        };
        const testFields=testerSession?{
          testMode:true,testLabel:"（測試）",ownerUid:creatorUid,createdByRole:"tester",
          testCreatedAt:data.testCreatedAt,testExpiresAt:new Date(data.testExpiresAtMs),expiresAt:new Date(data.testExpiresAtMs)
        }:{};
        // publicRegistrationFields: the SAME fields, minus assignedStaffUids —
        // that field is staff-roster data and has no business in a collection
        // unauthenticated readers can access (spec section 5).
        const publicRegistrationFields = Object.assign({}, registrationFields);
        delete publicRegistrationFields.assignedStaffUids;
        delete publicRegistrationFields.refereeStationAssignments;
        delete publicRegistrationFields.refereeStationNames;
        delete publicRegistrationFields.refereeStationUids;
        delete publicRegistrationFields.refereeStationRestrictionEnabled;
        const partnerPrivate=partnerSession?{
          createdByRole:"partner_organizer",
          partnerOrganizationCode:partnerGrant.organizationId,
          partnerContractOrderCode:data.partnerContractOrderCode
        }:{};
        const privatePayload=Object.assign({
          data: JSON.stringify(data),
          updatedAt: Date.now(),
          visibility: lobbyVisibility,
          createdBy: currentUserUidForWrites(),
          createdByName: currentUserDisplayNameForWrites(),
          // v13.13.2: private runtime mirrors. These are NOT copied to publicTournaments.
          bracketSize: (data && data.bracketSize) || 0,
          archiveStatus: (data && data.archiveStatus) || "ongoing",
          ladderPointsAwarded: data && data.ladderPointsAwarded===true,
          ladderSeasonId: (data && data.ladderSeasonId) || null
        }, registrationFields, testFields, partnerPrivate);
        const publicPayload=Object.assign({
          bracketView: JSON.stringify(buildPublicMirrorFields(data)),
          updatedAt: Date.now(),
          visibility: lobbyVisibility
        }, publicRegistrationFields, testFields);
        // Both documents must be created in one atomic batch. Beta Rules validate
        // the public mirror with getAfter(), which only sees the paired private
        // tournament when both writes are in the same batch.
        const batch=fx.writeBatch(dbHandle);
        batch.set(fx.doc(dbHandle,"tournaments",code),privatePayload);
        batch.set(fx.doc(dbHandle,"publicTournaments",code),publicPayload);
        if(partnerSession&&partnerGrant.scope==="contract"&&data.partnerContractOrderCode){
          batch.update(fx.doc(dbHandle,"partnerContracts",data.partnerContractOrderCode),{
            usedEvents:fx.increment(1),lastRoomCode:code
          });
        }
        await batch.commit();
        if(partnerSession&&typeof window!=="undefined")window.dispatchEvent(new Event("bxh-partner-room-created"));
        if(typeof window!=="undefined") window.__BXH_LAST_CLOUD_ERROR_CODE = null;
        return code;
      }catch(e){
        if(typeof window!=="undefined") window.__BXH_LAST_CLOUD_ERROR_CODE = (e&&e.code)||"unknown";
        console.warn("建立雲端賽事代碼失敗", e);
        return null;
      }
    },

    // Admin/staff use only — reads the FULL tournament document (includes
    // registrations with partial phone numbers etc). Guests must use
    // joinRoomPublic() instead, which the new Security Rules also enforce
    // server-side regardless of which function the client calls.
    // Returns a STRUCTURED result so the caller can show the right message
    // per spec section 5: {ok:true, data} | {ok:false, reason:'not-found'|'private'|'network'}.
    // 'private' specifically means the read was rejected by Security Rules
    // (permission-denied) — distinct from 'not-found', which is a clean,
    // rules-permitted read of a document that simply doesn't exist (see the
    // !exists() guard in the Rules themselves, which makes this distinction
    // possible instead of both cases throwing the same opaque error).
    async joinRoom(code){
      if(!cloudEnabled || !code) return { ok:false, reason:"network" };
      try{
        const snap = await fx.getDoc(fx.doc(dbHandle,"tournaments",String(code).toUpperCase()));
        if(!snap.exists()) return { ok:false, reason:"not-found" };
        const d = snap.data();
        const parsed = JSON.parse(d.data);
        if(d.ladderPointsAwarded===true) parsed.ladderPointsAwarded=true;
        if(d.ladderSeasonId) parsed.ladderSeasonId=d.ladderSeasonId;
        if(d.ladderAwardedAt) parsed.ladderAwardedAt=d.ladderAwardedAt;
        if(Array.isArray(d.ladderSkippedPlayers)) parsed.ladderSkippedPlayers=d.ladderSkippedPlayers;
        if(d.createdBy) parsed.createdBy=d.createdBy;
        if(d.ownerUid) parsed.ownerUid=d.ownerUid;
        if(d.createdByRole) parsed.createdByRole=d.createdByRole;
        if(d.partnerOrganizationCode) parsed.partnerOrganizationCode=d.partnerOrganizationCode;
        if(d.partnerContractOrderCode) parsed.partnerContractOrderCode=d.partnerContractOrderCode;
        if(d.testMode===true) parsed.testMode=true;
        if(d.testCreatedAt) parsed.testCreatedAt=d.testCreatedAt;
        if(d.testExpiresAt&&typeof d.testExpiresAt.toMillis==="function") parsed.testExpiresAtMs=d.testExpiresAt.toMillis();
        if(d.expiresAt&&typeof d.expiresAt.toMillis==="function") parsed.expiresAtMs=d.expiresAt.toMillis();
        parsed.meta=parsed.meta||{};
        if(Array.isArray(d.assignedStaffUids)) parsed.meta.assignedStaffUids=d.assignedStaffUids;
        if(d.refereeStationAssignments && typeof d.refereeStationAssignments==="object") parsed.meta.refereeStationAssignments=d.refereeStationAssignments;
        if(d.refereeStationNames && typeof d.refereeStationNames==="object") parsed.meta.refereeStationNames=d.refereeStationNames;
        if(d.refereeStationRestrictionEnabled!==undefined) parsed.meta.refereeStationRestrictionEnabled=!!d.refereeStationRestrictionEnabled;
        return { ok:true, data: parsed };
      }catch(e){
        console.warn("加入雲端賽事代碼失敗", e);
        if((e&&e.code)==="permission-denied") return { ok:false, reason:"private" };
        return { ok:false, reason:"network" };
      }
    },

    // Guest/public use — reads the filtered publicTournaments document only.
    async joinRoomPublic(code){
      if(!cloudEnabled || !code) return { ok:false, reason:"network" };
      try{
        const snap = await fx.getDoc(fx.doc(dbHandle,"publicTournaments",String(code).toUpperCase()));
        if(!snap.exists()) return { ok:false, reason:"not-found" };
        const d = snap.data();
        if(d.deletionStatus==="deleting" || d.visibility!=="public" || d.registrationVisibility==="private" || d.eventCancelled===true) return { ok:false, reason:"not-found" };
        const reconstructed = reconstructPublicStateFromDoc(snap.id, d);
        return { ok:true, data: reconstructed };
      }catch(e){
        console.warn("加入雲端賽事代碼失敗", e);
        if((e&&e.code)==="permission-denied") return { ok:false, reason:"private" };
        return { ok:false, reason:"network" };
      }
    },

    async repairLegacyPrivateVisibilityMirrors(){
      if(!cloudEnabled) return {ok:false,reason:"network",repaired:0};
      try{
        const [privateSnap,publicSnap]=await Promise.all([
          fx.getDocs(fx.collection(dbHandle,"tournaments")),
          fx.getDocs(fx.collection(dbHandle,"publicTournaments"))
        ]);
        const publicById=new Map();
        publicSnap.forEach(ds=>publicById.set(ds.id,ds.data()||{}));
        const repairs=[];
        privateSnap.forEach(ds=>{
          const d=ds.data()||{};
          let parsedMeta=null;
          if(typeof d.data==="string"){
            try{
              const parsed=JSON.parse(d.data);
              parsedMeta=parsed&&parsed.meta||null;
            }catch(e){}
          }
          const explicitlyPrivate=d.registrationVisibility==="private"
            || (parsedMeta&&parsedMeta.registrationVisibility==="private");
          if(!explicitlyPrivate) return; // fail-closed: never auto-publish anything.
          const pub=publicById.get(ds.id);
          const privateNeeds=d.visibility!=="private" || d.registrationVisibility!=="private"
            || !(parsedMeta&&parsedMeta.registrationVisibility==="private");
          const publicNeeds=!!pub && (pub.visibility!=="private" || pub.registrationVisibility!=="private");
          if(privateNeeds || publicNeeds){
            repairs.push({id:ds.id,privateDoc:d,parsedMeta,hasPublic:!!pub,privateNeeds,publicNeeds});
          }
        });
        let repaired=0;
        for(let offset=0;offset<repairs.length;offset+=200){
          const batch=fx.writeBatch(dbHandle);
          const chunk=repairs.slice(offset,offset+200);
          const now=Date.now();
          chunk.forEach(item=>{
            if(item.privateNeeds){
              const patch={visibility:"private",registrationVisibility:"private",updatedAt:now};
              if(typeof item.privateDoc.data==="string"){
                try{
                  const parsed=JSON.parse(item.privateDoc.data);
                  parsed.meta=parsed.meta||{};
                  parsed.meta.registrationVisibility="private";
                  parsed.updatedAt=now;
                  patch.data=JSON.stringify(parsed);
                }catch(e){}
              }
              batch.set(fx.doc(dbHandle,"tournaments",item.id),patch,{merge:true});
            }
            if(item.hasPublic && item.publicNeeds){
              batch.set(fx.doc(dbHandle,"publicTournaments",item.id),{
                visibility:"private",registrationVisibility:"private",updatedAt:now
              },{merge:true});
            }
          });
          await batch.commit();
          repaired+=chunk.length;
        }
        return {ok:true,repaired,scanned:privateSnap.size};
      }catch(e){
        const code=(e&&e.code)||"unknown";
        console.warn("[visibility sweep]",code,e);
        return {ok:false,reason:code,repaired:0};
      }
    },

    async syncTournamentVisibility(code, visibility){
      if(!cloudEnabled || !code) return { ok:false, reason:"network" };
      const normalized=String(code).toUpperCase();
      const next=visibility==="private" ? "private" : "public";
      try{
        await fx.runTransaction(dbHandle,async tx=>{
          const privateRef=fx.doc(dbHandle,"tournaments",normalized);
          const publicRef=fx.doc(dbHandle,"publicTournaments",normalized);
          const privateSnap=await tx.get(privateRef);
          if(!privateSnap.exists()) throw new Error("not-found");
          const publicSnap=await tx.get(publicRef);
          const now=Date.now();
          const privatePatch={visibility:next,registrationVisibility:next,updatedAt:now};
          const privateDoc=privateSnap.data()||{};
          if(typeof privateDoc.data==="string"){
            try{
              const parsed=JSON.parse(privateDoc.data);
              parsed.meta=parsed.meta||{};
              parsed.meta.registrationVisibility=next;
              parsed.updatedAt=now;
              privatePatch.data=JSON.stringify(parsed);
            }catch(e){}
          }
          tx.set(privateRef,privatePatch,{merge:true});
          if(publicSnap.exists()){
            tx.set(publicRef,{visibility:next,registrationVisibility:next,updatedAt:now},{merge:true});
          }
        });
        if(typeof window!=="undefined") window.__BXH_LAST_CLOUD_ERROR_CODE=null;
        return {ok:true,visibility:next};
      }catch(e){
        const code=(e&&e.code)||((e&&e.message)==="not-found"?"not-found":"unknown");
        if(typeof window!=="undefined") window.__BXH_LAST_CLOUD_ERROR_CODE=code;
        console.warn("[visibility sync]",code,e);
        return {ok:false,reason:code};
      }
    },

    async pushUpdate(code, data){
      if(!cloudEnabled || !code) return false;
      try{
        const actorUid=currentUserUidForWrites();
        const partnerGrant=isPartnerOrganizerMode()?partnerOrganizerGrant():null;
        const partnerSession=!!(partnerGrant&&actorUid);
        const testerSession=!!(userProfile&&userProfile.active!==false&&(userProfile.role==="tester"||userProfile.isTestAccount===true)&&actorUid);
const legacyTesterSandbox=!!(testerSession&&data&&data.createdBy===actorUid&&data.ownerUid===actorUid&&data.createdByRole==="tester"&&data.meta&&data.meta.ladderMode!=="ranked");
if(testerSession){
  if(!legacyTesterSandbox && (!data.testMode || !data.meta || data.meta.eventAuthority!=="test" || data.createdBy!==actorUid || data.ownerUid!==actorUid)) throw new Error("tester-official-write-blocked");
  if(legacyTesterSandbox) markTesterSandboxState(data);
          data.meta.name=ensureTestName(data.meta.name);
          data.meta.ladderMode="general";
          data.ladderPointsAwarded=false;
        }
        if(partnerSession){
          data.meta=data.meta||{};
          data.meta.eventAuthority="official";
          data.createdBy=data.createdBy||actorUid;
          data.createdByRole="partner_organizer";
          data.partnerOrganizationCode=partnerGrant.organizationId;
          data.partnerContractOrderCode=partnerGrant.orderCode||partnerGrant.contractOrderCode||userProfile.partnerContractOrderCode||data.partnerContractOrderCode||null;
        }
        const testRoom=data.testMode===true && data.meta?.eventAuthority==="test";
        if(testRoom){data.meta.name=ensureTestName(data.meta.name);data.meta.ladderMode="general";data.ladderPointsAwarded=false;}
        const m = (data && data.meta) || {};
        const lobbyVisibility = m.registrationVisibility==="private" ? "private" : "public";
        const registrationFields = {
          // Top-level fields mirrored from meta so Phase 2+ can query across
          // tournaments (e.g. "find open registration events") without needing
          // to parse the full JSON blob. Kept in sync on every push.
          registrationEnabled: !!m.registrationEnabled,
          registrationOpenAt: m.registrationOpenAt || null,
          registrationCloseAt: m.registrationCloseAt || null,
          registrationStatus: m.registrationStatus || null,
          capacity: m.registrationCapacity || null,
          waitlistEnabled: (Number(m.waitlistCapacity)||0) > 0,
          waitlistCapacity: m.waitlistCapacity || null,
          // v13.13.2: confirmedCount / waitlistCount are deliberately omitted here.
          // They are authoritative Transaction-owned counters and must never be reset by normal state sync.
          registrationVisibility: m.registrationVisibility || "public",
          publishedAt: m.publishedAt || null,
          eventDate: m.date || "",
          checkInAt: m.checkin || "",
          startAt: m.startTime || "",
          fee: (m.registrationFee!=null ? m.registrationFee : null),
          timezone: "Asia/Taipei",
          assignedStaffUids: Array.isArray(m.assignedStaffUids) ? m.assignedStaffUids : [],
          refereeStationAssignments: (m.refereeStationAssignments && typeof m.refereeStationAssignments==="object") ? m.refereeStationAssignments : {},
          refereeStationNames: (m.refereeStationNames && typeof m.refereeStationNames==="object") ? m.refereeStationNames : {},
          refereeStationUids: (()=>{ const out=[]; Object.values((m.refereeStationAssignments&&typeof m.refereeStationAssignments==="object")?m.refereeStationAssignments:{}).forEach(list=>{ if(Array.isArray(list)) list.forEach(uid=>{ if(uid&&!out.includes(uid)) out.push(uid); }); }); return out; })(),
          refereeStationRestrictionEnabled: !!m.refereeStationRestrictionEnabled,
          tournamentPhase: computeTournamentPhase(data),
          location: data.meta && data.meta.location || "",
          battleMode: data.meta && data.meta.battleMode==="team" ? "team" : "individual",
          teamSize: Math.max(3,Number(data.meta && data.meta.teamSize)||3),
          playMode: data.meta && data.meta.playMode==="enchantment" ? "enchantment" : "standard",
          formatType: data.meta && data.meta.formatType || "single",
          name: data.meta && data.meta.name || "",
          ladderMode: testRoom ? "general" : ((data.meta && data.meta.ladderMode==="ranked") ? "ranked" : "general"),
          targetGroup: (data.meta && (data.meta.targetGroup==="children"?"children":"open")) || "open",
          participantNameMode: (data.meta && data.meta.participantNameMode==="gameId") ? "gameId" : "realName",
          eventCancelled: !!(data.meta && data.meta.eventCancelled),
          cancellationDeadline: (data.meta && data.meta.cancellationDeadline) || null,
          eventDescription: (data.meta && data.meta.eventDescription) || "",
          registrationNotes: (data.meta && data.meta.registrationNotes) || "",
          eventAuthority: testRoom ? "test" : ((data.meta && data.meta.eventAuthority==="community") ? "community" : "official"),
          hostName: currentUserDisplayNameForWrites() || ((data.meta && data.meta.eventAuthority==="community") ? "玩家主辦" : "BXH")
        };
        const publicRegistrationFields = Object.assign({}, registrationFields);
        delete publicRegistrationFields.assignedStaffUids;
        delete publicRegistrationFields.refereeStationAssignments;
        delete publicRegistrationFields.refereeStationNames;
        delete publicRegistrationFields.refereeStationUids;
        delete publicRegistrationFields.refereeStationRestrictionEnabled;
        const community=(data.meta&&data.meta.eventAuthority)==="community";
        // COMMUNITY rooms do not use staff assignment. Community owner Rules
        // intentionally forbid changing assignedStaffUids, so never add that
        // admin-only field during ordinary player-room synchronization.
        if(community){ delete registrationFields.assignedStaffUids; delete registrationFields.refereeStationAssignments; delete registrationFields.refereeStationNames; delete registrationFields.refereeStationUids; delete registrationFields.refereeStationRestrictionEnabled; }
        const activityNow=Date.now();
        const communityExpiry=community && data.archiveStatus!=="completed" ? new Date(communityRoomExpiryMs(data)) : null;
        const communityPrivate=community?{eventAuthority:"community",ownerUid:data.ownerUid,createdByRole:"player",createdBy:data.ownerUid,ladderMode:"general",lastActivityAt:data.lastActivityAt||activityNow,expiresAt:communityExpiry}:{};
        const communityPublic=community?{eventAuthority:"community",ownerUid:data.ownerUid,ladderMode:"general",lastActivityAt:data.lastActivityAt||activityNow,expiresAt:communityExpiry}:{};
        const testExpiry=testRoom?new Date(Number(data.testExpiresAtMs||data.expiresAtMs)):null;
        const testPrivate=testRoom?{testMode:true,testLabel:"（測試）",eventAuthority:"test",ownerUid:data.ownerUid,createdBy:data.createdBy,createdByRole:"tester",ladderMode:"general",ladderPointsAwarded:false,testCreatedAt:Number(data.testCreatedAt||data.createdAt),testExpiresAt:testExpiry,expiresAt:testExpiry}:{};
        const testPublic=testRoom?{testMode:true,testLabel:"（測試）",eventAuthority:"test",ownerUid:data.ownerUid,createdByRole:"tester",ladderMode:"general",testCreatedAt:Number(data.testCreatedAt||data.createdAt),testExpiresAt:testExpiry,expiresAt:testExpiry}:{};
        const partnerPrivate=partnerSession?{eventAuthority:"official",createdBy:actorUid,createdByRole:"partner_organizer",partnerOrganizationCode:partnerGrant.organizationId,partnerContractOrderCode:data.partnerContractOrderCode}:{};
        const privatePayload=Object.assign({
          data: JSON.stringify(data),
          entrySelectionWriteRevision:Number(data.entrySelectionRevision||0),
          updatedAt: Date.now(),
          visibility: lobbyVisibility,
          // v13.13.2: keep private runtime mirrors current without touching registration counters.
          bracketSize: (data && data.bracketSize) || 0,
          archiveStatus: (data && data.archiveStatus) || "ongoing"
        }, registrationFields, communityPrivate, testPrivate, partnerPrivate);
        const publicPayload=Object.assign({
          bracketView: JSON.stringify(buildPublicMirrorFields(data)),
          updatedAt: Date.now(),
          visibility: lobbyVisibility
        }, publicRegistrationFields, communityPublic, testPublic);
        if(data.entrySelection?.mode==='registration'){
          delete privatePayload.capacity;delete publicPayload.capacity;
        }
        const normalized=String(code).toUpperCase();
        await fx.runTransaction(dbHandle,async tx=>{
          const ref=fx.doc(dbHandle,"tournaments",normalized),snap=await tx.get(ref);
          if(snap.exists()){
            const remoteDoc=snap.data()||{};
            if(Number(remoteDoc.callRevision||0)!==Number(data.callRevision||0)) throw new Error("call-state-stale");
            let remoteState=null;
            try{ remoteState=typeof remoteDoc.data==="string"?JSON.parse(remoteDoc.data):remoteDoc.data; }catch(e){}
            if(remoteState){
              if(Number(remoteState.registrationRosterRevision||0)!==Number(data.registrationRosterRevision||0)) throw new Error("registration-roster-stale");
              if(Number(remoteState.teamResultRevision||0)!==Number(data.teamResultRevision||0)) throw new Error("team-result-stale");
              if(data.generalClosureReason==="insufficient-eligible-players" &&
                 (remoteDoc.ladderPointsAwarded===true || remoteState.ladderPointsAwarded===true)) throw new Error("ladder-already-awarded");
              // Completed results are irreversible through ordinary whole-state sync.
              // A stale device must never roll a confirmed match (or completed archive)
              // back to "in progress"; corrections must use the explicit correction flow.
              if(remoteState.archiveStatus==="completed" && data.archiveStatus!=="completed") throw new Error("archive-state-stale");
              const incomingById=new Map((data.matches||[]).map(m=>[m.id,m]));
              for(const remoteMatch of (remoteState.matches||[])){
                if(!remoteMatch || remoteMatch.isBye || !remoteMatch.completed) continue;
                const incoming=incomingById.get(remoteMatch.id);
                if(!incoming || !incoming.completed || incoming.winnerId!==remoteMatch.winnerId){
                  throw new Error("match-state-stale");
                }
              }
            }

            // refereeStation* is transaction-owned. Whole-state saves may carry a stale
            // local copy, so always rebase those fields from the newest remote document
            // before writing the JSON blob or public mirror.
            const remoteMeta=(remoteState&&remoteState.meta)||{};
            const canonicalAssignments=(remoteDoc.refereeStationAssignments&&typeof remoteDoc.refereeStationAssignments==="object"&&!Array.isArray(remoteDoc.refereeStationAssignments))
              ? remoteDoc.refereeStationAssignments
              : ((remoteMeta.refereeStationAssignments&&typeof remoteMeta.refereeStationAssignments==="object"&&!Array.isArray(remoteMeta.refereeStationAssignments))?remoteMeta.refereeStationAssignments:{});
            const canonicalNames=(remoteDoc.refereeStationNames&&typeof remoteDoc.refereeStationNames==="object"&&!Array.isArray(remoteDoc.refereeStationNames))
              ? remoteDoc.refereeStationNames
              : ((remoteMeta.refereeStationNames&&typeof remoteMeta.refereeStationNames==="object"&&!Array.isArray(remoteMeta.refereeStationNames))?remoteMeta.refereeStationNames:{});
            const canonicalRestriction=remoteDoc.refereeStationRestrictionEnabled===undefined
              ? !!remoteMeta.refereeStationRestrictionEnabled
              : !!remoteDoc.refereeStationRestrictionEnabled;
            const canonicalUids=Array.isArray(remoteDoc.refereeStationUids)
              ? [...new Set(remoteDoc.refereeStationUids.map(String).filter(Boolean))]
              : (()=>{ const out=[]; Object.values(canonicalAssignments).forEach(list=>{ if(Array.isArray(list)) list.forEach(uid=>{ uid=String(uid||""); if(uid&&!out.includes(uid)) out.push(uid); }); }); return out; })();
            data.meta=data.meta||{};
            data.meta.refereeStationAssignments=canonicalAssignments;
            data.meta.refereeStationNames=canonicalNames;
            data.meta.refereeStationRestrictionEnabled=canonicalRestriction;
            const incomingAssigned=Array.isArray(data.meta.assignedStaffUids)?data.meta.assignedStaffUids.map(String).filter(Boolean):[];
            data.meta.assignedStaffUids=[...new Set(incomingAssigned.concat(canonicalUids))];
            privatePayload.data=JSON.stringify(data);
            // Community rooms are owned by a player and deliberately have no
            // top-level staff/referee assignment contract. Re-adding these
            // admin-only fields here makes an otherwise-valid community sync
            // fail Production Rules, leaving Firestore behind the local UI.
            if(!community){
              privatePayload.assignedStaffUids=data.meta.assignedStaffUids;
              privatePayload.refereeStationAssignments=canonicalAssignments;
              privatePayload.refereeStationNames=canonicalNames;
              privatePayload.refereeStationUids=canonicalUids;
              privatePayload.refereeStationRestrictionEnabled=canonicalRestriction;
            }else{
              delete privatePayload.assignedStaffUids;
              delete privatePayload.refereeStationAssignments;
              delete privatePayload.refereeStationNames;
              delete privatePayload.refereeStationUids;
              delete privatePayload.refereeStationRestrictionEnabled;
            }
            publicPayload.bracketView=JSON.stringify(buildPublicMirrorFields(data));
          }
          tx.set(ref,privatePayload,{merge:true});
          tx.set(fx.doc(dbHandle,"publicTournaments",normalized),publicPayload,{merge:true});
        });
        if(typeof window!=="undefined") window.__BXH_LAST_CLOUD_ERROR_CODE = null;
        return true;
      }catch(e){
        if(typeof window!=="undefined") window.__BXH_LAST_CLOUD_ERROR_CODE = (e&&e.message)==="registration-roster-stale" ? "registration-roster-stale" : (e&&e.code)||"unknown";
        console.warn("雲端同步寫入失敗", e);
        return false;
      }
    },

    async saveStaffAssignments(code, requestedUids){
      if(!cloudEnabled || !code || !fx.runTransaction) return {ok:false,reason:"cloud-unavailable"};
      const normalizedCode=String(code).toUpperCase();
      const ref=fx.doc(dbHandle,"tournaments",normalizedCode);
      const actorUid=(authHandle&&authHandle.currentUser&&authHandle.currentUser.uid)||null;
      if(!actorUid) return {ok:false,reason:"unauthenticated"};
      const requested=[...new Set((Array.isArray(requestedUids)?requestedUids:[]).map(v=>String(v||"").trim()).filter(Boolean))];
      try{
        const outcome=await fx.runTransaction(dbHandle,async tx=>{
          const snap=await tx.get(ref);
          if(!snap.exists()) throw new Error("not-found");
          const actorSnap=await tx.get(fx.doc(dbHandle,USERS_COLLECTION,actorUid));
          if(!actorSnap.exists()) throw new Error("unauthenticated");
          const actor=actorSnap.data()||{};
          const actorIsAdmin=actor.active===true&&actor.isTestAccount!==true&&(actor.role==="admin"||actor.role==="super_admin");
          if(!actorIsAdmin) throw new Error("permission-denied");

          const docData=snap.data()||{};
          let remoteState;
          try{ remoteState=typeof docData.data==="string"?JSON.parse(docData.data):docData.data; }catch(e){ throw new Error("corrupt-data"); }
          if(!remoteState||!remoteState.meta) throw new Error("corrupt-data");
          if(remoteState.archiveStatus==="completed") throw new Error("already-completed");

          // Referee station assignees are a stronger operational dependency than
          // the broad staff list. Never let a staff-list edit silently remove a
          // referee who is already bound to a Court.
          const refereeUids=Array.isArray(docData.refereeStationUids)
            ? docData.refereeStationUids.map(String).filter(Boolean)
            : (()=>{ const out=[]; Object.values(remoteState.meta.refereeStationAssignments||{}).forEach(list=>{ if(Array.isArray(list)) list.forEach(uid=>{ uid=String(uid||""); if(uid&&!out.includes(uid)) out.push(uid); }); }); return out; })();
          const assigned=[...new Set(requested.concat(refereeUids))];
          const now=Date.now();
          remoteState.meta.assignedStaffUids=assigned;
          remoteState.updatedAt=now;

          const patch={
            data:JSON.stringify(remoteState),
            updatedAt:now,
            assignedStaffUids:assigned
          };
          // Keep registration-selection guard aligned with the newest server
          // revision when this room uses the lottery/selection subsystem.
          if(Number(docData.entrySelectionRevision||0)>0){
            patch.entrySelectionWriteRevision=Number(docData.entrySelectionRevision);
          }
          tx.set(ref,patch,{merge:true});
          return {state:remoteState,assignedStaffUids:assigned};
        });

        const verify=fx.getDocFromServer?await fx.getDocFromServer(ref):await fx.getDoc(ref);
        if(!verify.exists()) return {ok:false,reason:"verify-not-found"};
        const vd=verify.data()||{};
        let parsed={};
        try{ parsed=typeof vd.data==="string"?JSON.parse(vd.data):(vd.data||{}); }catch(e){ return {ok:false,reason:"verify-mismatch"}; }
        const normalize=list=>[...new Set((Array.isArray(list)?list:[]).map(String).filter(Boolean))].sort();
        const expected=normalize(outcome.assignedStaffUids);
        const topLevel=normalize(vd.assignedStaffUids);
        const nested=normalize(parsed&&parsed.meta&&parsed.meta.assignedStaffUids);
        if(JSON.stringify(topLevel)!==JSON.stringify(expected)||JSON.stringify(nested)!==JSON.stringify(expected)){
          return {ok:false,reason:"verify-mismatch"};
        }
        if(typeof window!=="undefined") window.__BXH_LAST_CLOUD_ERROR_CODE=null;
        return {ok:true,verified:true,state:outcome.state,assignedStaffUids:outcome.assignedStaffUids};
      }catch(e){
        const reason=String((e&&e.code)||(e&&e.message)||"unknown");
        if(typeof window!=="undefined") window.__BXH_LAST_CLOUD_ERROR_CODE=reason;
        console.warn("儲存工作人員指派失敗",{operation:"saveStaffAssignments",code:reason,tournamentCode:normalizedCode});
        return {ok:false,reason};
      }
    },

    async saveRefereeStationAssignments(code, data, expectedConfig){
      if(!cloudEnabled || !code || !data || !fx.runTransaction) return {ok:false,reason:"cloud-unavailable"};
      try{
        const requestedMeta=data.meta||{};
        const requestedRaw=(requestedMeta.refereeStationAssignments&&typeof requestedMeta.refereeStationAssignments==="object"&&!Array.isArray(requestedMeta.refereeStationAssignments))?requestedMeta.refereeStationAssignments:{};
        const requestedRestriction=!!requestedMeta.refereeStationRestrictionEnabled;
        const normalizedCode=String(code).toUpperCase();
        const ref=fx.doc(dbHandle,"tournaments",normalizedCode);
        const publicRef=fx.doc(dbHandle,"publicTournaments",normalizedCode);
        const actorUid=(authHandle&&authHandle.currentUser&&authHandle.currentUser.uid)||null;
        if(!actorUid) return {ok:false,reason:"unauthenticated"};

        // v13.28.2: assignment changes merge into the newest server state inside
        // one transaction. A stale settings screen can no longer overwrite live
        // scores, advancement, or another Court's newer result.
        const outcome=await fx.runTransaction(dbHandle,async tx=>{
          const snap=await tx.get(ref);
          if(!snap.exists()) throw new Error("not-found");
          const actorSnap=await tx.get(fx.doc(dbHandle,USERS_COLLECTION,actorUid));
          if(!actorSnap.exists()) throw new Error("unauthenticated");
          const actor=actorSnap.data()||{};
          const docData=snap.data()||{};
          let remoteState;
          try{ remoteState=JSON.parse(docData.data); }catch(e){ throw new Error("corrupt-data"); }
          if(!remoteState||!remoteState.meta) throw new Error("corrupt-data");
          if(expectedConfig){
            // Older rooms may have the assignment only inside `data`. Compare
            // the effective state, ignoring empty station keys and UID order.
            const raw=docData.refereeStationAssignments&&typeof docData.refereeStationAssignments==="object"
              ?docData.refereeStationAssignments:(remoteState.meta.refereeStationAssignments||{});
            const normalize=value=>Object.keys(value||{}).sort((a,b)=>Number(a)-Number(b)).reduce((out,key)=>{
              const ids=Array.isArray(value[key])?[...new Set(value[key].map(String))].sort():[];
              if(ids.length) out[key]=ids;
              return out;
            },{});
            const currentRestriction=docData.refereeStationRestrictionEnabled===undefined
              ?!!remoteState.meta.refereeStationRestrictionEnabled:!!docData.refereeStationRestrictionEnabled;
            if(JSON.stringify(normalize(raw))!==JSON.stringify(normalize(expectedConfig.assignments))
              ||currentRestriction!==!!expectedConfig.restrictionEnabled) throw new Error("stale-assignment");
          }
          if(remoteState.archiveStatus==="completed") throw new Error("already-completed");
          const creator=docData.createdBy||remoteState.createdBy||null;
          const actorIsAdmin=actor.active===true&&actor.isTestAccount!==true&&(actor.role==="admin"||actor.role==="super_admin");
          const eventAuthority=docData.eventAuthority||(remoteState.meta&&remoteState.meta.eventAuthority)||"official";
          const actorIsCreator=actor.active===true&&actor.isTestAccount!==true&&actor.role==="staff"&&creator===actorUid&&eventAuthority==="official";
          const partnerGrant=actor.partnerOrganizer||{};
          const partnerExpiryRaw=partnerGrant.expiresAtMs||partnerGrant.expiresAt||0;
          const partnerExpiry=Number(partnerExpiryRaw)||Date.parse(String(partnerExpiryRaw))||0;
          const partnerStartRaw=partnerGrant.startsAtMs||partnerGrant.startsAt||0;
          const partnerStart=Number(partnerStartRaw)||Date.parse(String(partnerStartRaw))||0;
          const partnerOrder=String(partnerGrant.orderCode||actor.partnerContractOrderCode||"");
          const actorIsPartnerCreator=actor.active===true&&actor.isTestAccount!==true&&actor.role==="player"&&partnerGrant.status==="active"&&(!partnerStart||partnerStart<=Date.now())&&partnerExpiry>Date.now()
            &&creator===actorUid&&eventAuthority==="official"&&docData.createdByRole==="partner_organizer"&&docData.partnerOrganizationCode===partnerGrant.organizationId
            &&(partnerOrder?docData.partnerContractOrderCode===partnerOrder:!docData.partnerContractOrderCode);
          const actorIsTesterOwner=actor.active===true&&(actor.role==="tester"||actor.isTestAccount===true)&&creator===actorUid&&docData.ownerUid===actorUid&&docData.testMode===true&&eventAuthority==="test";
          if(!actorIsAdmin&&!actorIsCreator&&!actorIsPartnerCreator&&!actorIsTesterOwner) throw new Error("permission-denied");

          const stationCount=Math.max(1,Number(remoteState.meta.stations)||1);
          const requestedKeys=Object.keys(requestedRaw);
          if(requestedKeys.some(k=>!/^\d+$/.test(k)||Number(k)<1||Number(k)>stationCount)) throw new Error("invalid-station");
          const map={};
          const allUids=[];
          for(let station=1;station<=stationCount;station++){
            const source=Array.isArray(requestedRaw[String(station)])?requestedRaw[String(station)]:[];
            const clean=[];
            source.forEach(raw=>{
              const uid=String(raw||"").trim();
              if(uid&&!clean.includes(uid)) clean.push(uid);
              if(uid&&!allUids.includes(uid)) allUids.push(uid);
            });
            map[String(station)]=clean;
          }

          // Resolve names and validate active referee roles from the safe staff
          // directory. The actor's own users document is already authoritative.
          const directory={};
          for(const uid of allUids){
            if(uid===actorUid){ directory[uid]=actor; continue; }
            const eventAssignment=(docData.eventStaffAssignments||{})[uid];
            if(actorIsPartnerCreator&&eventAssignment&&eventAssignment.status==="accepted"&&eventAssignment.organizerUid===actorUid
              &&Array.isArray(eventAssignment.duties)&&eventAssignment.duties.some(duty=>duty==="referee"||duty==="head_referee")){
              directory[uid]={uid,displayName:eventAssignment.displayName,role:"event_staff",active:true};continue;
            }
            const directorySnap=await tx.get(fx.doc(dbHandle,"staffDirectory",uid));
            if(!directorySnap.exists()) throw new Error("invalid-referee");
            directory[uid]=directorySnap.data()||{};
          }
          const names={};
          for(let station=1;station<=stationCount;station++){
            names[String(station)]=map[String(station)].map(uid=>{
              const profile=directory[uid]||{};
              const validRole=actorIsTesterOwner?(uid===actorUid&&(profile.role==="tester"||profile.isTestAccount===true)):["staff","admin","super_admin","event_staff"].includes(profile.role);
              if(profile.active!==true||!validRole) throw new Error("invalid-referee");
              const displayName=String(profile.displayName||profile.realName||"").trim();
              if(!displayName) throw new Error("invalid-referee");
              return displayName;
            });
          }

          const assigned=Array.isArray(docData.assignedStaffUids)?docData.assignedStaffUids.slice():(Array.isArray(remoteState.meta.assignedStaffUids)?remoteState.meta.assignedStaffUids.slice():[]);
          allUids.forEach(uid=>{ if(!assigned.includes(uid)) assigned.push(uid); });
          if(creator&&!assigned.includes(creator)) assigned.push(creator);
          remoteState.createdBy=creator||remoteState.createdBy||null;
          remoteState.meta.refereeStationAssignments=map;
          remoteState.meta.refereeStationNames=names;
          remoteState.meta.refereeStationRestrictionEnabled=requestedRestriction;
          remoteState.meta.assignedStaffUids=assigned;
          const now=Date.now();
          remoteState.updatedAt=now;
          tx.set(ref,{data:JSON.stringify(remoteState),updatedAt:now,assignedStaffUids:assigned,refereeStationAssignments:map,refereeStationNames:names,refereeStationUids:allUids,refereeStationRestrictionEnabled:requestedRestriction},{merge:true});
          tx.set(publicRef,{bracketView:JSON.stringify(buildPublicMirrorFields(remoteState)),updatedAt:now,tournamentPhase:computeTournamentPhase(remoteState)},{merge:true});
          return {state:remoteState,map,names,restriction:requestedRestriction};
        });

        // Confirm both halves from the server. The UI reports success only when
        // the private source and public mirror expose the same saved config.
        const verifyPrivate=fx.getDocFromServer?await fx.getDocFromServer(ref):await fx.getDoc(ref);
        const verifyPublic=fx.getDocFromServer?await fx.getDocFromServer(publicRef):await fx.getDoc(publicRef);
        if(!verifyPrivate.exists()||!verifyPublic.exists()) return {ok:false,reason:"verify-not-found"};
        const vd=verifyPrivate.data()||{};
        let publicState={};
        try{ publicState=JSON.parse((verifyPublic.data()||{}).bracketView||"{}"); }catch(e){ return {ok:false,reason:"verify-mismatch"}; }
        const sameMap=JSON.stringify(vd.refereeStationAssignments||{})===JSON.stringify(outcome.map);
        const sameNames=JSON.stringify(vd.refereeStationNames||{})===JSON.stringify(outcome.names);
        const sameRestriction=!!vd.refereeStationRestrictionEnabled===outcome.restriction;
        const publicNames=publicState&&publicState.meta&&publicState.meta.refereeStationNames||{};
        const publicRestriction=!!(publicState&&publicState.meta&&publicState.meta.refereeStationRestrictionEnabled);
        if(!sameMap||!sameNames||!sameRestriction||JSON.stringify(publicNames)!==JSON.stringify(outcome.names)||publicRestriction!==outcome.restriction) return {ok:false,reason:"verify-mismatch"};
        if(typeof window!=="undefined") window.__BXH_LAST_CLOUD_ERROR_CODE=null;
        return {ok:true,verified:true,state:outcome.state};
      }catch(e){
        const errorCode=(e&&e.code)||(e&&e.message)||"unknown";
        if(typeof window!=="undefined") window.__BXH_LAST_CLOUD_ERROR_CODE=errorCode;
        console.warn("儲存裁判台分配失敗",{operation:"saveRefereeStationAssignments",code:errorCode,message:(e&&e.message)||String(e),tournamentCode:String(code).toUpperCase()});
        if(errorCode==="stale-assignment"){
          try{
            const latest=fx.getDocFromServer?await fx.getDocFromServer(ref):await fx.getDoc(ref);
            if(latest.exists()){
              const doc=latest.data()||{}, remote=JSON.parse(doc.data||"{}").meta||{};
              return {ok:false,reason:errorCode,latestConfig:{
                assignments:doc.refereeStationAssignments||remote.refereeStationAssignments||{},
                names:doc.refereeStationNames||remote.refereeStationNames||{},
                restrictionEnabled:doc.refereeStationRestrictionEnabled===undefined?!!remote.refereeStationRestrictionEnabled:!!doc.refereeStationRestrictionEnabled,
                assignedStaffUids:Array.isArray(doc.assignedStaffUids)?doc.assignedStaffUids:(remote.assignedStaffUids||[])
              }};
            }
          }catch(readError){ console.warn("讀取最新裁判分配失敗",readError); }
        }
        return {ok:false,reason:errorCode};
      }
    },

    // Court-scoped mutation: restricted staff always merge from newest cloud state.
    async mutateMatchTransaction(code, matchId, station, mutateFn, expectedActorUid, queueOptions={}){
      if(!cloudEnabled || !code || !fx.runTransaction) return {ok:false,reason:"cloud-unavailable"};
      const ref=fx.doc(dbHandle,"tournaments",String(code).toUpperCase());
      const publicRef=fx.doc(dbHandle,"publicTournaments",String(code).toUpperCase());
      try{
        const outcome=await fx.runTransaction(dbHandle,async tx=>{
          const snap=await tx.get(ref);
          if(!snap.exists()) throw new Error("not-found");
          const docData=snap.data();
          const actorUid=(authHandle&&authHandle.currentUser&&authHandle.currentUser.uid)||null;
          if(!actorUid || (expectedActorUid && expectedActorUid!==actorUid)) throw new Error("auth-mismatch");
          const actorSnap=await tx.get(fx.doc(dbHandle,USERS_COLLECTION,actorUid));
          const actor=actorSnap.exists()?actorSnap.data():{};
          const eventStaffAssignment=(docData.eventStaffAssignments&&docData.eventStaffAssignments[actorUid])||null;
          const actorIsEventReferee=actor.active===true&&eventStaffAssignment&&eventStaffAssignment.status==="accepted"
            &&eventStaffAssignment.targetUid===actorUid&&Array.isArray(eventStaffAssignment.duties)
            &&eventStaffAssignment.duties.some(duty=>duty==="referee"||duty==="head_referee");
          if((actor.role==="staff"||actorIsEventReferee) && docData.refereeStationRestrictionEnabled===true){
            const map=(docData.refereeStationAssignments&&typeof docData.refereeStationAssignments==="object")?docData.refereeStationAssignments:{};
            const list=Array.isArray(map[String(Number(queueOptions.targetStation||station))])?map[String(Number(queueOptions.targetStation||station))]:[];
            if(!list.includes(actorUid)) throw new Error("station-not-assigned");
          }
          let remoteState; try{ remoteState=JSON.parse(docData.data); }catch(e){ throw new Error("corrupt-data"); }
          if(remoteState.archiveStatus==="completed") throw new Error("already-completed");
          const remoteMatch=(remoteState.matches||[]).find(x=>x.id===matchId);
          if(!remoteMatch) throw new Error("not-found");
          if(Number(remoteMatch.station||0)!==Number(station||0)) throw new Error("station-mismatch");
          if(queueOptions.expectedRevision!=null && (remoteMatch.dispatchRevision||0)!==queueOptions.expectedRevision) throw new Error("dispatch-stale");
          if(queueOptions.targetStation!=null){
            if(actor.active===false) throw new Error("permission-denied");
            const privileged=["super_admin","admin","staff"].includes(actor.role)||actorIsEventReferee;
            const ownTest=(actor.role==="tester"||actor.isTestAccount===true) && remoteState.testMode===true && remoteState.meta&&remoteState.meta.eventAuthority==="test" && remoteState.ownerUid===actorUid && remoteState.createdBy===actorUid;
            const ownCommunity=remoteState.meta&&remoteState.meta.eventAuthority==="community" && remoteState.ownerUid===actorUid;
            if(!privileged&&!ownTest&&!ownCommunity) throw new Error("permission-denied");
          }
          const result=mutateFn(remoteState,remoteMatch);
          if(!result || !result.ok) throw new Error((result&&result.reason)||"validation-failed");
          const now=Math.max(Date.now(),Number(docData.updatedAt||0)+1,Number(remoteState.updatedAt||0)+1);
          result.state.updatedAt=now; rebuildPropagationForState(result.state);
          tx.set(ref,{data:JSON.stringify(result.state),updatedAt:now},{merge:true});
          tx.set(publicRef,{bracketView:JSON.stringify(buildPublicMirrorFields(result.state)),updatedAt:now,tournamentPhase:computeTournamentPhase(result.state)},{merge:true});
          return result;
        });
        return {ok:true,state:outcome.state};
      }catch(e){ return {ok:false,reason:(e&&e.message)||String(e)}; }
    },

    // Re-reads the tournament document inside a real Firestore transaction, hands the
    // freshest server-known state to validateAndApplyFn (which must return
    // {ok:true, state} or {ok:false, reason}), and only commits the write if the
    // caller's own validation approves it against that fresh data. If another device
    // changed the document between when this client last read it and now, this read
    // sees the newer data, so the win-condition check runs against reality, not a
    // stale local copy. If Firestore detects a write conflict during commit, it retries
    // the whole callback automatically (this is what runTransaction does), and if the
    // callback throws, the entire transaction is aborted with nothing written.
    // Also mirrors the result to publicTournaments/{code} (minus registrations) in the
    // SAME transaction, so guests watching live see the confirmed result immediately.
    // One-room structural rescue. This deliberately avoids rebuildPropagationForState:
    // it only fills the reviewed LB target slots and persists the override marker.
    async rescueC6bataTransaction(expectedFingerprint, expectedActorUid){
      const code="BXH-C6BATA";
      if(!cloudEnabled || !fx.runTransaction) return {ok:false,reason:"cloud-unavailable"};
      const actorUid=(authHandle&&authHandle.currentUser&&authHandle.currentUser.uid)||null;
      if(!actorUid || !expectedActorUid || actorUid!==expectedActorUid) return {ok:false,reason:"auth-mismatch"};
      const ref=fx.doc(dbHandle,"tournaments",code);
      const publicRef=fx.doc(dbHandle,"publicTournaments",code);
      try{
        const outcome=await fx.runTransaction(dbHandle,async tx=>{
          const snap=await tx.get(ref);
          if(!snap.exists()) throw new Error("not-found");
          const actorSnap=await tx.get(fx.doc(dbHandle,USERS_COLLECTION,actorUid));
          if(!actorSnap.exists()) throw new Error("unauthenticated");
          const actor=actorSnap.data()||{};
          if(actor.active!==true || actor.isTestAccount===true || actor.role!=="super_admin") throw new Error("permission-denied");
          const docData=snap.data()||{};
          let remoteState;
          try{ remoteState=typeof docData.data==="string"?JSON.parse(docData.data):docData.data; }catch(e){ throw new Error("corrupt-data"); }
          if(!remoteState || remoteState.cloudCode!==code || !remoteState.meta || remoteState.meta.formatType!=="double") throw new Error("room-or-format-mismatch");
          if(remoteState.c6bataRescueV1) throw new Error("rescue-already-committed");
          const rescue=window.BXHC6BataRescue;
          if(!rescue || typeof rescue.computePlan!=="function") throw new Error("rescue-module-unavailable");
          const plan=rescue.computePlan(remoteState);
          if(!plan.ok) throw new Error("dry-run-invalid:"+plan.errors.join(","));
          if(plan.fingerprint!==expectedFingerprint) throw new Error("dry-run-stale");
          if(!plan.operations.length || plan.operations.some(op=>!op.stopForManualScore || !op.otherPlayerId)) throw new Error("manual-match-stop-required");
          const matches=Array.isArray(remoteState.matches)?remoteState.matches:[];
          const protectedBefore=JSON.stringify(matches.map(m=>({id:m.id,completed:m.completed,scoreA:m.scoreA,scoreB:m.scoreB,winnerId:m.winnerId,loserId:m.loserId,log:m.log,faultActions:m.faultActions,hunterData:m.hunterData,confirmedBy:m.confirmedBy,confirmedAt:m.confirmedAt,resultMethod:m.resultMethod})));
          for(const op of plan.operations){
            const source=matches.find(m=>m&&m.id===op.sourceMatchId);
            const target=matches.find(m=>m&&m.id===op.targetMatchId);
            if(!source || source.bracket!=="LB" || source.completed===true || !target || target.bracket!=="LB" || target.completed===true) throw new Error("match-state-changed");
            if(target[op.targetSlot]) throw new Error("target-slot-not-empty:"+target.id+":"+op.targetSlot);
            const other=op.targetSlot==="a"?target.b:target.a;
            if(!other || other.type!=="player" || String(other.playerId)!==String(op.otherPlayerId)) throw new Error("target-opponent-changed:"+target.id);
            if(target.winnerId||target.loserId||Number(target.scoreA||0)!==0||Number(target.scoreB||0)!==0||target.completed===true||target.confirmedAt||target.confirmedBy||target.resultMethod||target.hunterData||(Array.isArray(target.log)&&target.log.length)||(Array.isArray(target.faultActions)&&target.faultActions.length)) throw new Error("target-has-result-data:"+target.id);
            target[op.targetSlot]={type:"player",playerId:op.playerId};
          }
          if(JSON.stringify(matches.map(m=>({id:m.id,completed:m.completed,scoreA:m.scoreA,scoreB:m.scoreB,winnerId:m.winnerId,loserId:m.loserId,log:m.log,faultActions:m.faultActions,hunterData:m.hunterData,confirmedBy:m.confirmedBy,confirmedAt:m.confirmedAt,resultMethod:m.resultMethod})))!==protectedBefore) throw new Error("protected-result-data-changed");
          const now=Math.max(Date.now(),Number(docData.updatedAt||0)+1,Number(remoteState.updatedAt||0)+1);
          remoteState.updatedAt=now;
          remoteState.c6bataRescueV1={
            version:1,roomCode:code,committedAt:now,committedBy:actorUid,fingerprint:plan.fingerprint,
            operations:plan.operations.map(op=>({sourceMatchId:op.sourceMatchId,targetMatchId:op.targetMatchId,targetSlot:op.targetSlot,playerId:op.playerId,otherPlayerId:op.otherPlayerId,deadSourceMatchIds:op.deadSourceMatchIds}))
          };
          tx.set(ref,{data:JSON.stringify(remoteState),updatedAt:now},{merge:true});
          tx.set(publicRef,{bracketView:JSON.stringify(buildPublicMirrorFields(remoteState)),updatedAt:now,tournamentPhase:computeTournamentPhase(remoteState)},{merge:true});
          return {state:remoteState,operationCount:plan.operations.length,protected:plan.protected};
        });
        return {ok:true,state:outcome.state,operationCount:outcome.operationCount,protected:outcome.protected};
      }catch(e){ return {ok:false,reason:(e&&e.message)||String(e)}; }
    },

    async confirmMatchTransaction(code, validateAndApplyFn, auditMeta){
      if(!cloudEnabled || !code || !fx.runTransaction){
        return { ok:false, reason:"cloud-unavailable" };
      }
      const ref = fx.doc(dbHandle, "tournaments", String(code).toUpperCase());
      const publicRef = fx.doc(dbHandle, "publicTournaments", String(code).toUpperCase());
      try{
        const outcome = await fx.runTransaction(dbHandle, async (tx)=>{
          const snap = await tx.get(ref);
          if(!snap.exists()) throw new Error("not-found");
          const docData = snap.data();
          if(auditMeta && auditMeta.station!=null){
            const actorUid=(authHandle&&authHandle.currentUser&&authHandle.currentUser.uid)||null;
            if(actorUid){
              const actorSnap=await tx.get(fx.doc(dbHandle,USERS_COLLECTION,actorUid));
              const actor=actorSnap.exists()?actorSnap.data():{};
              const eventStaffAssignment=(docData.eventStaffAssignments&&docData.eventStaffAssignments[actorUid])||null;
              const actorIsEventReferee=actor.active===true&&eventStaffAssignment&&eventStaffAssignment.status==="accepted"
                &&eventStaffAssignment.targetUid===actorUid&&Array.isArray(eventStaffAssignment.duties)
                &&eventStaffAssignment.duties.some(duty=>duty==="referee"||duty==="head_referee");
              if((actor.role==="staff"||actorIsEventReferee) && docData.refereeStationRestrictionEnabled===true){
                const map=(docData.refereeStationAssignments&&typeof docData.refereeStationAssignments==="object")?docData.refereeStationAssignments:{};
                const list=Array.isArray(map[String(Number(auditMeta.station))])?map[String(Number(auditMeta.station))]:[];
                if(!list.includes(actorUid)) throw new Error("station-not-assigned");
              }
            }
          }
          let remoteState;
          try{ remoteState = JSON.parse(docData.data); }catch(e){ throw new Error("corrupt-data"); }
          if(auditMeta&&auditMeta.matchId){
            const match=(remoteState.matches||[]).find(m=>m.id===auditMeta.matchId);
            if(!match || Number(match.station)!==Number(auditMeta.station)) throw new Error("station-mismatch");
            if(match.skippedAt || (auditMeta.dispatchRevision!=null && (match.dispatchRevision||0)!==auditMeta.dispatchRevision)) throw new Error("dispatch-stale");
          }
          const result = validateAndApplyFn(remoteState);
          if(!result || !result.ok) throw new Error((result && result.reason) || "validation-failed");
          const now=Date.now();
          const community=(result.state.meta&&result.state.meta.eventAuthority)==="community";
          if(community){ result.state.lastActivityAt=now; result.state.expiresAtMs=now+30*24*60*60*1000; }
          const extra=community?{lastActivityAt:now,expiresAt:new Date(result.state.expiresAtMs),eventAuthority:"community",ownerUid:result.state.ownerUid,ladderMode:"general",registrationEnabled:false,registrationStatus:"closed"}:{};
          tx.set(ref, Object.assign({ data: JSON.stringify(result.state), updatedAt: now },extra), { merge:true });
          tx.set(publicRef, Object.assign({ bracketView: JSON.stringify(buildPublicMirrorFields(result.state)), updatedAt: now, tournamentPhase: computeTournamentPhase(result.state) },extra), { merge:true });
          const actorUid=(authHandle&&authHandle.currentUser&&authHandle.currentUser.uid)||null;
          if(auditMeta && auditMeta.recordDuty===true && actorUid && auditMeta.uid===actorUid && !(userProfile&&(userProfile.role==="tester"||userProfile.isTestAccount===true))){
            const logId=String(code).toUpperCase()+"_"+String(auditMeta.matchId||"match");
            tx.set(fx.doc(dbHandle,"staffActivityLogs",actorUid,"matches",logId),{uid:actorUid,tournamentCode:String(code).toUpperCase(),tournamentName:auditMeta.tournamentName||"",matchId:auditMeta.matchId||"",station:Number(auditMeta.station||0),roundLabel:auditMeta.roundLabel||"",playerA:auditMeta.playerA||"",playerB:auditMeta.playerB||"",winnerName:auditMeta.winnerName||"",resultMethod:auditMeta.resultMethod||"",confirmedAt:now,eventAuthority:auditMeta.eventAuthority||"official"},{merge:true});
          }
          return result;
        });
        return { ok:true, state: outcome.state };
      }catch(e){
        return { ok:false, reason: (e && e.message) || String(e) };
      }
    },

    // callback(parsedData, updatedAt) 只會在「來自其他裝置的確認寫入」時觸發，
    // 不會因為自己剛剛送出的寫入而重複觸發一次自己
    // Admin/staff use only — subscribes to the FULL tournament document.
    subscribe(code, callback){
      if(!cloudEnabled || !code) return ()=>{};
      try{
        const ref = fx.doc(dbHandle,"tournaments",String(code).toUpperCase());
        const unsub = fx.onSnapshot(ref, { includeMetadataChanges:true }, (snap)=>{
          if(!snap.exists()) return;
          if(snap.metadata.hasPendingWrites) return; // 略過自己剛寫入、尚未確認的本地回音
          const d = snap.data();
          try{
            const parsed = JSON.parse(d.data);
            callback(parsed, d.updatedAt);
          }catch(e){}
        }, (err)=>{
          console.warn("雲端同步監聽發生錯誤，可能已離線", err);
        });
        return unsub;
      }catch(e){
        console.warn("建立雲端監聽失敗", e);
        return ()=>{};
      }
    },

    // Guest/public use — subscribes to the filtered publicTournaments document only.
    subscribePublic(code, callback){
      if(!cloudEnabled || !code) return ()=>{};
      try{
        const ref = fx.doc(dbHandle,"publicTournaments",String(code).toUpperCase());
        const unsub = fx.onSnapshot(ref, { includeMetadataChanges:true }, (snap)=>{
          if(!snap.exists()) return;
          if(snap.metadata.hasPendingWrites) return;
          const d = snap.data();
          try{
            const source = d.bracketView || d.data;
            if(!source) return;
            const parsed = JSON.parse(source);
            callback(parsed, d.updatedAt);
          }catch(e){
            console.warn("公開賽事即時資料解析失敗", e);
          }
        }, (err)=>{
          console.warn("雲端同步監聽發生錯誤，可能已離線", err);
        });
        return unsub;
      }catch(e){
        console.warn("建立雲端監聽失敗", e);
        return ()=>{};
      }
    },

    // Public, read-only live state for team battles. The callable scorer writes
    // JSON strings because Firestore does not support nested arrays.
    subscribeTeamLive(code, callback){
      if(!cloudEnabled || !code || typeof callback!=="function") return ()=>{};
      try{
        const ref = fx.doc(dbHandle,"publicTournaments",String(code).toUpperCase());
        return fx.onSnapshot(ref,{includeMetadataChanges:true},snap=>{
          if(!snap.exists() || snap.metadata.hasPendingWrites) return;
          const raw=snap.data()?.teamLiveGames;
          const games={};
          if(raw&&typeof raw==="object"){
            for(const [matchId,value] of Object.entries(raw)){
              try{games[matchId]=typeof value==="string"?JSON.parse(value):value;}catch(e){}
            }
          }
          callback(games,snap.data()?.updatedAt);
        },err=>console.warn("團體賽即時比分監聽發生錯誤",err));
      }catch(e){
        console.warn("建立團體賽即時比分監聽失敗",e);
        return ()=>{};
      }
    }
  };

  window.BXHCommitOfflineMatch=async function(op){
  if(!op||!op.tournamentCode||!window.cloudSync||!window.cloudSync.confirmMatchTransaction)return {ok:false,reason:"cloud-unavailable"};
  if(currentAuthUid()!==op.actorUid)return {ok:false,reason:"permission-denied"};
  return await window.cloudSync.confirmMatchTransaction(op.tournamentCode,(remoteState)=>{
    rebuildPropagationForState(remoteState);const m=(remoteState.matches||[]).find(x=>x.id===op.matchId);if(!m)return{ok:false,reason:"not-found"};
    if(m.completed||m.winnerId)return{ok:false,reason:"already-completed"};if(Number(m.station||0)!==Number(op.station||0))return{ok:false,reason:"station-mismatch"};
    if((m.dispatchRevision||0)!==(op.dispatchRevision||0))return{ok:false,reason:"dispatch-stale"};if(!m.a||!m.b||m.a.playerId!==op.playerAId||m.b.playerId!==op.playerBId)return{ok:false,reason:"player-mismatch"};
    let ev;if(op.mode==="quick_decision")ev=evaluateQuickDecision(m,op.selectedWinnerId);else{m.scoreA=op.scoreA;m.scoreB=op.scoreB;m.log=Array.isArray(op.log)?op.log:[];m.faultActions=Array.isArray(op.faultActions)?op.faultActions:[];ev=evaluateMatchCompletion(m);}
    if(!ev.ok||ev.winnerId!==op.selectedWinnerId)return{ok:false,reason:(ev&&ev.reason)||"validation-failed"};if(op.mode==="quick_decision")applyQuickDecisionFields(m,ev,op.actorName);else applyMatchCompletionFields(m,ev,op.actorName);
    delete m.offlinePendingSync;delete m.offlineOperationQueuedAt;rebuildPropagationForState(remoteState);return{ok:true,state:remoteState};
  },op.auditMeta||{});
};
window.addEventListener("bxh-offline-operation-synced",(e)=>{try{const d=e.detail||{},op=d.op||{},r=d.result||{};if(state.cloudCode&&String(state.cloudCode).toUpperCase()===String(op.tournamentCode||"").toUpperCase()&&r.state){const keep=state.cloudCode;state=Object.assign(defaultState(r.state.id),r.state);state.cloudCode=keep;rebuildPropagation();saveRecord(state);cloudStatus="connected";cloudLastSyncAt=Date.now();render();}showToast("離線賽事資料已完成雲端同步");}catch(err){}});
window.addEventListener("bxh-offline-operation-conflict",()=>{cloudStatus="error";render();showToast("離線資料與雲端賽事發生衝突，系統已停止自動覆寫，請由管理員確認。",true);});
window.addEventListener("bxh-offline-operation-failed",()=>{cloudStatus="error";render();showToast("離線資料多次同步失敗，已停止自動重試並保留紀錄，請確認網路後再處理。",true);});


  tryInitFirebase().then((ok)=>{
    window.dispatchEvent(new CustomEvent("bxh-cloud-ready", { detail:{ enabled: ok, configured: isConfigPresent() } }));
  });
