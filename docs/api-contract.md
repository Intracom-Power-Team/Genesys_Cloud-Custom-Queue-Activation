# Verified Genesys Cloud contract

Verified against the Frankfurt region's [live Swagger definition](https://api.mypurecloud.de/api/v2/docs/swagger) on 12 November 2026. The [official JavaScript SDK endpoint reference](https://github.com/MyPureCloud/platform-client-sdk-javascript/blob/master/build/docs/UsersApi.md#patchuserqueues) also documents asynchronous processing and ignored non-member pairs.

## Required correction to the supplied OAuth scopes

The supplied client currently has `routing` and `users:readonly`. **Those are insufficient for the requested bulk PATCH.** Before live use, an OAuth administrator must configure and authorize the existing client for `users` and `user-basic-info`. Do not assume either scope is automatically included; confirm both in the OAuth client and application authorization.

| Endpoint | Swagger OAuth scopes | Permission | Purpose |
| --- | --- | --- | --- |
| `GET /api/v2/users/me` | `user-basic-info` | User context; not client credentials | Obtain the signed-in user's ID and name |
| `GET /api/v2/users/{userId}/queues` | `users` or `users:readonly` | `routing:queue:view` | Read queue membership and activation |
| `PATCH /api/v2/users/{userId}/queues` | `users` | `routing:queue:join` or `routing:queueMember:manage` | Activate/deactivate existing memberships |

The application requests `users user-basic-info`, with no `routing`, wildcard, or additional scopes. `users` covers the read operation as well as the required write operation. Its scope is broader than this UI's functionality; keep agent roles minimal and do not grant administrative or queue-member-management permissions for this app. OAuth scopes and user/division permissions are both enforced by Genesys. The public frontend cannot impose a security boundary on an independently used bearer token.

## Reading every membership

The current Swagger marks the `joined` query parameter as **default true**. Omitting it cannot safely be assumed to retrieve inactive memberships. This implementation retrieves every page of `joined=true`, then every page of `joined=false`, and combines them. This is a deliberate correction to the original example. `pageNumber` starts at 1; `pageSize=100`. Responses are `UserQueueEntityListing` with `entities`, `pageNumber`, `pageSize`, `pageCount`, `total` and pagination URIs. Each relevant `UserQueue` has `id` and boolean `joined`.

No returned URL is followed with a bearer token: pagination constructs same-origin requests. Duplicate queue IDs, mismatched filter values, changing totals, incomplete pages, or malformed responses stop the operation. The two reads are not a transaction. A concurrent activation may make a snapshot inconsistent, so an agent may need to refresh. There is no atomic compare-and-swap guarantee in this endpoint.

## Updating activation

The request body is an array of `UserQueue` objects. The app sends only `{ "id": "<managed queue UUID>", "joined": true|false }`, only for existing memberships whose state differs. Non-member pairs are disregarded by the API, which is why the selected profile's three memberships are checked before PATCH.

The API documents asynchronous processing; a successful response and its returned listing are not proof of final state. The app performs bounded delayed GET verification. A failure, timeout, or unverified final state triggers another read to display the actual observed result. No blind PATCH retry and no automatic rollback occur. Long propagation delays are reported as unverified, requiring refresh.

No membership-creation/deletion, presence, routing-status, groups, roles, or skills endpoints are used. The only user ID comes from `/users/me` and is stored privately inside the API client.

## Authentication references

- [Authorization Code with PKCE](https://developer.genesys.cloud/authorization/platform-auth/use-pkce)
- [Official SDK PKCE and popup documentation](https://github.com/MyPureCloud/platform-client-sdk-javascript#authentication)
- [Create an OAuth client](https://help.genesys.cloud/articles/create-an-oauth-client/)
- [Agent queue activation permissions and division restrictions](https://help.genesys.cloud/articles/choose-queues-to-work/)

Live sign-in and activation against the target organization have not been performed by automated tests.
