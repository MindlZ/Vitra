# Now-playing bridge for Vitra's Home screen.
#
# Reads Windows' media session (the same source as the volume flyout, so it
# covers Spotify, browsers and most players) and writes one JSON object per
# line to stdout. Reads commands - toggle, next, previous - one per line from
# stdin. Exits when stdin closes, so it can't outlive the app.
#
# Lines:
#   {"type":"state", ...}   whenever anything but the artwork changes
#   {"type":"art", key, art} when a new track's artwork has been read
# Artwork is sent separately so the frequent state line stays small.

$ErrorActionPreference = 'Stop'
# Otherwise module loading writes progress records to stderr as CLIXML.
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

# WinRT async -> .NET Task, so PowerShell can wait on it.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  if ($task.Wait(5000)) { return $task.Result }
  return $null
}

function Send($object) {
  [Console]::Out.WriteLine(($object | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$ManagerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$PropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$StreamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]

try {
  $manager = Await ($ManagerType::RequestAsync()) $ManagerType
} catch {
  Send @{ type = 'error'; message = $_.Exception.Message }
  exit 1
}

# The thumbnail stream arrives as a bare COM object, which PowerShell can't
# bind to a method overload or read properties from directly. Going through
# reflection with the interface types makes .NET do the cast.
$AsStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod(
  'AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
$ContentTypeProp = [Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType')

function Read-Art($reference) {
  $stream = Await ($reference.OpenReadAsync()) $StreamType
  if (-not $stream) { return $null }
  $source = $null
  try {
    $source = $AsStreamForRead.Invoke($null, @($stream))
    $memory = New-Object System.IO.MemoryStream
    $source.CopyTo($memory)
    if ($memory.Length -eq 0) { return $null }
    $type = $ContentTypeProp.GetValue($stream)
    if (-not $type) { $type = 'image/png' }
    return "data:$type;base64," + [Convert]::ToBase64String($memory.ToArray())
  } finally {
    # The COM object has no callable Dispose; the .NET wrapper releases it.
    if ($source) { $source.Dispose() }
  }
}

$artKey = ''
$artDone = $false
$artTries = 0
$last = ''

function Get-State {
  $session = $manager.GetCurrentSession()
  if (-not $session) { return @{ type = 'state'; active = $false } }

  $media = Await ($session.TryGetMediaPropertiesAsync()) $PropsType
  $info = $session.GetPlaybackInfo()
  $timeline = $session.GetTimelineProperties()
  $key = "$($session.SourceAppUserModelId)|$($media.Title)|$($media.Artist)|$($media.AlbumTitle)"

  if ($key -ne $script:artKey) {
    $script:artKey = $key
    $script:artDone = $false
    $script:artTries = 0
  }
  # Players often publish the title a moment before the artwork, so keep
  # trying for a few polls rather than giving up on the first miss.
  if (-not $script:artDone -and $media -and $media.Thumbnail -and $script:artTries -lt 6) {
    $script:artTries++
    try {
      $art = Read-Art $media.Thumbnail
      if ($art) {
        $script:artDone = $true
        Send @{ type = 'art'; key = $key; art = $art }
      }
    } catch {}
  }

  return @{
    type = 'state'
    active = $true
    app = $session.SourceAppUserModelId
    title = $media.Title
    artist = $media.Artist
    album = $media.AlbumTitle
    status = $info.PlaybackStatus.ToString()
    canPlayPause = $info.Controls.IsPlayPauseToggleEnabled
    canNext = $info.Controls.IsNextEnabled
    canPrevious = $info.Controls.IsPreviousEnabled
    positionMs = [long]$timeline.Position.TotalMilliseconds
    durationMs = [long]($timeline.EndTime - $timeline.StartTime).TotalMilliseconds
    updatedAt = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
    artKey = $key
  }
}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$tick = 0

while ($true) {
  if ($pending.IsCompleted) {
    $command = $pending.Result
    if ($null -eq $command) { break }
    try {
      $session = $manager.GetCurrentSession()
      if ($session) {
        switch ($command.Trim()) {
          'toggle' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
          'next' { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
          'previous' { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
        }
      }
    } catch {}
    $pending = $stdin.ReadLineAsync()
    # Report the result of the command straight away.
    $tick = 0
  }

  # Poll twice a second; check for commands every 100 ms.
  if ($tick % 5 -eq 0) {
    try {
      $json = (Get-State) | ConvertTo-Json -Compress
      if ($json -ne $last) {
        $last = $json
        [Console]::Out.WriteLine($json)
        [Console]::Out.Flush()
      }
    } catch {}
  }
  $tick++
  Start-Sleep -Milliseconds 100
}
