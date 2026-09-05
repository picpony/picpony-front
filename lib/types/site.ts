/**
 * `api.php?action=get_maintenance_status` — the site's boot-time status document.
 *
 * The name is historical: besides maintenance it carries the global route policy an
 * administrator uses to pin every visitor to one Derpibooru API line and one image line
 * (`lib/route.ts` is the consumer that matters; `lib/api/admin.ts` reads the same document).
 * Every field is optional on the wire — a failed session or older backend can answer with a
 * subset, and both readers fall back rather than trust it.
 */
export interface SiteStatusResponse {
  success?: boolean;
  maintenance_mode?: boolean;
  maintenance_message?: string;
  translate_enabled?: boolean;
  is_admin?: boolean;
  /** `auto` | `direct` | `api_accel` | `picpony_api` | `third_party` */
  global_api_route_policy?: string;
  /** Only meaningful when the policy is `third_party`; validated before use. */
  global_api_third_party_url?: string;
  /** When false the user's Derpibooru key is stripped from the forwarded query. */
  global_api_third_party_pass_api_key?: boolean;
  /** `auto` | `direct` | `cdn` | `picpony` */
  global_image_route_policy?: string;
}
