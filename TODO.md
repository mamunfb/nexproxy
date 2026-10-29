## Authentication gate for ordering

- [x] Homepage pricing-এর সব plan Choose/Start CTA এবং Custom pricing CTA এখন আগে active Supabase session যাচাই করে; signed-out user-কে Account Sign In form-এ পাঠায়।
- [x] Signed-out user সরাসরি `/order/`, `/order/review/` বা `/payment/` খুললেও Account Sign In page-এ redirect হয়।
- [x] Successful email/password, Google/GitHub OAuth এবং instantly-created signup session-এর পরে original order/payment URL-এ automatic return হয়; signup email confirmation callback-এও destination রাখা হয়।
- [x] সব front-facing menu থেকে Sign Up button সরিয়ে শুধু Sign In button রাখা হয়েছে। Account page-এর internal Create account tab এখনও available আছে।
- [x] Shared auth guard, account redirect logic, menu state এবং JavaScript syntax যাচাই করা হয়েছে।

## Country detection and admin order location

- [x] Order form now loads all 249 ISO country/territory options and auto-selects the IP-detected country; customers can change the selection.
- [x] Confirmed orders are saved through an authenticated Supabase RPC.
- [x] Coarse IP-derived country/region/city and rounded coordinates are stored separately, without storing a raw IP address.
- [x] Order and IP-location rows have RLS enabled; only the configured admin can read them. The approximate Google Map appears only in the admin customer-detail modal.
- [x] The order form discloses approximate IP-area collection; location is not precise GPS.

## IPinfo Lite country cross-check

- [x] সার্ভার `IPINFO_API_TOKEN` environment variable থাকলে IPinfo Lite থেকে দেশ-স্তরের যাচাই করে; token browser-এ পাঠানো বা source/GitHub-এ রাখা হয় না।
- [x] IPinfo Lite শুধু দেশ/মহাদেশ/ASN তথ্য দেয়; বিদ্যমান শহর, অঞ্চল ও আনুমানিক স্থানাঙ্কের provider অক্ষত থাকে।
- [x] `IPINFO_API_TOKEN` Cloudflare Worker secret হিসেবে যোগ এবং live country cross-check যাচাই করা হয়েছে; শহর/অঞ্চলের আগের fallback অক্ষত আছে।

## Cloudflare Workers hosting প্রস্তুতি

- [x] Existing Node backend-এর API logic পুনর্ব্যবহার করে Cloudflare Worker entrypoint, Node HTTP adapter ও `public/` static-assets binding যোগ করা হয়েছে; সাধারণ Node server mode-ও রাখা হয়েছে।
- [x] `/blog/<slug>` URL Cloudflare static asset-এর canonical path-এ rewrite হয়; local Wrangler runtime-এ homepage, blog, `/api/health`, `/api/geo`, unauthenticated admin denial ও 404 যাচাই হয়েছে।
- [x] Wrangler OAuth login সফল; authenticated account ID dashboard link-এর সঙ্গে মিলেছে।
- [x] User Workers Free plan নিশ্চিত করেছেন; account-level `mynexproxy.workers.dev` prefix register করে Worker `nexproxy`-কে `https://nexproxy.mynexproxy.workers.dev`-এ deploy করা হয়েছে। Custom domain, zone DNS record বা paid billing বদলানো হয়নি।
- [x] Live read-only GET-এ `/`, `/blog/`, `/blog/deployment-smoke-test/` ও `/api/health` 200 দিয়েছে; health-এ `ok=true` এবং Supabase `database=true`।

## Payment and fulfillment backend

- [x] `dynamic-action` Edge Function-এ active payment settings পাঠানো, account-নির্ভর order ownership যাচাইসহ payment proof upload/submission, এবং শুধু admin-এর জন্য ৬০-সেকেন্ডের private proof link যুক্ত হয়েছে।
- [x] JPG/PNG/WEBP, সর্বোচ্চ ৫ MB payment proof private `payment-proofs` Storage bucket-এ রাখা হয়; customer কেবল নিজের order-এর proof জমা দিতে পারে।
- [x] `proxy_inventory`, `proxy_assignments`, `proxy_fulfillments`, `payment_settings`, `admin_activity_log` ও `payment_proofs` schema, RLS এবং admin-only RPC তৈরি হয়েছে; admin email `mamunfb13@gmail.com` ছাড়া admin mutations অনুমোদিত নয়।
- [x] `verify_payment`, `create_proxy_assignment`, `extend_proxy_assignment`, `replace_proxy_assignment`, `repair_proxy_fulfillment`, `get_admin_payment_settings`, `update_payment_settings` ও `get_admin_fulfillment_status` চালু হয়েছে। Assignment-এর আগে payment verify থাকতে হবে এবং proxy inventory-তে AVAILABLE record থাকতে হবে।
- [x] Live Edge Function-এ public payment-settings action HTTP 200 দিয়েছে; production order/payment/proxy data পরিবর্তন করা হয়নি।
- [ ] বাস্তব signed-in customer ও admin session দিয়ে সম্পূর্ণ order → payment → verification → inventory assignment → fulfillment flow-র authenticated E2E এখনও পরীক্ষা করা বাকি।
