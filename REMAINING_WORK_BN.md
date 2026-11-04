# NexProxy — বাকি কাজের প্রস্তুতি

**সর্বশেষ যাচাই:** ৫ নভেম্বর ২০২৬। এখানে কোনো secret value, test order, payment record বা proxy credential নেই।

## এখনকার যাচাইকৃত অবস্থা

- Supabase project `nexproxy-app` সক্রিয় এবং `ap-south-1` অঞ্চলে। `dynamic-action`, `send-auth-email` এবং নতুন `send-whatsapp-otp` Edge Function সক্রিয়।
- ৫ নভেম্বরের কাজ শেষে local syntax checks সফল। WhatsApp OTP-এর Account UI এখনো Cloudflare-এ deploy করা হয়নি।
- Google ও GitHub Auth providers Supabase-এ ENABLED এবং `account.js`-এ OAuth handlers আছে। Provider callback-সহ পূর্ণ live sign-in পরীক্ষা এখনো নিশ্চিত করা হয়নি।
- Account profile-এ phone-change/OTP UI ও Supabase `phone_change` flow code-এ প্রস্তুত; তবে feature flag default-off। Supabase Phone Auth provider এখনো DISABLED।
- `SEND_EMAIL_HOOK_SECRET` 2026-11-04 23:23 UTC-এ Auth Hook ও Edge Function Secrets-এ নতুন করে rotate হয়েছে। Secret value না দেখিয়ে দুই পাশের fingerprint মিলিয়ে দেখা হয়েছে; Send Email Hook সক্রিয় এবং সঠিক function URL-এ নির্দেশ করছে।
- Admin inbox-এ password-recovery request Supabase Auth API থেকে HTTP 200 পেয়েছে। প্রকৃত inbox delivery এখনো আলাদাভাবে নিশ্চিত করতে হবে।
- পূর্ণ order → payment → verification → fulfillment E2E-এর জন্য production-এ কোনো test order/proof/inventory তৈরি করা হয়নি।

## ১. Auth Email Hook যাচাই

Supabase Dashboard → **Authentication → Auth Hooks**-এ Send Email Hook সক্রিয় আছে। Endpoint `send-auth-email` function-এ নির্দেশ করছে এবং signing secret `SEND_EMAIL_HOOK_SECRET`-এর সঙ্গে মেলে—এটি value না দেখিয়ে যাচাই করা হয়েছে।

Admin inbox-এ একটি password-recovery request পাঠানো হয়েছে এবং Supabase Auth API HTTP 200 দিয়েছে। Inbox-এ email এসেছে কি না দেখা বাকি। এরপর নিয়ন্ত্রিত test inbox-এ signup confirmation ও password recovery আলাদাভাবে পরীক্ষা করা যায়। পরীক্ষা ব্যর্থ হলে Auth/Function logs-এ শুধু sanitized error/status দেখুন; বারবার production email পাঠাবেন না।

## ২. Google ও GitHub sign-in E2E

1. Live Account page-এ Google sign-in করে provider consent সম্পন্ন করুন; callback শেষে account profile/session ও page reload-এর পর session থাকা যাচাই করুন।
2. Sign out করে GitHub দিয়ে একই পরীক্ষা করুন। Callback URL Supabase redirect allow-list-এ থাকতে হবে।
3. একই email দিয়ে দুই provider পরীক্ষা করার আগে identity linking-এর আচরণ যাচাই করুন; test identity unlink বা user delete করবেন না।
4. Error হলে সময়, provider, URL path ও sanitized error code নথিভুক্ত করুন। OAuth code, access token বা session কখনো লগ/শেয়ার করবেন না।

## ৩. WhatsApp OTP — প্রস্তুত ও বাকি

Supabase Phone Auth documentation অনুযায়ী WhatsApp channel Twilio/Twilio Verify-এ সমর্থিত। এই প্রকল্পে Supabase-generated OTP গ্রহণ ও যাচাইয়ের জন্য signed Send SMS Hook function deploy হয়েছে. Account page-এ signed-in user-এর phone-change/OTP verification UI-ও code-এ যোগ হয়েছে. Twilio WhatsApp authentication template এবং provider configuration ছাড়া বাস্তব delivery চালু নয়। Public feature flag `NEXPROXY_WHATSAPP_OTP_ENABLED` এখন `false`। [Supabase Phone Login](https://supabase.com/docs/guides/auth/phone-login) [Supabase Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook) [Twilio WhatsApp Authentication Templates](https://www.twilio.com/docs/content/whatsappauthentication)

চালু করার আগে Twilio account-এ WhatsApp Business Sender যুক্ত/অনুমোদিত করতে হবে এবং Authentication category Content Template approve করাতে হবে; template-এ `{{1}}` OTP variable থাকতে হবে। Twilio Content API `ContentSid` ও `ContentVariables` ব্যবহার করে approved WhatsApp template পাঠায়। [Twilio WhatsApp Authentication Templates](https://www.twilio.com/docs/content/whatsappauthentication)

Supabase Authentication → Sign In / Providers-এ Phone Auth এখন disabled; এটি চালু করে Authentication → Auth Hooks-এ Send SMS hook endpoint `https://mviohrcnkxodltwjqvyy.supabase.co/functions/v1/send-whatsapp-otp` সেট করতে হবে। এই নকশায় Supabase-generated OTP Send SMS Hook থেকে Twilio API-তে যায়; একই OTP-এর জন্য Supabase-এর SMS provider দিয়ে দ্বিতীয়বার পাঠানোর configuration যোগ করবেন না। Edge Function Secrets-এ server-side ভাবে `SEND_SMS_HOOK_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `TWILIO_WHATSAPP_CONTENT_SID` সেট করতে হবে। Email hook signing key পুনর্ব্যবহার করবেন না। কোনো credential chat, browser public config, GitHub বা logs-এ যাবে না।

সব configuration নিশ্চিত হওয়ার পরই Account UI feature flag `true` করে syntax test, GitHub push, Cloudflare Workers Free deploy ও নিজের test phone দিয়ে request → WhatsApp delivery → code verify → `phone_confirmed_at` পরীক্ষা করুন। OTP/phone number logs-এ দেবেন না। Setup checklist: [WhatsApp OTP সেটআপ গাইড](WHATSAPP_OTP_SETUP_BN.md)

## ৪. Order → Payment → Verification → Fulfillment E2E

Production-এ বাস্তব টাকা, customer order বা proxy credential ব্যবহার করে পরীক্ষা করবেন না। আগে test-only payment method এবং dummy inventory নিশ্চিত করুন। অস্থায়ী test account দিয়ে order তৈরি, test reference/proof submit, admin `mamunfb13@gmail.com` দিয়ে verification, dummy inventory assignment ও customer fulfillment view পরীক্ষা করুন। শেষে কেবল শনাক্ত test order/proof/assignment/dummy inventory/email-idempotency rows cleanup করুন; user/customer data-তে হাত দেবেন না। বাস্তব payment বা production data পরিবর্তনের আগে আলাদা অনুমতি নিন।

## ৫. GitHub ও Cloudflare

`send-whatsapp-otp` function Supabase-এ deploy হয়েছে। Account frontend feature flag বন্ধ থাকায় Cloudflare Workers-এ deploy করা হয়নি। কোনো database row/order/payment পরিবর্তন করা হয়নি। Code update হলে syntax checks, local Worker smoke test, secret-scan ও diff review শেষে `mamunfb13/nexproxy`-এর `main`-এ push করুন; `.env`, `.dev.vars`, Twilio/Supabase/Brevo credentials, OAuth token, customer data বা payment proof কখনো stage করবেন না।
