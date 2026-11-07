"use client";
export function pushSupport() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
/** Call only after an explicit user gesture. iOS/iPadOS requires an installed Home Screen app. */
export async function subscribePush(publicKey: string) {
  if (!pushSupport()) throw new Error("Web Push unavailable; use the inbox.");
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error("Push permission not granted.");
  const worker = await navigator.serviceWorker.register("/push-worker.js");
  await navigator.serviceWorker.ready;
  const padded = publicKey.replaceAll("-", "+").replaceAll("_", "/");
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  const sub = await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytes,
  });
  const json = sub.toJSON();
  const response = await fetch("/api/v1/me/push-subscriptions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  if (!response.ok) {
    await sub.unsubscribe();
    throw new Error("Subscription could not be saved.");
  }
  return response.json();
}
