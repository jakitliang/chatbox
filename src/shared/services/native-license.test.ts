import { expect, it } from 'vitest'
import { validateNativeLicense } from './native-license'

it('rejects unavailable validation instead of returning an invalid verdict', async () => {
  await expect(validateNativeLicense('saved-license', 'saved-instance')).rejects.toThrow(
    'Chatbox AI license services are unavailable in the self-hosted edition'
  )
})
