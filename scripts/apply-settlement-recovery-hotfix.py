from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
index_path = root / "index.html"
verify_path = root / "scripts" / "verify-production-frontend.cjs"
version_path = root / "version.json"

html = index_path.read_text(encoding="utf-8")
verify = verify_path.read_text(encoding="utf-8")
version = json.loads(version_path.read_text(encoding="utf-8"))

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

old_controls = '''    ${canArchive && phase==="failed" ? `<button class="btn btn-primary" data-action="archive-complete">重試封存</button>` : ""}
    ${canArchive && phase!=="failed" ? `<span class="hint">最終結果確認後由系統自動結算並封存，不需最高管理員再次確認。</span>` : ""}'''
new_controls = '''    ${canArchive && phase!=="idle" ? `<button class="btn btn-primary" data-action="archive-complete">${phase==="failed"?"重試封存":"重新嘗試結算"}</button>` : ""}
    ${canArchive && phase!=="failed" ? `<span class="hint">最終結果確認後由系統自動結算並封存，不需最高管理員再次確認。${phase!=="idle"?" 若狀態長時間未更新，可使用「重新嘗試結算」安全續跑。":""}</span>` : ""}'''
html = replace_once(html, old_controls, new_controls, "settlement recovery controls")

old_build = str(version.get("build") or "")
old_version = str(version.get("version") or "")
new_build = "20260923.33"
new_version = "v14.0.57"

if old_build != "20260923.32" or old_version != "v14.0.56":
    raise SystemExit(f"unexpected release baseline: {old_version} / {old_build}")

html = replace_once(html, f'<meta name="bxh-build" content="{old_build}">', f'<meta name="bxh-build" content="{new_build}">', "meta build")
html = replace_once(html, f'var CURRENT_BUILD="{old_build}";', f'var CURRENT_BUILD="{new_build}";', "runtime build")
html = replace_once(html, f'const APP_VERSION = "{old_version}";', f'const APP_VERSION = "{new_version}";', "app version")

history_anchor = 'const VERSION_HISTORY = [\n'
history_entry = '''  {version:"v14.0.57",date:"2026/09/23",timezone:"Asia/Taipei",title:"結算卡住手動恢復入口",updateLevel:"patch",added:["結算中的 processing／ladder／archive／sync-pending 狀態新增「重新嘗試結算」入口"],changed:["保留既有自動封存；手動重試沿用 performAutoArchive 冪等流程，不建立第二套結算邏輯"],fixed:["避免賽事完成後若停在天梯結算中，因非 failed 狀態而沒有任何可操作的恢復入口"],environment:"Production / HTML + Firebase",deployStatus:"Frontend settlement recovery hotfix",firebaseImpact:"無資料結構變更",securityRulesImpact:"無",permissionImpact:"沿用既有賽事操作權限",publicSummary:"賽事若長時間停在結算中，管理者可直接安全重試結算，不必等待系統自行恢復。"},\n'''
html = replace_once(html, history_anchor, history_anchor + history_entry, "version history")

guard = '''
must(/canArchive && phase!==["']idle["'][\\s\\S]*?data-action=["']archive-complete["'][\\s\\S]*?重新嘗試結算/, 'Stuck settlement phases must expose a manual retry action');
mustInclude('若狀態長時間未更新，可使用「重新嘗試結算」安全續跑。','Settlement recovery guidance missing');
mustNot(/canArchive && phase===["']failed["'] \\? `<button class="btn btn-primary" data-action="archive-complete">重試封存<\\/button>`/, 'Settlement retry must not be limited to failed state only');
console.log('PASS settlement stuck-state manual recovery');
'''
if "PASS settlement stuck-state manual recovery" not in verify:
    verify += guard

version.update({
    "build": new_build,
    "version": new_version,
    "updatedAt": "2026-09-23T16:12:00+08:00",
})

index_path.write_text(html, encoding="utf-8")
verify_path.write_text(verify, encoding="utf-8")
version_path.write_text(json.dumps(version, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("settlement recovery hotfix applied")
