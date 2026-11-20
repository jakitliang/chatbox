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
  $null = Register-ObjectEvent $recognizer SpeechHypothesized -SourceIdentifier hypothesized
  $null = Register-ObjectEvent $recognizer SpeechRecognitionRejected -SourceIdentifier rejected
  $null = Register-ObjectEvent $recognizer RecognizeCompleted -SourceIdentifier completed
  $stop = [Console]::OpenStandardInput().ReadAsync((New-Object byte[] 1), 0, 1)
  $recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  $ending = $false
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
    if ($event.SourceIdentifier -eq 'recognized' -or ($event.SourceIdentifier -eq 'hypothesized' -and !$ending)) {
      [Console]::WriteLine((ConvertTo-Json -Compress -InputObject @{
        final = ($event.SourceIdentifier -eq 'recognized')
        text = $event.SourceEventArgs.Result.Text
      }))
    } elseif ($event.SourceIdentifier -eq 'rejected' -and !$ending) {
      [Console]::WriteLine('{"final":false,"text":""}')
    }
  }
} finally {
  # Detach PowerShell's event handlers while the recognizer is still alive.
  Get-EventSubscriber | Unregister-Event
  $recognizer.Dispose()
}
`

function collect(child: ReturnType<typeof spawnWindowsSpeech>, deadline: number, onData?: (data: string) => void) {
  return new Promise<string>((resolve, reject) => {
    let output = ''
    let length = 0
    const timeout = setTimeout(() => child.kill(), deadline)
    child.stdout.setEncoding('utf8').on('data', (data: string) => {
      length += data.length
      if (length > 256_000) {
        reject(new Error('Windows dictation output limit exceeded'))
        child.kill()
      } else if (onData) {
        onData(data)
      } else {
        output += data
      }
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

export function startWindowsDictation(
  language: string,
  signal: AbortSignal,
  onUpdate: (confirmed: string, interim: string) => void
) {
  const child = spawnWindowsSpeech(dictationScript, signal, { CHATBOX_DICTATION_LANGUAGE: language })
  let confirmed = ''
  let pending = ''
  let streamError: unknown
  let stopDeadline: ReturnType<typeof setTimeout> | undefined
  const result = collect(child, 130_000, (data) => {
    if (signal.aborted || streamError) return
    const lines = (pending + data).split('\n')
    pending = lines.pop() ?? ''
    try {
      for (const line of lines) {
        const event: { final: unknown; text: unknown } = JSON.parse(line)
        if (typeof event.final !== 'boolean' || typeof event.text !== 'string') {
          throw new Error('Invalid Windows dictation update')
        }
        const text = event.text.trim()
        if (event.final && text) confirmed = confirmed ? `${confirmed} ${text}` : text
        onUpdate(confirmed, event.final ? '' : text)
      }
    } catch (error) {
      streamError = error
      child.kill()
    }
  }).then(
    () => {
      if (pending.trim()) throw new Error('Incomplete Windows dictation update')
      return confirmed
    },
    (error: unknown) => {
      throw streamError ?? error
    }
  )
  const stop = () => {
    if (!child.stdin.writableEnded && !child.stdin.destroyed) {
      child.stdin.end()
      stopDeadline = setTimeout(() => child.kill(), 3_000)
    }
  }
  const timer = setTimeout(stop, 120_000)
  const cleanup = () => {
    clearTimeout(timer)
    clearTimeout(stopDeadline)
  }
  void result.then(cleanup, cleanup)
  return { result, stop }
}
