import { LocalUnavailableError } from './remote'

/** Compatibility only: self-hosted builds do not activate payment-vendor licenses. */
export async function activateLicense(
  _key: string,
  _instanceName: string
): Promise<{
  valid: boolean
  instanceId: string
  error?: 'reached_activation_limit' | 'expired' | 'not_found'
}> {
  throw new LocalUnavailableError('License activation')
}

export async function deactivateLicense(_key: string, _instanceId: string): Promise<void> {
  throw new LocalUnavailableError('License deactivation')
}

export async function validateLicense(_key: string, _instanceId: string): Promise<{ valid: boolean }> {
  throw new LocalUnavailableError('License validation')
}
