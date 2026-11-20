import { spawnWindowsSpeech } from './windows-speech-process'

const setup = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$engines = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
`

const listScript = `${setup}
$languages = @($engines | ForEach-Object { $_.Culture.Name } | Sort-Object -Unique)
[Console]::Write((ConvertTo-Json -InputObject $languages -Compress))
`

const dictationScript = `${setup}
$engine = $engines | Where-Object { $_.Culture.Name -eq $env:CHATBOX_DICTATION_LANGUAGE } | Select-Object -First 1
if (!$engine) { throw 'No installed recognizer for this language' }
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($engine)
try {
  $recognizer.SetInputToDefaultAudioDevice()
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $null = Register-ObjectEvent $recognizer SpeechRecognized -SourceIdentifier recognized
  $null = Register-ObjectEvent $recognizer RecognizeCompleted -SourceIdentifier completed
  $stop = [Console]::OpenStandardInput().ReadAsync((New-Object byte[] 1), 0, 1)
  $recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  $ending = $false
  $parts = New-Object 'System.Collections.Generic.List[string]'
  while ($true) {
    if (!$ending -and $stop.IsCompleted) {
      $ending = $true
      $recognizer.RecognizeAsyncStop()
    }
    $event = Wait-Event -Timeout 1
    if (!$event) { continue }
    Remove-Event -EventIdentifier $event.EventIdentifier
    if ($event.SourceIdentifier -eq 'completed') {
      if ($event.SourceEventArgs.Error) { throw $event.SourceEventArgs.Error }
      break
    }
    if ($event.SourceIdentifier -eq 'recognized') {
      $parts.Add($event.SourceEventArgs.Result.Text)
    }
  }
  [Console]::Write(($parts -join ' '))
} finally {
  $recognizer.Dispose()
}
`

function collect(child: ReturnType<typeof spawnWindowsSpeech>, deadline: number) {
  return new Promise<string>((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => child.kill(), deadline)
    child.stdout.setEncoding('utf8').on('data', (data: string) => {
      output += data
      if (output.length > 256_000) child.kill()
    })
    child.stderr.resume()
    child.stdin.on('error', () => child.kill())
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve(output)
      else reject(new Error('Windows dictation operation failed'))
    })
  })
}

export async function listWindowsDictationLanguages(): Promise<string[]> {
  const child = spawnWindowsSpeech(listScript)
  const output = collect(child, 10_000)
  child.stdin.end()
  const languages: unknown = JSON.parse(await output)
  if (!Array.isArray(languages) || !languages.every((lang): lang is string => typeof lang === 'string')) {
    throw new Error('Invalid Windows dictation languages')
  }
  return languages
}

export function startWindowsDictation(language: string, signal: AbortSignal) {
  const child = spawnWindowsSpeech(dictationScript, signal, { CHATBOX_DICTATION_LANGUAGE: language })
  const result = collect(child, 130_000)
  const stop = () => {
    if (!child.stdin.writableEnded && !child.stdin.destroyed) child.stdin.end()
  }
  const timer = setTimeout(stop, 120_000)
  void result.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer)
  )
  return { result, stop }
}
