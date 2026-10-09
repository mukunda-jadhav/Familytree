import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
export const configured = Boolean(import.meta.env.VITE_FIREBASE_API_KEY);
export const auth = configured
  ? getAuth(
      initializeApp({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
      }),
    )
  : null;
export async function api(path, method = "GET", data) {
  const token = await auth?.currentUser?.getIdToken();
  const res = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  if (res.status === 204) return null;
  const body = await res.json();
  if (!res.ok) throw Error(body.error || "Request failed");
  return body;
}
