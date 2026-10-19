/**
 * `{maintenance_mode, maintenance_message}`: the public `GET /api/v1/maintenance-status`
 * (`site::public_maintenance`, guests and SSR; the message is `''` while maintenance is off) and
 * the signed-in `GET /api/v1/me/maintenance-status` (`site::maintenance`) answer this shape.
 */
export interface MaintenanceStatus {
  maintenance_mode: boolean;
  /** At most 500 characters; `''` for the screen's own default. */
  maintenance_message: string;
}

/**
 * `GET /api/v1/routing-policy` (`app_config::website_get`) — the public site-wide line policy,
 * already sanitised by the backend (`Website::safe`): an unknown or unusable value reads as
 * `auto` (the client decides), `third_party_url` is `null` unless it is a clean public HTTPS
 * entry, and `third_party_pass_api_key` is `false` unless the line is `third_party`.
 */
export interface WebsiteRoutingPolicy {
  policy: {
    /** `auto` | `direct` | `api_accel` | `picpony_api` | `third_party` */
    api_policy: string;
    /** `auto` | `direct` | `cdn` | `picpony` */
    media_policy: string;
    third_party_url: string | null;
    /** Whether the visitor's own Derpibooru key is forwarded to the third-party line. */
    third_party_pass_api_key: boolean;
  };
  revision: number;
}

/**
 * The site-wide request-line policy as the front end keeps it — `lib/route.ts`'s internal policy
 * record (from `GET /api/v1/routing-policy`, `routePolicyFromWire`) and the patch the admin
 * console's route save publishes (the `global_*` keys `PUT /admin/api-route-policy` and
 * `/admin/image-route-policy` answer, applied by `applySavedRoutePolicy`).
 * Not a wire format: the PHP status document it was named after is gone, and its other facts are
 * separate resources now — maintenance (`MaintenanceStatus`), semantic search
 * (`GET /semantic-searches/settings`, `lib/semanticConfig.ts`) and translation
 * (`GET /translations/settings`, `lib/api/translate.ts`).
 */
export interface SiteStatusResponse {
  /** `auto` | `direct` | `api_accel` | `picpony_api` | `third_party` */
  global_api_route_policy?: string;
  /** Only meaningful when the policy is `third_party`; validated before use. */
  global_api_third_party_url?: string;
  /** When false the user's Derpibooru key is stripped from the forwarded query. */
  global_api_third_party_pass_api_key?: boolean;
  /** `auto` | `direct` | `cdn` | `picpony` */
  global_image_route_policy?: string;
}

/** A row of /about's roster: `GET /api/v1/team-members` → `members[]` (`team::list`). */
export interface TeamMember {
  id: number;
  name: string;
  role: string;
  category: 'developer' | 'manager' | 'editor' | 'special';
  /** `''` when unset (NOT NULL column). */
  avatar_url: string;
  /** The bound account's avatar, `null` when no account is bound. */
  account_avatar: string | null;
  /** `''` when unset (NOT NULL column). */
  link_url: string;
  order_num: number;
  /** The bound account, if any. */
  user_id: number | null;
}
