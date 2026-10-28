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
- [ ] Worker publish হওয়ার পর `IPINFO_API_TOKEN`-কে Cloudflare Worker secret হিসেবে যোগ করে live lookup যাচাই করতে হবে; OAuth connected, কিন্তু deployment এখনও হয়নি।

## Cloudflare Workers hosting প্রস্তুতি

- [x] Existing Node backend-এর API logic পুনর্ব্যবহার করে Cloudflare Worker entrypoint, Node HTTP adapter ও `public/` static-assets binding যোগ করা হয়েছে; সাধারণ Node server mode-ও রাখা হয়েছে।
- [x] `/blog/<slug>` URL Cloudflare static asset-এর canonical path-এ rewrite হয়; local Wrangler runtime-এ homepage, blog, `/api/health`, `/api/geo`, unauthenticated admin denial ও 404 যাচাই হয়েছে।
- [x] Wrangler OAuth login সফল; authenticated account ID dashboard link-এর সঙ্গে মিলেছে।
- [ ] Workers Free/Paid status এখনও নিশ্চিত নয়: dashboard plans page loading-এ আটকে আছে এবং read-only entitlements-এ plan data আসেনি। Plan নিশ্চিত না হওয়া পর্যন্ত deploy হবে না; কোনো DNS বা billing পরিবর্তন করা হয়নি।

## Payment and fulfillment backend (অসম্পূর্ণ)

- [ ] Supabase `dynamic-action` Edge Function-এর `verify_payment`, proof upload এবং fulfillment logic পুনর্গঠন/প্রয়োগ করতে হবে।
- [ ] Admin RPC (`create_proxy_assignment`, `repair_proxy_fulfillment` প্রভৃতি) ও সংশ্লিষ্ট policy/schema যাচাই করে প্রয়োগ করতে হবে।
- [ ] Order → payment → admin fulfillment flow Supabase-এ সম্পূর্ণ করে production data-তে write না করে end-to-end যাচাই করতে হবে।
