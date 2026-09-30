# BXH ARENA Management UI V2

Status: isolated design/build branch only
Branch: feature/management-ui-v2
Production main: untouched

## Guardrails
- Keep existing BXH header and top navigation placement.
- Base/default skin is the structural reference; SKIN themes remain presentation-only.
- Do not alter tournament scoring, Firestore schema, referee result logic, bracket logic, registration transactions, or permissions.
- Existing tab keys and handlers remain canonical.
- V2 changes navigation/information architecture only.

## Current canonical admin tabs
management, inventory-admin, member-raffles, ladder, live, bracket, referee, duty, registrations, settings, people, operations, history, version.

## V2 groups
### 賽事
- management 賽事管理
- registrations 報名管理
- settings 賽事設定
- people 人員管理

### 現場
- live 即時戰況
- bracket 對戰表
- referee 裁判台
- duty 我的執勤

### 排行
- ladder 天梯排行

### 活動
- member-raffles 會員抽獎管理 (permission gated)
- inventory-admin 道具管理 (super admin only)

### 系統
- operations 抽獎與維護
- history 賽事紀錄
- version 版本更新

## Role filtering
V2 must apply existing permission predicates before rendering a group or child item. It must not grant access by navigation visibility.

## Mobile
Top-level group rail remains horizontal at the top. The active group's child rail appears directly below it. No left sidebar. The current active child remains centered on explicit tab switches. Live re-renders preserve horizontal scroll.

## Rollback
Removing V2 navigation wiring restores the existing flat tab rail. No data migration is required.
