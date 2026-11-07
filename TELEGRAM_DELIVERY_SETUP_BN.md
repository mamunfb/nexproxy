# NexProxy Telegram contact ও proxy delivery — সেটআপ গাইড

**কাজের অবস্থা:** ডাটাবেস migration ও দুটি Supabase Edge Function deploy করা হয়েছে। `NexProxyDeliveryBot` তৈরি হয়েছে এবং `TELEGRAM_BOT_TOKEN` ও `TELEGRAM_BOT_USERNAME` Supabase Edge Function Secrets-এ server-side সংরক্ষিত। Admin-এর Account/Profile activation ও end-to-end test বাকি; `telegram_required` এখনো `false`, তাই নতুন অর্ডারে Telegram বাধ্যতামূলক নয়।

## গ্রাহক কীভাবে যুক্ত হবেন

1. গ্রাহক NexProxy-তে sign in করে Account/Profile খুলবেন।
2. **Create secure Telegram link** চাপবেন। এটি ১০ মিনিটের জন্য একবার ব্যবহারযোগ্য link তৈরি করবে।
3. Telegram-এ link খুলে bot-এ **Start** চাপবেন। Bot private chat-এর পরিচয় account-এর সঙ্গে যুক্ত করবে।
4. Account-এ `Verified` অবস্থা দেখা গেলে, payment যাচাই ও proxy বরাদ্দ শেষে proxy connection details সেই Telegram chat-এ যাবে।

Order form-এর Telegram username ঐচ্ছিক support field মাত্র। Bot-এ message পাঠাতে username নয়, customer নিজে Start করে যুক্ত করা private chat-ই ব্যবহার হবে।

## Bot ও secret-এর অবস্থা

Bot **@NexProxyDeliveryBot** তৈরি হয়েছে এবং প্রয়োজনীয় দুইটি secret Supabase Dashboard → Project `mviohrcnkxodltwjqvyy` → **Edge Functions → Secrets**-এ যোগ করা আছে:

- `TELEGRAM_BOT_TOKEN` — server-side bot credential
- `TELEGRAM_BOT_USERNAME` — bot-এর username, `@` ছাড়া

Secret value কোনো chat, screenshot, source file, GitHub, Cloudflare public variable, frontend JavaScript বা database-এ কপি করবেন না। Token বদলালে শুধু Supabase Edge Function Secrets-এ নতুন value দিন।

## চালু করা

NexProxy-তে admin account `mamunfb13@gmail.com` দিয়ে sign in করুন এবং Account/Profile-এ যান। Bot configuration ঠিক থাকলে **Require Telegram verification for new orders** বোতামটি সক্রিয় হবে। সেটি চাপলে backend BotFather username-token জুটি যাচাই করে Telegram webhook নিবন্ধন করবে, তারপর order-এর database-side বাধা চালু করবে। এই session-এ admin sign-in ছিল না, তাই activation এখনো করা হয়নি।

চালুর পরে customer-এর নতুন order Telegram verified না হলে database-এ সংরক্ষিত হবে না। Admin যেন আগে নিজের Telegram account-ও link করে পরীক্ষা করেন।

## পরীক্ষা ও নিরাপত্তা

প্রথম test-এ admin account-এ secure link তৈরি করে Start চাপুন; Profile-এ Verified দেখাতে হবে। তারপর test order-এ payment যাচাই ও proxy assignment সম্পন্ন করে দেখুন bot-এ একবারই delivery আসে। Admin-এর assignment screen-এ Telegram delivery না হলে তা সফল assignment থেকে আলাদা করে দেখাবে। একই order/assignment-এর retry duplicate delivery ঠেকানোর idempotency record ব্যবহার করে।

Link token database-এ hash করে রাখা হয়, ১০ মিনিটে মেয়াদ শেষ হয় এবং একবারই ব্যবহার করা যায়। Telegram webhook কেবল Telegram secret header মিলে গেলে গ্রহণ করা হয়। Bot token, chat ID, OTP বা proxy credential browser logs-এ দেখানো হয় না। Proxy access details ব্যক্তিগত Telegram chat-এ পাঠানো হবে; গ্রাহক যেন bot-কে block না করেন।

## প্রযুক্তিগত ফাইল

- `supabase/migrations/20261105090000_add_telegram_contact_delivery.sql` — contact tables, one-time link completion এবং mandatory-order trigger।
- `supabase/functions/telegram-contact/index.ts` — account status, link creation ও admin activation।
- `supabase/functions/telegram-webhook/index.ts` — private-chat link verification।
- `supabase/functions/dynamic-action/index.ts` — proxy assignment-এর পরে idempotent Telegram delivery।
- `public/account/index.html`, `public/assets/js/account.js`, `public/assets/css/account.css` — Account/Profile link controls।
- `public/order/review/index.html`, `public/assets/js/order-review.js` — order confirmation-এর আগে link status।
