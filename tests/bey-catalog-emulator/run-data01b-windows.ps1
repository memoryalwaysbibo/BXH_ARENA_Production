# DB-01 197-record acceptance on Windows, without merging or deploying ARENA.
param([switch]$PreflightOnly)
# Run from a private folder alongside catalog-research.json.
# Requires Node.js 22, Java 21, Git and npm internet access.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repoUrl = "https://github.com/memoryalwaysbibo/BXH_ARENA_Production.git"
$branch = "test/bey-catalog-data01b-private-emulator-20261009"
$expectedSha = "2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42"
$fixture = Join-Path $PSScriptRoot "catalog-research.json"
$checkout = Join-Path $PSScriptRoot "BXH_ARENA_DB01_TEST"
$log = Join-Path $PSScriptRoot "DB01_197_Emulator_Result.txt"
if (-not (Test-Path -LiteralPath $fixture -PathType Leaf)) { throw "Missing catalog-research.json beside this script." }
$actualSha = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha -ne $expectedSha) { throw "DATA01B_SHA256_MISMATCH. Refusing to proceed." }
foreach ($cmd in @("git","node")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Required command missing: $cmd" }
}
$nodeMajor = [int]((& node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -ne 22) { throw "Node.js 22 required (current: $nodeMajor)." }
if (Test-Path -LiteralPath $checkout) {
  if (-not (Test-Path -LiteralPath (Join-Path $checkout ".git"))) { throw "Existing checkout is not a Git repository. No files overwritten." }
  $origin = (& git -C $checkout remote get-url origin).Trim()
  $currentBranch = (& git -C $checkout branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $origin -ne $repoUrl -or $currentBranch -ne $branch) {
    throw "Existing checkout origin or branch does not match expected test repository. No files overwritten."
  }
  Write-Host "Reusing verified local test checkout." -ForegroundColor Cyan
} else {
  & git clone --depth 1 --branch $branch $repoUrl $checkout
  if ($LASTEXITCODE -ne 0) { throw "Git clone failed." }
}
Push-Location $checkout
try {
  $env:BXH_CATALOG_DATA01B_FILE = $fixture
  # Always validate the genuine fixture before checking Java/npm.
  & node --test "tests/bey-catalog-emulator/data01b-preflight.test.cjs"
  if ($LASTEXITCODE -ne 0) { throw "Preflight test failed. No Emulator write attempted." }
  & node "tests/bey-catalog-emulator/data01b-preflight.cjs"
  if ($LASTEXITCODE -ne 0) { throw "Private fixture verification failed. No Emulator write attempted." }
  Write-Host "PASS: original DATA-01B 197-record SHA, manifest and 9 collections verified." -ForegroundColor Green
  if ($PreflightOnly) {
    Write-Host "PREFLIGHT_ONLY: No Java, npm or Firestore Emulator required. No database writes." -ForegroundColor Yellow
    return
  }
  if (-not (Get-Command "java" -ErrorAction SilentlyContinue)) {
    throw "JAVA_21_REQUIRED: preflight PASSED. Install Temurin JDK 21 (https://adoptium.net/temurin/releases/?version=21) and open a new PowerShell window, then rerun."
  }
  $javaVersion = (& java -version 2>&1 | Out-String)
  if ($javaVersion -notmatch '(?:version |openjdk )"?21(?:[.+-]|")') {
    throw "JAVA_21_REQUIRED: installed Java is not version 21. Preflight PASSED; no Emulator write attempted."
  }
  if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) { throw "NPM_REQUIRED: install Node.js 22 with npm." }
  & npm install --no-save --no-package-lock --ignore-scripts "firebase@12.4.0" "@firebase/rules-unit-testing@5.0.0" "firebase-tools@15.30.0"
  if ($LASTEXITCODE -ne 0) { throw "Dependency install failed. No Emulator write attempted." }
  $command = "node tests/bey-catalog-emulator/data01b-full-import.cjs"
  $output = & (Join-Path $checkout "node_modules/.bin/firebase.cmd") emulators:exec --only firestore --project demo-bxh-catalog-db01 --config tests/bey-catalog-emulator/firebase.json $command 2>&1
  $exit = $LASTEXITCODE
  $output | Out-File -LiteralPath $log -Encoding utf8
  if ($exit -ne 0) { throw "Firestore Emulator acceptance FAILED. Inspect DB01_197_Emulator_Result.txt (no fixture data should be printed)." }
  $resultLine = $output | Where-Object { $_ -match '"verifiedDocuments":197' } | Select-Object -Last 1
  if (-not $resultLine -or $resultLine -notmatch '"manualCorrectionPreserved":true' -or $resultLine -notmatch '"published":0') {
    throw "Emulator completed but required acceptance evidence missing. Do not mark DB-01 complete."
  }
  Write-Host "PASS: real 197-document Firestore Emulator acceptance. Report: $log" -ForegroundColor Green
} finally {
  Remove-Item Env:BXH_CATALOG_DATA01B_FILE -ErrorAction SilentlyContinue
  Pop-Location
}
