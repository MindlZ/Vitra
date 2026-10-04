# samples a running Vitra (dev or installed) and scores it. read-only: it never starts,
# stops or talks to the app. leave Vitra on the screen you want measured while it runs.
#   powershell -ExecutionPolicy Bypass -File scripts\perf.ps1 [-Seconds 20] [-Label "blur off"]
# runs are appended to %TEMP%\vitra-perf.csv so settings can be compared.

param(
  [int]$Seconds = 20,
  [string]$Label = ''
)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent

# dev = electron.exe from this project's node_modules; installed = Vitra.exe
$all = Get-CimInstance Win32_Process
$app = @($all | Where-Object {
  ($_.Name -eq 'Vitra.exe') -or
  ($_.Name -eq 'electron.exe' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($project, 'OrdinalIgnoreCase'))
})
if (-not $app.Count) {
  Write-Host 'Vitra is not running.' -ForegroundColor Yellow
  exit 1
}

function RoleOf($proc) {
  $cmd = [string]$proc.CommandLine
  if ($cmd -match '--type=([a-z-]+)') {
    switch ($Matches[1]) {
      'renderer' { return 'renderer' }
      'gpu-process' { return 'gpu' }
      default { return 'utility' }
    }
  }
  return 'main'
}

$procs = @{}
foreach ($p in $app) { $procs[[int]$p.ProcessId] = RoleOf $p }
# the media bridge (media.ps1) is a child powershell of main
$mainIds = @($procs.Keys | Where-Object { $procs[$_] -eq 'main' })
foreach ($p in $all) {
  if ($p.Name -eq 'powershell.exe' -and $mainIds -contains [int]$p.ParentProcessId) {
    $procs[[int]$p.ProcessId] = 'media'
  }
}

function CpuTimes {
  $t = @{}
  foreach ($id in $procs.Keys) {
    try { $t[$id] = (Get-Process -Id $id).TotalProcessorTime.TotalMilliseconds } catch { }
  }
  return $t
}

Write-Host ("Sampling {0} processes for {1}s..." -f $procs.Count, $Seconds)
$cpuStart = CpuTimes
$clock = [Diagnostics.Stopwatch]::StartNew()

# gpu engine counters are named in English only; on other locales gpu reads n/a
$gpu = $null
try {
  $samples = Get-Counter -Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' `
    -SampleInterval 1 -MaxSamples $Seconds
  $perSample = foreach ($s in $samples) {
    $sum = 0
    foreach ($c in $s.CounterSamples) {
      if ($c.InstanceName -match '^pid_(\d+)_' -and $procs.ContainsKey([int]$Matches[1])) {
        $sum += $c.CookedValue
      }
    }
    $sum
  }
  $gpu = ($perSample | Measure-Object -Average).Average
} catch {
  Start-Sleep -Seconds $Seconds
}

$elapsed = $clock.Elapsed.TotalMilliseconds
$cpuEnd = CpuTimes

# cpu as % of one core, per role
$byRole = [ordered]@{ main = 0.0; renderer = 0.0; gpu = 0.0; utility = 0.0; media = 0.0 }
$memory = 0
foreach ($id in $procs.Keys) {
  if ($cpuStart.ContainsKey($id) -and $cpuEnd.ContainsKey($id)) {
    $byRole[$procs[$id]] += ($cpuEnd[$id] - $cpuStart[$id]) / $elapsed * 100
  }
  try { $memory += (Get-Process -Id $id).PrivateMemorySize64 } catch { }
}
$cpu = ($byRole.Values | Measure-Object -Sum).Sum
$memoryMb = $memory / 1MB

# a launcher sitting on Home should be close to free. penalties are linear past an allowance
function Penalty($value, $free, $perUnit, $max) {
  return [math]::Min($max, [math]::Max(0, ($value - $free) * $perUnit))
}
$score = 100
$score -= Penalty $cpu 3 2.5 45
if ($null -ne $gpu) { $score -= Penalty $gpu 3 2 35 }
$score -= Penalty $memoryMb 450 0.05 20
$score = [math]::Round([math]::Max(0, $score))
$grade = if ($score -ge 90) { 'A' } elseif ($score -ge 75) { 'B' } elseif ($score -ge 60) { 'C' } elseif ($score -ge 45) { 'D' } else { 'F' }

Write-Host ''
Write-Host 'CPU (% of one core)'
foreach ($role in $byRole.Keys) {
  if ($byRole[$role] -gt 0) { Write-Host ('  {0,-9} {1,6:N1}' -f $role, $byRole[$role]) }
}
Write-Host ('  {0,-9} {1,6:N1}' -f 'total', $cpu)
Write-Host ('GPU 3D       {0}' -f $(if ($null -ne $gpu) { '{0:N1}%' -f $gpu } else { 'n/a' }))
Write-Host ('Memory       {0:N0} MB' -f $memoryMb)
Write-Host ''
$colour = switch ($grade) { 'A' { 'Green' } 'B' { 'Green' } 'C' { 'Yellow' } default { 'Red' } }
Write-Host ("Score {0}/100 ({1})" -f $score, $grade) -ForegroundColor $colour

$csv = Join-Path $env:TEMP 'vitra-perf.csv'
[pscustomobject]@{
  When = (Get-Date).ToString('yyyy-MM-dd HH:mm')
  Label = $Label
  Score = $score
  Cpu = [math]::Round($cpu, 1)
  Gpu = $(if ($null -ne $gpu) { [math]::Round($gpu, 1) } else { '' })
  MemoryMb = [math]::Round($memoryMb)
} | Export-Csv -Path $csv -Append -NoTypeInformation

Write-Host ''
Write-Host 'Recent runs'
Import-Csv $csv | Select-Object -Last 6 | Format-Table -AutoSize | Out-String | Write-Host
