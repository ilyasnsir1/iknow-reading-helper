[CmdletBinding()]
param(
    [ValidateSet('Menu','Complete','Voices','Repair')][string]$Mode = 'Menu',
    [string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'iKnowLesehilfe'),
    [string[]]$ExtensionId = @()
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
if ($CacheRoot.Length -lt 12 -or $CacheRoot -eq [IO.Path]::GetPathRoot($CacheRoot)) { throw 'Invalid storage directory.' }
$encoding = New-Object Text.UTF8Encoding($false)
$python = Join-Path $CacheRoot 'runtime/python/python.exe'
$statePath = Join-Path $CacheRoot 'setup-state.json'
$logPath = Join-Path $CacheRoot 'logs/setup-latest.log'
$transcribing = $false

function Show-Creator {
    $font = @{
        i = @('  #  ','     ',' ##  ','  #  ','  #  ','  #  ',' ### ')
        l = @(' ##  ','  #  ','  #  ','  #  ','  #  ','  #  ',' ### ')
        y = @('     ','     ',' #  #',' #  #','  ###','    #',' ### ')
        a = @('     ','     ',' ### ','    #',' ####',' #  #',' ####')
        s = @('     ','     ',' ####',' #   ',' ### ','    #',' ####')
        n = @('     ','     ',' ### ',' #  #',' #  #',' #  #',' #  #')
        r = @('     ','     ',' # ##',' ##  ',' #   ',' #   ',' #   ')
        '1' = @('  #  ',' ##  ','  #  ','  #  ','  #  ','  #  ',' ### ')
    }
    Write-Host ''
    for ($row = 0; $row -lt 7; $row++) {
        $line = foreach ($letter in 'ilyasnsir1'.ToCharArray()) { $font[[string]$letter][$row] }
        Write-Host ('  ' + ($line -join ' ')) -ForegroundColor Cyan
    }
    Write-Host ''
    Write-Host '  Created by ilyasnsir1' -ForegroundColor Cyan
}

function Get-RememberedSelection {
    $selected = @{ course = $false; neural = $false; legacy = $false }
    if (Test-Path -LiteralPath $statePath) {
        try {
            $saved = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($saved.schemaVersion -eq 1) {
                foreach ($key in @('course','neural','legacy')) { if ($saved.selected.$key -is [bool]) { $selected[$key] = $saved.selected.$key } }
            }
        } catch { Write-Host 'Previous setup state could not be read; installed components will be checked.' }
    }
    if ((Test-Path -LiteralPath (Join-Path $CacheRoot 'runtime-config.json')) -or
        (Test-Path -LiteralPath (Join-Path $CacheRoot 'models/Qwen3.5-9B-Q4_K_M.gguf'))) { $selected.course = $true }
    if ((Test-Path -LiteralPath (Join-Path $CacheRoot 'neural/installation.json')) -or
        (Test-Path -LiteralPath (Join-Path $CacheRoot 'neural/runtime'))) { $selected.neural = $true }
    if ((Test-Path -LiteralPath (Join-Path $CacheRoot 'python-packages/.word-voice-requirements-sha256')) -or
        (Test-Path -LiteralPath (Join-Path $CacheRoot 'python-packages/pyopenjtalk'))) { $selected.legacy = $true }
    return $selected
}

function Save-SetupState($Selected, [bool]$Complete) {
    $state = @{ schemaVersion = 1; selected = $Selected; lastMode = $Mode; lastAttemptAt = [DateTime]::UtcNow.ToString('o'); completed = $Complete }
    $temporary = $statePath + '.tmp'
    [IO.File]::WriteAllText($temporary, ($state | ConvertTo-Json -Depth 4), $encoding)
    Move-Item -LiteralPath $temporary -Destination $statePath -Force
}

function Read-ComponentAudit($Selected) {
    $result = & $python (Join-Path $PSScriptRoot 'setup_check.py') --cache-root $CacheRoot --verify-audio
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect installed components.' }
    $audit = $result -join "`n" | ConvertFrom-Json
    foreach ($key in @('course','legacy')) {
        if (-not $Selected[$key]) { continue }
        $result = & $python (Join-Path $PSScriptRoot 'setup_check.py') --cache-root $CacheRoot --expect $key --verify-audio
        # Exit1 means this component needs repair, not that its audit failed.
        if ($LASTEXITCODE -notin @(0,1)) { throw 'Could not inspect installed audio libraries.' }
        $checked = $result -join "`n" | ConvertFrom-Json
        $audit.$key = $checked.$key
        if (-not $checked.python.installed) { $audit.python = $checked.python }
    }
    if ($audit.schemaVersion -ne 1) { throw 'Unexpected component audit format.' }
    return $audit
}

function Test-SelectedComponents($Selected) {
    $checks = @()
    if ($Selected.course) { $checks += 'course' }
    if ($Selected.neural) { $checks += 'voices' }
    if ($Selected.legacy) { $checks += 'legacy' }
    foreach ($check in $checks) {
        $result = & $python (Join-Path $PSScriptRoot 'setup_check.py') --cache-root $CacheRoot --expect $check --verify-audio
        if ($LASTEXITCODE -ne 0) {
            Write-Host ($result -join "`n")
            throw ('The ' + $check + ' verification did not pass. Run Check / repair to retry.')
        }
        $verified = $result -join "`n" | ConvertFrom-Json
        $key = if ($check -eq 'voices') { 'neural' } else { $check }
        if (-not $verified.python.installed -or -not $verified.$key.installed) { throw ('Incomplete verification for ' + $check) }
        Write-Host ('  ' + $check + ': verified') -ForegroundColor Green
    }
}

$exitCode = 1
try {
    Write-Host ''
    Write-Host '  iKnow! Reading Helper | Setup' -ForegroundColor Cyan
    Write-Host '  Keep the application in its permanent folder.'
    Write-Host ''
    Write-Host '  First load the extension in Brave:'
    Write-Host '  brave://extensions > Developer mode > Load unpacked'
    Write-Host ('  Folder: ' + [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../extension')))
    Write-Host ''
    if ($Mode -eq 'Menu') {
        Write-Host '  [1] Complete installation   ~8 GB on a fresh PC'
        Write-Host '      Mao Plain, Nise, German, colors and audio timings'
        Write-Host '  [2] Voices only             ~2 GB on a fresh PC'
        Write-Host '      Mao Plain and Nise; no course language-model download'
        Write-Host '  [3] Check / repair'
        Write-Host '      Check existing components; repair only previously selected features'
        Write-Host '  [0] Exit'
        Write-Host ''
        do {
            $choice = Read-Host '  Choose 1, 2, 3 or 0'
            if ($choice -eq '0') { exit 0 }
            if ($choice -notin @('1','2','3')) {
                if ([Console]::IsInputRedirected -and [string]::IsNullOrWhiteSpace($choice)) { throw 'No setup option was selected. No downloads were started.' }
                Write-Host '  Please enter 1, 2, 3 or 0.'
            }
        } while ($choice -notin @('1','2','3'))
        $Mode = @{ '1' = 'Complete'; '2' = 'Voices'; '3' = 'Repair' }[$choice]
    }
    $selected = Get-RememberedSelection
    if ($Mode -eq 'Repair' -and -not ($selected.course -or $selected.neural -or $selected.legacy)) {
        Write-Host 'No installation was found. Open Setup.cmd and choose Complete installation or Voices only.'
        exit 2
    }
    $requested = @{ course = ($Mode -eq 'Complete'); neural = ($Mode -in @('Complete','Voices')); legacy = ($Mode -eq 'Complete') }
    if ($Mode -eq 'Repair') { $requested = $selected.Clone() }
    foreach ($key in @('course','neural','legacy')) { $selected[$key] = $selected[$key] -or $requested[$key] }

    # Fail before large downloads when Brave has not loaded this extension.
    $registeredIds = @(& (Join-Path $PSScriptRoot 'install.ps1') -ExtensionId $ExtensionId -CacheRoot $CacheRoot -DetectOnly)
    if (-not $registeredIds.Count) { throw 'Load the extension in Brave first, then open Setup.cmd again.' }
    New-Item -ItemType Directory -Path $CacheRoot,(Join-Path $CacheRoot 'logs') -Force | Out-Null
    try { Start-Transcript -Path $logPath -Force | Out-Null; $transcribing = $true } catch { }
    Save-SetupState $selected $false
    Write-Host ('Mode: ' + $Mode) -ForegroundColor Cyan
    Write-Host 'Existing compatible downloads will be reused. Nothing prepares a course automatically.'
    Write-Host ''
    Write-Host '[1/4] Private runtime and Brave connection' -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot 'setup-python.ps1') -CacheRoot $CacheRoot
    & (Join-Path $PSScriptRoot 'install.ps1') -ExtensionId $registeredIds -CacheRoot $CacheRoot -RegisterOnly -Quiet

    $audit = Read-ComponentAudit $requested
    $repairPython = -not $audit.python.installed
    $repairCourse = $requested.course -and ($Mode -ne 'Repair' -or -not $audit.course.installed -or $repairPython)
    $repairLegacy = $requested.legacy -and ($Mode -ne 'Repair' -or -not $audit.legacy.installed -or $repairPython)
    $repairNeural = $requested.neural -and ($Mode -ne 'Repair' -or -not $audit.neural.installed -or $repairPython)
    $courseLibraries = $repairPython -or (@($audit.course.problems | Where-Object { $_ -match 'package|import|librar|module|DLL' }).Count -gt 0)
    $legacyLibraries = $repairPython -or -not $audit.legacy.installed

    Write-Host ''
    Write-Host '[2/4] Course preparation' -ForegroundColor Cyan
    if ($repairCourse) {
        & (Join-Path $PSScriptRoot 'setup-runtime.ps1') -CacheRoot $CacheRoot -RepairLibraries:$courseLibraries
    } elseif ($requested.course) { Write-Host 'Course preparation is already ready; retained.' }
    else { Write-Host 'Not selected. No Qwen or Whisper download.' }
    if ($repairLegacy) { & (Join-Path $PSScriptRoot 'setup-word-voice.ps1') -CacheRoot $CacheRoot -RepairLibraries:$legacyLibraries }

    Write-Host ''
    Write-Host '[3/4] Mao Plain and Nise' -ForegroundColor Cyan
    if ($repairNeural) {
        $neuralLibraryRepair = $repairPython
        if ($repairPython -and $repairCourse) {
            # Complete setup may have just supplied the shared NumPy/PyAV
            # wheels. Do not reinstall those same wheels a second time.
            $refreshed = Read-ComponentAudit @{ course = $false; legacy = $false }
            $neuralLibraryRepair = -not $refreshed.python.installed
        }
        & (Join-Path $PSScriptRoot 'setup-neural-voice.ps1') -CacheRoot $CacheRoot -ComponentsOnly -RepairLibraries:$neuralLibraryRepair
    } elseif ($requested.neural) { Write-Host 'Both selected voices are already ready; retained.' }
    else { Write-Host 'Not part of this existing installation; retained as optional.' }

    Write-Host ''
    Write-Host '[4/4] Final checks' -ForegroundColor Cyan
    Test-SelectedComponents $requested
    Save-SetupState $selected $true
    Write-Host ''
    Write-Host 'Setup complete.' -ForegroundColor Green
    if ($requested.neural) { Write-Host 'Mao Plain and Nise are ready.' }
    if ($requested.course) { Write-Host 'German, meaning colors and audio timings are ready to prepare.' }
    Write-Host 'Reload the extension at brave://extensions, then reload your iKnow page.'
    if ($requested.neural) { Write-Host 'In settings: Click words to listen > Local neural voice > Female or Male.' }
    Show-Creator
    $exitCode = 0
} catch {
    Write-Host ''
    Write-Host 'Setup stopped before completion.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'Completed downloads and saved course data are retained.'
    Write-Host 'Open Setup.cmd and choose Check / repair to continue an interrupted installation.'
    if ($transcribing) { Write-Host ('Details: ' + $logPath) }
} finally {
    if ($transcribing) { try { Stop-Transcript | Out-Null } catch { } }
}
exit $exitCode
