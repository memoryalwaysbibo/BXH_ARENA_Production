# DB-01 197-record acceptance on Windows, without merging or deploying ARENA.
param([switch]$PreflightOnly, [switch]$InstallJava)
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

# Offline integrity gate: no Java, Node, npm, Git or network required.
# The fixed raw SHA binds the file to the independently reviewed 197-record manifest.
if ($PreflightOnly) {
  $batch = Get-Content -LiteralPath $fixture -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($batch.batchId -ne "DATA-01B-20261009" -or
      $batch.dataOrigin -ne "source-tiered-research" -or
      $batch.productionWritable -ne $false -or
      $batch.autoPublish -ne $false) {
    throw "DATA01B_METADATA_MISMATCH"
  }
  $counts = [ordered]@{
    sources = 23; products = 9; parts = 45; variants = 11; colors = 9;
    options = 14; assemblyClaims = 16; contentClaims = 52; issues = 18
  }
  $total = 0
  foreach ($section in $counts.Keys) {
    $actual = @($batch.$section).Count
    if ($actual -ne $counts[$section]) {
      throw "DATA01B_SECTION_COUNT_MISMATCH: $section ($actual / $($counts[$section]))"
    }
    $total += $actual
  }
  if ($total -ne 197) { throw "DATA01B_EXPECTED_197" }
  Write-Host "PASS: genuine DATA-01B original SHA-256, 197 records, 9 sections and safe flags." -ForegroundColor Green
  Write-Host "PREFLIGHT_ONLY: no Java, Node, Git, npm or Firestore writes required." -ForegroundColor Yellow
  return
}

# Explicit opt-in installer. Never installs anything during normal or offline runs.
if ($InstallJava) {
  $java21Available = $false
  if (Get-Command "java" -ErrorAction SilentlyContinue) {
    $installedVersion = (& cmd.exe /d /c "java -version 2>&1" | Out-String)
    $java21Available = $installedVersion -match '(?:version |openjdk )"?21(?:[.+-]|")'
  }
  if ($java21Available) {
    Write-Host "Java 21 already available. No installation required." -ForegroundColor Green
    return
  }
  if (-not (Get-Command "winget" -ErrorAction SilentlyContinue)) {
    throw "WINGET_REQUIRED: install Eclipse Temurin JDK 21 manually from https://adoptium.net/temurin/releases/?version=21"
  }
  Write-Host "Installing Eclipse Temurin JDK 21 using winget (may prompt for Windows permission)." -ForegroundColor Cyan
  & winget install --id EclipseAdoptium.Temurin.21.JDK --exact --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "JAVA_INSTALL_FAILED: winget exited $LASTEXITCODE. No Emulator write attempted." }
  Write-Host "Java installer completed. Close this terminal, open a new PowerShell window, run java -version, then rerun without -InstallJava." -ForegroundColor Yellow
  return
}

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
  # Never silently run an older checkout. Fast-forward only when tracked
  # files are unchanged; do not reset, clean, overwrite or delete user files.
  $trackedChanges = @(& git -C $checkout status --porcelain --untracked-files=no)
  if ($LASTEXITCODE -ne 0) { throw "CHECKOUT_STATUS_FAILED: no files overwritten." }
  if ($trackedChanges.Count -gt 0 -and ($trackedChanges -join "").Trim().Length -gt 0) {
    throw "CHECKOUT_HAS_LOCAL_CHANGES: save local edits and retry. No files overwritten."
  }
  & git -C $checkout fetch --depth 1 origin $branch
  if ($LASTEXITCODE -ne 0) { throw "CHECKOUT_FETCH_FAILED: unable to verify latest branch. No Emulator write attempted." }
  $before = (& git -C $checkout rev-parse HEAD).Trim()
  $latest = (& git -C $checkout rev-parse FETCH_HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $before -or -not $latest) { throw "CHECKOUT_REVISION_INVALID" }
  if ($before -ne $latest) {
    & git -C $checkout merge --ff-only FETCH_HEAD
    if ($LASTEXITCODE -ne 0) { throw "CHECKOUT_NOT_FAST_FORWARD: manual review required. No files overwritten." }
    Write-Host "Updated test checkout to the latest verified branch." -ForegroundColor Cyan
  } else {
    Write-Host "Reusing verified up-to-date test checkout." -ForegroundColor Cyan
  }
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
  if (-not (Get-Command "java" -ErrorAction SilentlyContinue)) {
    throw "JAVA_21_REQUIRED: preflight PASSED. Install Temurin JDK 21 (https://adoptium.net/temurin/releases/?version=21) and open a new PowerShell window, then rerun."
  }
  # Windows PowerShell 5.1 may treat java -version stderr as terminating error.
  $javaVersion = (& cmd.exe /d /c "java -version 2>&1" | Out-String)
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
