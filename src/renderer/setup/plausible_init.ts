export type PlausibleNavigationSubscriber = (onResolved: (hrefChanged: boolean) => void) => void

/** Legacy compatibility only; do not register navigation observers. */
export async function initPlausibleTracking(_subscribeToNavigation?: PlausibleNavigationSubscriber): Promise<void> {}
