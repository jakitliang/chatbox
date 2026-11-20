import type { LocalSpeechVoice } from '@shared/local-speech'
import { spawnWindowsSpeech } from './windows-speech-process'

// Keep user text out of the command line and pass it to Speak as plain text, not SSML.
const script = `
$ErrorActionPreference = 'Stop'
$encoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $encoding
[Console]::OutputEncoding = $encoding
$request = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = @($synth.GetInstalledVoices() | Where-Object Enabled | ForEach-Object { $_.VoiceInfo })
  if ($request.operation -eq 'voices') {
    $result = @($voices | ForEach-Object { @{ id = $_.Id; name = $_.Name; lang = $_.Culture.Name } })
    [Console]::Write((ConvertTo-Json -InputObject $result -Compress))
  } else {
    $voice = $voices | Where-Object { $_.Id -ceq $request.voiceId } | Select-Object -First 1
    if (!$voice) { throw 'Installed speech voice not found' }
    $synth.SelectVoice($voice.Name)
    if ($synth.Voice.Id -cne $voice.Id) { throw 'Could not select the installed speech voice' }
    $synth.Speak([string]$request.text)
  }
} finally {
  $synth.Dispose()
}
`

type Request = { operation: 'voices' } | { operation: 'speak'; voiceId: string; text: string }

function run(request: Request, signal = new AbortController().signal) {
  return new Promise<string>((resolve, reject) => {
    const child = spawnWindowsSpeech(script, signal)
    let output = ''
    const timeout = setTimeout(() => child.kill(), request.operation === 'voices' ? 10_000 : 60 * 60_000)
    child.stdout.setEncoding('utf8').on('data', (data: string) => {
      output += data
      if (output.length > 256_000) child.kill()
    })
    child.stderr.resume()
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve(output)
      else reject(new Error('Windows speech operation failed'))
    })
    child.stdin.once('error', reject)
    child.stdin.end(JSON.stringify(request), 'utf8')
  })
}

export async function listWindowsSpeechVoices(): Promise<LocalSpeechVoice[]> {
  const voices: unknown = JSON.parse(await run({ operation: 'voices' }))
  if (
    !Array.isArray(voices) ||
    !voices.every(
      (voice): voice is LocalSpeechVoice =>
        voice && typeof voice.id === 'string' && typeof voice.name === 'string' && typeof voice.lang === 'string'
    )
  ) {
    throw new Error('Invalid Windows speech voice list')
  }
  return voices
}

export async function speakWithWindowsVoice(voiceId: string, text: string, signal: AbortSignal) {
  await run({ operation: 'speak', voiceId, text }, signal)
}
