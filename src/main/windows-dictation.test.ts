import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { expect, test, vi } from 'vitest'
import { startWindowsDictation } from './windows-dictation'

const spawn = vi.hoisted(() => vi.fn())
vi.mock('./windows-speech-process', () => ({ spawnWindowsSpeech: spawn }))

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => child.emit('close', null)),
  })
  spawn.mockReturnValueOnce(child)
  return child
}

test('streams framed hypotheses and cumulative confirmed text across stdout chunks', async () => {
  const child = fakeChild()
  const update = vi.fn()
  const session = startWindowsDictation('zh-CN', new AbortController().signal, update)
  child.stdout.write('{"final":false,"te')
  expect(update).not.toHaveBeenCalled()
  child.stdout.write('xt":"可能"}\r\n{"final":true,"text":"你好"}\r\n')
  session.stop()
  expect(child.stdin.writableEnded).toBe(true)
  child.stdout.write('{"final":true,"text":"世界"}\r\n')
  child.emit('close', 0)
  await expect(session.result).resolves.toBe('你好 世界')
  expect(update.mock.calls).toEqual([
    ['', '可能'],
    ['你好', ''],
    ['你好 世界', ''],
  ])
})

test('fails explicitly when the recognizer sends an invalid frame', async () => {
  const child = fakeChild()
  const update = vi.fn()
  const session = startWindowsDictation('en-US', new AbortController().signal, update)
  child.stdout.write('{"final":true,"text":null}\n')
  await expect(session.result).rejects.toThrow('Invalid Windows dictation update')
  expect(child.kill).toHaveBeenCalledOnce()
  expect(update).not.toHaveBeenCalled()
})
