// Public application configuration. OAuth client IDs and queue IDs are not secrets.
export const GENESYS = Object.freeze({
  environment: 'mypurecloud.de',
  appUrl: 'https://apps.mypurecloud.de',
  apiUrl: 'https://api.mypurecloud.de',
  loginUrl: 'https://login.mypurecloud.de',
  clientId: '6f2d2766-80d7-4e7e-9eb0-aa74c114b215',
  // See docs/api-contract.md: bulk PATCH requires users; /users/me uses user-basic-info.
  scopes: ['users', 'user-basic-info'],
});

export const DEPLOYMENT = Object.freeze({
  siteUrl: 'https://intracom-power-team.github.io/Genesys_Cloud-Custom-Queue-Activation/',
  // Register this exact URI in the Genesys OAuth client. Override for local LIVE testing only.
  redirectUri: 'https://intracom-power-team.github.io/Genesys_Cloud-Custom-Queue-Activation/oauth/callback.html',
});

export const QUEUE_PROFILES = Object.freeze({
  Eparchia: [
    { name: 'Eparxia_Ioannina', id: 'c6c17832-7037-435b-ab67-1d90d002026d' },
    { name: 'Eparxia_Patra', id: '5db40671-686d-4711-afd2-e26b60822ac7' },
    { name: 'Eparxia_Volos', id: '8cee0d80-ac94-47af-8ddc-e6b9276f3d9c' },
  ],
  Athina01: [
    { name: 'Athina_Argiroupoli', id: '3e456ddf-66a0-4c05-9c6b-d6c721433571' },
    { name: 'Athina_Chalandri', id: 'f222dd09-e394-461c-9be7-4fe910403909' },
    { name: 'Athina_Pirgos_Athinon', id: '4c5b8916-02c1-4eef-b2a5-309ad55b453c' },
  ],
  Thessaloniki01: [
    { name: 'Thessaloniki_Chalkidiki', id: '5e46e959-c51f-4e0a-bf2b-5851dc6b205a' },
    { name: 'Thessaloniki_Papanastasiou', id: '4c7eb100-4e80-452a-8243-871607a86741' },
    { name: 'Thessaloniki_Thermi', id: 'f186f5b6-098d-4d2b-b2e7-e37effe7205c' },
  ],
});
for (const queues of Object.values(QUEUE_PROFILES)) {
  queues.forEach(Object.freeze);
  Object.freeze(queues);
}
