$ErrorActionPreference = 'Stop'

function Invoke-NpmStrict {
    param([Parameter(Mandatory = $true)][string[]]$NpmArgs)
    Write-Host "`n> npm $($NpmArgs -join ' ')" -ForegroundColor Cyan
    & npm @NpmArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: npm $($NpmArgs -join ' ')"
    }
}

function Run-NpmCheck {
    param([Parameter(Mandatory = $true)][string[]]$NpmArgs)
    Write-Host "`n> npm $($NpmArgs -join ' ')" -ForegroundColor Cyan
    & npm @NpmArgs | Out-Host
    $code = $LASTEXITCODE
    if ($code -eq 0) {
        Write-Host "PASS: npm $($NpmArgs -join ' ')" -ForegroundColor Green
    } else {
        Write-Host "FAIL (exit $code): npm $($NpmArgs -join ' ')" -ForegroundColor Red
    }
    return $code
}

$root = (Get-Location).Path
$packagePath = Join-Path $root 'package.json'
$lockPath = Join-Path $root 'package-lock.json'
if (!(Test-Path $packagePath) -or !(Test-Path $lockPath)) {
    throw 'Run this script from the studyrunway-agent project root (the folder containing package.json and package-lock.json).'
}
$package = Get-Content $packagePath -Raw | ConvertFrom-Json
if ($package.name -ne 'studyrunway-agent') {
    throw "Unexpected package name '$($package.name)'. Refusing to modify this directory."
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$packageBackup = "$packagePath.before-security-update-$stamp"
$lockBackup = "$lockPath.before-security-update-$stamp"
Copy-Item $packagePath $packageBackup
Copy-Item $lockPath $lockBackup
Write-Host "Created backups:`n  $packageBackup`n  $lockBackup" -ForegroundColor Yellow

# Compatible line updates: stay on Playwright 1.x, Vitest 3.x, ESLint 9.x,
# and the existing PostCSS major. The overrides address vulnerable transitive
# copies brought in by Next.js and Tailwind's dependency graph.
Invoke-NpmStrict @(
    'install', '--save-dev', '--save-exact',
    '@playwright/test@1.64.1',
    'vitest@3.2.7',
    'postcss@8.5.23',
    'postcss-selector-parser@7.1.6',
    '@types/node@^22.12.0',
    '@eslint/js@^9',
    'eslint@^9'
)

Invoke-NpmStrict @(
    'pkg', 'set',
    'overrides.postcss=8.5.23',
    'overrides.postcss-selector-parser=7.1.6'
)

# Regenerate and verify the lockfile using the current registry state.
Invoke-NpmStrict @('install')
Invoke-NpmStrict @('ci')

# Run all project gates and capture failures without hiding the actual output.
$failures = [System.Collections.Generic.List[string]]::new()
$checks = @(
    [pscustomobject]@{ Label = 'npm run typecheck'; Args = @('run', 'typecheck') },
    [pscustomobject]@{ Label = 'npm run lint'; Args = @('run', 'lint') },
    [pscustomobject]@{ Label = 'npm test'; Args = @('test') },
    [pscustomobject]@{ Label = 'npm run build'; Args = @('run', 'build') }
)
foreach ($check in $checks) {
    $code = Run-NpmCheck -NpmArgs $check.Args
    if ($code -ne 0) { $failures.Add($check.Label) }
}

# Install the browser that matches the upgraded Playwright release.
$code = Run-NpmCheck -NpmArgs @('exec', '--', 'playwright', 'install', 'chromium')
if ($code -ne 0) { $failures.Add('npm exec -- playwright install chromium') }

$code = Run-NpmCheck -NpmArgs @('run', 'e2e', '--', '--workers=1')
if ($code -ne 0) { $failures.Add('sequential E2E suite') }
$code = Run-NpmCheck -NpmArgs @('run', 'e2e')
if ($code -ne 0) { $failures.Add('parallel E2E suite') }

Write-Host "`n=== Production dependency audit (exit 1 means findings remain) ===" -ForegroundColor Cyan
& npm audit --omit=dev
$prodAudit = $LASTEXITCODE
Write-Host "`n=== Full dependency audit (exit 1 means findings remain) ===" -ForegroundColor Cyan
& npm audit
$fullAudit = $LASTEXITCODE

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
if ($failures.Count -eq 0) {
    Write-Host 'All type, lint, unit, build, and E2E commands passed.' -ForegroundColor Green
} else {
    Write-Host 'Some functional checks failed:' -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
if ($prodAudit -eq 0) {
    Write-Host 'Production dependency audit: PASS' -ForegroundColor Green
} else {
    Write-Host "Production dependency audit: findings remain (exit $prodAudit). Review the report above." -ForegroundColor Yellow
}
if ($fullAudit -eq 0) {
    Write-Host 'Full dependency audit: PASS' -ForegroundColor Green
} else {
    Write-Host "Full dependency audit: findings remain (exit $fullAudit). The braces advisory currently has no upstream patched release; do not conceal it or use --force blindly." -ForegroundColor Yellow
}
Write-Host "Backups were retained at:`n  $packageBackup`n  $lockBackup" -ForegroundColor Yellow

if ($failures.Count -gt 0) { exit 1 }
if ($prodAudit -ne 0 -or $fullAudit -ne 0) { exit 2 }
