# NexProxy Supabase সংযোগ — বর্তমান অবস্থা

## নতুন project
- Supabase project: `nexproxy-app` (`mviohrcnkxodltwjqvyy`), region `ap-south-1` (Mumbai), status healthy.
- Root project cost quote: $0/month at creation time.
- Blog tables: `public.blog_posts`, `public.blog_comments`; চারটি starter post যোগ করা হয়েছে।
- RLS enabled. Visitors published post পড়তে ও pending comment দিতে পারে; admin-only post mutation/comment moderation policy আছে।
- `public.is_admin()` শুধু JWT-র email `mamunfb13@gmail.com` হলে true ফেরায়।

## কোড/preview
- Server পুরোনো MySQL dependency বাদ দিয়ে Supabase REST API-তে blog read/write করে; database password বা service-role key ব্যবহার করে না।
- Frontend, admin ও payment request নতুন project URL-এ নির্দেশ করা হয়েছে।
- `node --check` সব JS-এ পাস; local preview-তে `/api/health`, blog list/detail ও static page HTTP 200 হয়েছে।

## এখনো অসম্পূর্ণ — পূর্ণ আগের feature parity নয়
- পুরোনো project-এর `dynamic-action` Edge Function নতুন project-এ নেই। Payment settings, proof upload ও payment submission চালাতে এর প্রকৃত source, config এবং storage setup দরকার।
- Admin UI আরও RPC ব্যবহার করে: `create_proxy_assignment`, `extend_proxy_assignment`, `get_admin_fulfillment_status`, `get_admin_payment_settings`, `repair_proxy_fulfillment`, `replace_proxy_assignment`, `update_payment_settings`, `verify_payment`। এদের SQL/schema/behavior নতুন project-এ নেই।
- Order/proxy/payment data schema ও data migration source ZIP-এ ছিল না।
- Authentication provider/redirect allowlist এবং Google/GitHub OAuth credentials কনফিগার ও পরীক্ষা করা হয়নি।
- Hosting target-এ deployment, domain/redirect URL এবং end-to-end browser test বাকি।

## Secret hygiene
`.env`-এ production secret commit করবেন না। Publishable key frontend-এ ব্যবহারের public key; service-role key/password-ийг কখনো frontend, GitHub, ZIP, issue, chat-এ publish করবেন না. `.env.example`-এ কেবল public config আছে.
