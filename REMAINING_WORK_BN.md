# NexProxy — বাকি কাজের প্রস্তুতি

**সর্বশেষ যাচাই:** ৫ নভেম্বর ২০২৬। এই নথি প্রস্তুতির তালিকা; এতে কোনো নতুন secret, production test order, payment record বা proxy credential নেই।

## এখনকার যাচাইকৃত অবস্থা

- Supabase project `nexproxy-app` সক্রিয় এবং `ap-south-1` অঞ্চলে। `dynamic-action` ও `send-auth-email` Edge Function সক্রিয়।
- লোকাল `main` এবং `origin/main` একই commit-এ ছিল। `npm run check` এবং `public/assets/js`-এর JavaScript syntax checks সফল হয়েছে।
- `account.js`-এ Google ও GitHub OAuth শুরু করার handler আছে; provider login page-এ যাওয়া আগের পরীক্ষায় দেখা হয়েছে। Provider callback-সহ সম্পূর্ণ live sign-in এখানে নিশ্চিত করা হয়নি।
- প্রোফাইলের Phone field এখন ঐচ্ছিক metadata; এটি phone verification করে না। WhatsApp OTP-এর UI/প্রবাহ এখনো নেই।
- Auth Email Hook-এর নতুন `SEND_EMAIL_HOOK_SECRET` dashboard-এ সেভ হয়েছে—এমন নির্ভরযোগ্য প্রমাণ নেই। তাই Hook চালু বা ইমেইল ঠিক আছে বলে ধরে নেওয়া যাবে না।
- পূর্ণ order → payment → verification → fulfillment E2E-এর জন্য production-এ কোনো test order/proof/inventory তৈরি করা হয়নি।

## ১. Auth Email Hook নিরাপদে ফিরিয়ে আনা

1. Supabase Dashboard-এ সঠিক project `mviohrcnkxodltwjqvyy` খুলে **Edge Functions → Secrets** দেখুন। `SEND_EMAIL_HOOK_SECRET`-এর update timestamp নতুন rotation-এর সময়ের সঙ্গে মিলেছে কি না যাচাই করুন। Secret-এর value কপি, স্ক্রিনশট, chat বা terminal output-এ দেখাবেন না।
2. Timestamp পুরোনো হলে Auth Hook-এর বর্তমান signing secret-টির সঙ্গে Supabase Edge Function secret একই মানে আপডেট করুন। কোনো value প্রকাশ না করে dashboard-এর **Save** action ব্যবহার করুন এবং তালিকার timestamp/state আবার যাচাই করুন।
3. Secret save নিশ্চিত হওয়ার পরেই **Authentication → Hooks → Send Email**-এ Hook URL `send-auth-email` function-এ নির্দেশ করছে কি না দেখুন; তারপর Hook সক্রিয় করুন।
4. প্রথমে একটি নিয়ন্ত্রিত test inbox-এ signup confirmation বা password recovery পরীক্ষা করুন। এরপর inbox delivery এবং Supabase Auth event যাচাই করুন। পরীক্ষা ব্যর্থ হলে Hook বন্ধ করে কারণ নির্ণয় করুন; বারবার production email trigger করবেন না।

## ২. Google ও GitHub sign-in E2E

1. Live site-এর Account page-এ Google sign-in করে provider consent সম্পন্ন করুন; callback শেষে account session/profile দেখা ও page reload-এর পর session বজায় থাকা যাচাই করুন।
2. Sign out করে একইভাবে GitHub sign-in পরীক্ষা করুন। Callback URL অবশ্যই live site-এর Supabase Auth redirect allow-list-এ থাকতে হবে।
3. একই email দিয়ে দুই provider আলাদাভাবে পরীক্ষা করার আগে identity linking-এর আচরণ যাচাই করুন; কোনো test identity unlink বা user delete করবেন না।
4. Provider setup সফল হলেও client-side error বা callback loop থাকলে সময়, provider, browser URL path, এবং sanitized error code নথিভুক্ত করুন—OAuth code, access token বা session কখনো লগ/শেয়ার করবেন না।

## ৩. WhatsApp OTP — প্রস্তাবিত বাস্তবায়ন পথ

Supabase-এর Phone Login documentation অনুযায়ী WhatsApp channel কেবল Twilio বা Twilio Verify provider-এ সমর্থিত। Supabase JS SDK-এর `signInWithOtp`-এ `options.channel: 'whatsapp'` নির্বাচন করা যায়। Twilio Verify-তে WhatsApp verification পাঠাতে একটি Verify Service ও WhatsApp Sender লাগে, এবং request-এ `channel: 'whatsapp'` ব্যবহার হয়। [Supabase Phone Login](https://supabase.com/docs/guides/auth/phone-login) [Supabase JS signInWithOtp](https://supabase.com/docs/reference/javascript/auth-signinwithotp) [Twilio Verify WhatsApp](https://www.twilio.com/docs/verify/whatsapp)

শুরু করার আগে Twilio account-এ WhatsApp Business Sender/Verify Service প্রস্তুত থাকতে হবে। Supabase Auth phone provider-এ provider credentials/service configuration বসাতে হবে এবং Auth SMS channel-কে WhatsApp-এ পাঠাতে হবে। Credentials কেবল Supabase/Twilio-এর secure settings-এ থাকবে—কোড, GitHub, Cloudflare public config, browser বা chat-এ নয়। WhatsApp sender না থাকলে OTP code লিখে UI তৈরি করলেই delivery হবে না।

বাস্তবায়নের UX লক্ষ্য:

- E.164 ফরম্যাটে নম্বর (যেমন `+8801…`) নেওয়া এবং নম্বরটি সঠিক কি না নিশ্চিত করতে ব্যবহারকারীকে সুযোগ দেওয়া।
- Signed-in account-এর phone-change flow ব্যবহার করলে OTP যাচাই শেষে সেই একই account-এর phone verified হওয়া নিশ্চিত করা; নতুন phone OTP sign-in-কে ভুল করে বর্তমান email account-এ link করা যাবে না।
- Send/resend rate limit, ভুল/মেয়াদোত্তীর্ণ কোডের error, loading state, accessibility label এবং verified/unverified অবস্থা দেখানো।
- Test phone-এ সীমিত OTP পাঠিয়ে sign-up/login ও phone-change—যে flow-গুলো বাস্তবায়িত হবে সেগুলো আলাদাভাবে পরীক্ষা করা। কোনো OTP, phone number বা auth token server log-এ রাখা যাবে না।

**গুরুত্বপূর্ণ নকশা-নোট:** Supabase `Send SMS Hook` ব্যবহার করে নিজস্ব provider চালালে hook payload-এ Supabase-generated OTP আসে; provider-কে একই OTP পাঠাতে হয়। Twilio Verify নিজে OTP তৈরি/যাচাই করে। তাই দুটিকে এমনভাবে জোড়া যাবে না যাতে একদিকে Supabase-এর code আর অন্যদিকে Twilio Verify-এর code তৈরি হয়—একটি সামঞ্জস্যপূর্ণ provider architecture বেছে নিতে হবে। Supabase-এর [Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook) WhatsApp-এর মতো বিকল্প channel-এ পাঠানোর জন্য তৈরি।

## ৪. Order → Payment → Verification → Fulfillment E2E

Production-এর বাস্তব টাকা, customer order বা proxy credential ব্যবহার করে পরীক্ষা করা উচিত নয়। আগে test-only payment method এবং dummy inventory record নিশ্চিত করুন। তারপর একটি অস্থায়ী test account দিয়ে order তৈরি, test reference/proof submit, admin account `mamunfb13@gmail.com` দিয়ে verification, dummy inventory assignment ও customer fulfillment view পরীক্ষা করুন। শেষে কেবল সেই শনাক্ত test order, proof object, assignment/fulfillment, dummy inventory row, email-idempotency event cleanup করুন; user/customer data-তে ছোঁয়া দেবেন না। বাস্তব payment বা production data তৈরি/পরিবর্তনের আগে আলাদা স্পষ্ট অনুমতি দরকার।

## ৫. GitHub ও Cloudflare সমাপ্তি

কোড পরিবর্তন হলে প্রথমে syntax checks, local Worker smoke test, secret-scan এবং diff review করুন। `.env`, `.dev.vars`, Twilio/Supabase/Brevo credential, OAuth token, customer data বা payment proof যেন staged না হয়। তারপর অনুমোদিত পরিবর্তন `mamunfb13/nexproxy`-এর `main`-এ push করুন এবং Cloudflare Workers Free-এর সীমার মধ্যে deploy করে `/`, `/api/health`, Account callback ও `/blog/` পরীক্ষা করুন। এই প্রস্তুতি-পর্বে কোনো code deployment বা database mutation করা হয়নি।
