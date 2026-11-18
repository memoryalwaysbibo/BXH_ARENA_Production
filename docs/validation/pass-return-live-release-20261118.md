# PASS 自動回補正式站相容發布

正式站基準為 commitrefereecommand-00009-jij，更新時間 2026-11-17T18:18:22.123991980Z，來源世代 1794939464063954。

已核對來源指紋：

| 檔案 | SHA-256 |
| --- | --- |
| engine/index.cjs | 3e40412b390fac6115c9e93771fd1a15961b3a053956bf013497740fa811eb0b |
| dispatch-core.cjs | 4be700ad894bf35b95e1da39585544ad14d596df5c12d00362d0ec93a90efe3b |
| scoring-core.cjs | 093b6d4e1cec11c3b3bd6a45d3ed2c51f72ff9818893f33992d35ce955c806a5 |

線上計分檔以 transition 直接執行並推進賽程；repo 另有 perform/transitionLocal 的計分拆分與公開 meta 同步。本次覆蓋不帶入這些差異。原有匯出、計分流程與其他來源檔保持原樣。

## 變更範圍

- engine/index.cjs：精確替換六個 PASS/空台相關函式並載入新模組；保留既有引擎匯出及其他函式。
- dispatch-core.cjs：載入新模組，僅在 PASS 等待條件滿足時開放人工回補。
- scoring-core.cjs：載入新模組、阻止未正式回補的場次送分，公開必要的回補狀態欄位。
- 新增 engine/pass-return.cjs。

## 驗證

使用實際線上引擎（原 capture 加已部署的 #815 精確差異）、使用者提供的線上計分檔、已核對的派台檔執行：

- 原有依序派台檢查 10 案，包含 24/128/320 人完整賽程，通過。
- PASS、派台權限與既有計分測試 50 項通過，包含帶 PASS 的 24/128/320 人完整賽程。
- 所有現有模組匯出不變、原始輸入不變、四檔指紋被竄改時拒絕、危險 ZIP 路徑拒絕，皆通過。
- 正式執行會在下載的整包原始來源中重跑以上 60 項檢查，再允許部署。

## 執行

operator/BXH817_release.py 預設只準備與驗證；--apply 才部署。--check-source DIR 可離線驗證已解開的基準來源，不存取 Google Cloud。

部署前重新核對來源世代、設定、更新時間與候選檔案，留下完整原始 ZIP、還原來源及回滾指令。部署後核對 ACTIVE、函式設定、三個修改檔、新增模組與 index.js/package.json/package-lock.json 的來源讀回。

本分支只提供相容發布工具。後端部署成功並貼回讀回結果後，再合併 PR #817 觸發前端發布；此文件不代表正式站已部署。
