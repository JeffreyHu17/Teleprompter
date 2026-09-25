param(
  [Parameter(Mandatory = $false)]
  [string]$Locale = "zh-CN"
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$recognizer = $null
$eventJobs = @()

function Write-SpeechEvent {
  param([hashtable]$EventData)
  [Console]::Out.WriteLine(($EventData | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Speech
  $requestedCulture = [System.Globalization.CultureInfo]::GetCultureInfo($Locale)
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  $recognizerInfo = $installed | Where-Object { $_.Culture.Name -eq $requestedCulture.Name } | Select-Object -First 1
  if ($null -eq $recognizerInfo) {
    $recognizerInfo = $installed | Where-Object {
      $_.Culture.TwoLetterISOLanguageName -eq $requestedCulture.TwoLetterISOLanguageName
    } | Select-Object -First 1
  }
  if ($null -eq $recognizerInfo) {
    throw "No installed Windows speech recognizer supports locale $Locale. Install the matching language speech pack first."
  }

  $recognizer = [System.Speech.Recognition.SpeechRecognitionEngine]::new($recognizerInfo)
  $recognizer.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())
  $recognizer.SetInputToDefaultAudioDevice()

  $eventJobs += Register-ObjectEvent -InputObject $recognizer -EventName AudioLevelUpdated -Action {
    @{
      type = "level"
      level = [Math]::Max(0, [Math]::Min(1, $EventArgs.AudioLevel / 100.0))
      onDevice = $true
    } | ConvertTo-Json -Compress
  }
  $eventJobs += Register-ObjectEvent -InputObject $recognizer -EventName SpeechHypothesized -Action {
    @{
      type = "transcript"
      status = "listening"
      text = $EventArgs.Result.Text
      isFinal = $false
      confidence = $EventArgs.Result.Confidence
      onDevice = $true
    } | ConvertTo-Json -Compress
  }
  $eventJobs += Register-ObjectEvent -InputObject $recognizer -EventName SpeechRecognized -Action {
    @{
      type = "transcript"
      status = "listening"
      text = $EventArgs.Result.Text
      isFinal = $true
      confidence = $EventArgs.Result.Confidence
      onDevice = $true
    } | ConvertTo-Json -Compress
  }

  Write-SpeechEvent @{
    type = "status"
    status = "listening"
    locale = $recognizerInfo.Culture.Name
    onDevice = $true
  }
  $recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

  while ($true) {
    foreach ($job in $eventJobs) {
      Receive-Job -Job $job | ForEach-Object {
        [Console]::Out.WriteLine($_)
        [Console]::Out.Flush()
      }
    }
    Start-Sleep -Milliseconds 20
  }
} catch {
  Write-SpeechEvent @{
    type = "error"
    status = "failed"
    message = $_.Exception.Message
    locale = $Locale
    onDevice = $true
  }
  exit 1
} finally {
  if ($null -ne $recognizer) {
    try {
      $recognizer.RecognizeAsyncCancel()
      $recognizer.Dispose()
    } catch {
      [Console]::Error.WriteLine("Unable to dispose Windows speech recognizer: $($_.Exception.Message)")
    }
  }
  foreach ($job in $eventJobs) {
    Unregister-Event -SourceIdentifier $job.Name -ErrorAction SilentlyContinue
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  }
}
