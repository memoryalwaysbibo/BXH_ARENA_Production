# DB-01 197-record acceptance on Windows, without merging or deploying ARENA.
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
foreach ($cmd in @("git","node","npm","java")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Required command missing: $cmd" }
}
$nodeMajor = [int]((& node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -ne 22) { throw "Node.js 22 required (current: $nodeMajor)." }
if (Test-Path -LiteralPath $checkout) { throw "Test checkout already exists. Move/remove $checkout after backing up, then retry." }
& git clone --depth 1 --branch $branch $repoUrl $checkout
if ($LASTEXITCODE -ne 0) { throw "Git clone failed." }
Push-Location $checkout
try {
  $env:BXH_CATALOG_DATA01B_FILE = $fixture
  & npm install --no-save --no-package-lock --ignore-scripts "firebase@12.4.0" "@firebase/rules-unit-testing@5.0.0" "firebase-tools@15.30.0"
  if ($LASTEXITCODE -ne 0) { throw "Dependency install failed. No Emulator write attempted." }
  & node --test "tests/bey-catalog-emulator/data01b-preflight.test.cjs"
  if ($LASTEXITCODE -ne 0) { throw "Preflight test failed. No Emulator write attempted." }
  & node "tests/bey-catalog-emulator/data01b-preflight.cjs"
  if ($LASTEXITCODE -ne 0) { throw "Private fixture verification failed. No Emulator write attempted." }
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
