// Compatibility for the legacy guide, which is owned by the main removal task.
// Official account login is no longer available and cannot issue network requests.
export function EmailCodeLoginModal(_props: {
  opened: boolean
  onClose: () => void
  language: string
  onLoginSuccess: (tokens: { accessToken: string; refreshToken: string }) => Promise<void>
}) {
  return null
}
