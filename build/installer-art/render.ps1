# powershell -ExecutionPolicy Bypass -File build\installer-art\render.ps1
# BMPs are committed; packaging doesn't run this

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$here = $PSScriptRoot
$build = Split-Path $here -Parent
$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge not found.' }

$art = @(
  @{ Html = 'sidebar.html'; Width = 164; Height = 314; Out = 'installerSidebar.bmp' },
  @{ Html = 'header.html'; Width = 150; Height = 57; Out = 'installerHeader.bmp' }
)

foreach ($item in $art) {
  $png = Join-Path $env:TEMP ("vitra-" + [IO.Path]::GetFileNameWithoutExtension($item.Out) + '.png')
  $url = ([Uri](Join-Path $here $item.Html)).AbsoluteUri
  $profile = Join-Path $env:TEMP 'vitra-installer-art-profile'
  if (Test-Path $png) { Remove-Item $png }
  # Start-Process: PS 5.1 turns Edge's stderr progress into a terminating error
  Start-Process -FilePath $edge -Wait -WindowStyle Hidden -ArgumentList @(
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--allow-file-access-from-files', "`"--user-data-dir=$profile`"",
    "--window-size=$($item.Width),$($item.Height)", "`"--screenshot=$png`"", $url
  )
  # Edge can return before the file is flushed
  for ($i = 0; $i -lt 50 -and -not (Test-Path $png); $i++) { Start-Sleep -Milliseconds 100 }

  $source = [Drawing.Image]::FromFile($png)
  $bitmap = New-Object Drawing.Bitmap $item.Width, $item.Height, ([Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.DrawImage($source, 0, 0, $item.Width, $item.Height)
  $graphics.Dispose()
  $source.Dispose()
  $bitmap.Save((Join-Path $build $item.Out), [Drawing.Imaging.ImageFormat]::Bmp)
  $bitmap.Dispose()
  Remove-Item $png
  Write-Host "Wrote $($item.Out)"
}
