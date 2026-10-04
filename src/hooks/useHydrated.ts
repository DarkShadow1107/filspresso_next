import { useSyncExternalStore } from "react";

// Subscribing to a never-changing store gives a hydration-safe "have we mounted"
// flag: false on the server render, true on the client. This replaces the
// `useEffect(() => setMounted(true), [])` pattern, which performs a synchronous
// setState during the commit phase and triggers a cascading re-render.
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function useHydrated(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
