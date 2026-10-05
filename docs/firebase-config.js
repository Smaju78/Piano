// Firebase web config for the optional Google sign-in (account sync across devices).
// EMPTY on purpose: until a Firebase project exists for Piano, sync.js does nothing and the site keeps every
// preference in the browser only. To turn sign-in on, create the project (see README / the report), then paste
// its web-app config here (Project settings → General → Your apps → Config), e.g.
//   export default { apiKey: "…", authDomain: "piano-….firebaseapp.com", projectId: "…", storageBucket: "…",
//                    messagingSenderId: "…", appId: "…" };
// These values are public by design: access is controlled by the Firestore security rules (firestore.rules)
// and the key's website restriction in Google Cloud. Analytics is deliberately not used (no measurementId).
export default {};
