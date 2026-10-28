
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
