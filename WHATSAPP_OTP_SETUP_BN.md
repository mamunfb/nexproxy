# NexProxy WhatsApp OTP — সেটআপ ও চালুর ধাপ

**স্ট্যাটাস:** কোড প্রস্তুত করা হচ্ছে; production delivery এখনো বন্ধ। `public/assets/js/config.js`-এ `NEXPROXY_WHATSAPP_OTP_ENABLED` নিরাপত্তার জন্য `false` রাখা আছে। Twilio sender/template ও Supabase Phone Auth প্রস্তুত না হওয়া পর্যন্ত এটিকে `true` করবেন না।

## প্রস্তুত করা flow

সাইন-ইন করা গ্রাহক Account → Profile-এ আন্তর্জাতিক ফরম্যাটে ফোন নম্বর দেবেন। Supabase Auth-এর `updateUser({ phone })` ফোন পরিবর্তনের OTP তৈরি করবে। Supabase-এর Send SMS Hook সেই OTP-টি Twilio WhatsApp authentication template দিয়ে পাঠাবে। গ্রাহক code দিলে `verifyOtp({ phone, token, type: 'phone_change' })` একই Supabase account-এ নম্বর নিশ্চিত করবে। OTP তৈরি/যাচাই Supabase-ই করে; Twilio template শুধু OTP পৌঁছে দেয়।

Twilio-এর WhatsApp authentication template business-initiated OTP-এর জন্য প্রয়োজন; বার্তার Content Template-এ একটি variable `{{1}}` থাকতে হবে। Twilio Messages API-তে `ContentSid` এবং `ContentVariables` ব্যবহার করে এই code পাঠানো হয়। [Twilio WhatsApp Authentication Templates](https://www.twilio.com/docs/content/whatsappauthentication)

## যা Twilio-তে প্রস্তুত করতে হবে

1. Twilio account তৈরি/প্রবেশ করে WhatsApp Business Sender যুক্ত ও অনুমোদন করান। Sender-এর নম্বর E.164 ফরম্যাটে লিখে রাখুন। Trial/sandbox sender production-এর জন্য যথেষ্ট নাও হতে পারে।
2. Twilio Content Template-এ **Authentication** category-র WhatsApp code template তৈরি করে Meta approval সম্পন্ন করুন। Code-এর জন্য variable `{{1}}` ব্যবহার করুন; template-এর প্রকাশিত/অনুমোদিত status না পাওয়া পর্যন্ত এগোবেন না।
3. Twilio Console থেকে Account SID ও Auth Token নিন; Template Content SID `HX...`-ও নিন। এগুলো কাউকে chat-এ পাঠাবেন না, screenshot/commit/log-এ দেবেন না।

## Supabase-এ সেটআপ

1. Authentication → Sign In / Providers → Phone-এ Phone Auth চালু করুন। এই নকশায় Supabase-generated OTP Send SMS Hook দিয়ে Twilio API-তে যায়; Supabase-এর SMS provider-এর মাধ্যমে দ্বিতীয়বার OTP পাঠানোর configuration যোগ করবেন না। Phone Auth চালু করার আগে account-এর rate limit ও CAPTCHA policy দেখুন।
2. Authentication → Auth Hooks-এ **Send SMS** hook তৈরি করুন, HTTPS endpoint হিসেবে `https://mviohrcnkxodltwjqvyy.supabase.co/functions/v1/send-whatsapp-otp` দিন এবং Supabase-generated signing secret সংরক্ষণ করুন। Send Email hook-এর secret এখানে পুনর্ব্যবহার করবেন না।
3. Edge Function Secrets-এ server-side ভাবে এই নামগুলো সেট করুন: `SEND_SMS_HOOK_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `TWILIO_WHATSAPP_CONTENT_SID`। `TWILIO_WHATSAPP_NUMBER` হলো অনুমোদিত Sender-এর আন্তর্জাতিক নম্বর; `TWILIO_WHATSAPP_CONTENT_SID` হলো অনুমোদিত authentication template-এর Content SID। কোনো credential browser/Cloudflare public variable বা Git-এ রাখা যাবে না।
4. Hook signing secret Supabase Auth Hook settings ও Edge Function secret-এ byte-for-byte মেলে কি না সেভ/যাচাই করুন। কোনো value প্রকাশ না করে UI থেকেই সেট করুন।
5. Supabase Hook/Function configuration যাচাইয়ের পরই `public/assets/js/config.js`-এ feature flag `true` করুন। তারপর syntax check, GitHub push, Cloudflare Workers Free deploy, এবং সীমিত test account/নিজস্ব test phone দিয়ে request → WhatsApp receive → code verify → `phone_confirmed_at` test করুন।

## নিরাপত্তা ও খরচ

OTP ও phone number server logs-এ লেখা যাবে না। Function Twilio errors-এ কেবল HTTP status log করে। Supabase-এর OTP expiration/resend/rate limits এবং CAPTCHA সেটিং কার্যকর রাখুন। প্রথমে Twilio account-এর pricing, template/Meta requirements ও WhatsApp sender availability পরীক্ষা করুন; WhatsApp message সম্পূর্ণ বিনামূল্যে ধরে নেবেন না। Test-এর সময় অন্য গ্রাহকের phone-এ code পাঠাবেন না।

## কোডের অবস্থান

- `supabase/functions/send-whatsapp-otp/index.ts` — Supabase SMS Hook signature যাচাই করে Supabase-এর OTP approved Twilio WhatsApp template-এ পাঠায়।
- `public/account/index.html`, `public/assets/css/account.css`, `public/assets/js/account.js` — account profile-এর phone request/OTP verify UI ও Supabase phone-change flow।
- `public/assets/js/config.js` — default-off feature flag.
