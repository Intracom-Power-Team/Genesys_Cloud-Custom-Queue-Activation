import { Auth, AUTH_MESSAGE } from '../auth.js';
import { GENESYS, DEPLOYMENT } from '../config.js';

const params = new URLSearchParams(location.search);
// Strip the authorization code immediately, including on failures. Never log the response.
history.replaceState(null, '', location.pathname);
const output = document.getElementById('callback-status');

try {
  if (new URL(DEPLOYMENT.redirectUri).href !== `${location.origin}${location.pathname}`) throw new Error('redirectConfig');
  if (params.getAll('state').length !== 1 || !params.get('state') ||
      (!params.has('error') && (params.getAll('code').length !== 1 || !params.get('code')))) throw new Error('oauthCode');
  if (window.opener && !window.opener.closed) {
    // Only the code travels back; the opener holds the verifier and checks origin, source and nonce.
    window.opener.postMessage({ type: AUTH_MESSAGE, state: params.get('state'),
      code: params.get('code'), error: params.get('error') }, location.origin);
    output.textContent = 'Επιστρέψτε στην εφαρμογή. Το παράθυρο θα κλείσει όταν ολοκληρωθεί η σύνδεση. / Return to the app; this window closes when sign-in completes.';
  } else {
    const auth = new Auth(GENESYS, DEPLOYMENT);
    await auth.exchange(auth.takeRedirectTransaction(), params);
    location.replace(new URL('../', location.href).href);
  }
} catch {
  output.textContent = 'Η σύνδεση δεν ολοκληρώθηκε. Επιστρέψτε στην εφαρμογή και ξεκινήστε ξανά. / Sign-in could not complete. Return to the app and start again.';
}
