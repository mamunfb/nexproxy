# NexProxy Cloudflare Hosting সেটআপ

## প্রস্তাবিত আর্কিটেকচার

NexProxy-এর `public/` ফোল্ডারের HTML, CSS, JavaScript ও ছবি Cloudflare Workers Static Assets দিয়ে পরিবেশিত হবে। `/api/*` অনুরোধগুলো Worker-এর Node HTTP adapter দিয়ে বর্তমান `server.js` API-তে যাবে। `/blog/<slug>` URL-গুলো `public/blog/post.html` template-এ যাবে, যাতে বর্তমান blog detail page-এর আচরণ বজায় থাকে। এটি সাধারণ Node server-কে অপরিবর্তিতভাবে চালানো নয়; Cloudflare-compatible Worker entrypoint ব্যবহার করে বিদ্যমান API logic পুনর্ব্যবহার করা।

## লোকাল পরীক্ষা

1. Node.js 22 ব্যবহার করে `npm ci` চালান।
2. IPinfo Lite local test দরকার হলে `.dev.vars.example` কপি করে `.dev.vars` বানিয়ে সেখানে `IPINFO_API_TOKEN` দিন। প্রকৃত `.dev.vars` কখনও GitHub-এ commit করবেন না। টোকেন না থাকলেও বিদ্যমান geo fallback চালু থাকবে।
3. `npm run check` দিয়ে syntax পরীক্ষা করুন।
4. `npm run cloudflare:dev` দিয়ে Wrangler-এর local Worker runtime চালু করুন। `/`, `/blog/`, `/blog/<slug>/`, `/api/health`, `/api/geo` এবং unauthenticated `/api/admin/blog/posts` পরীক্ষা করুন। এই local command Cloudflare-এ deploy করে না।

## Cloudflare-এ secrets ও deployment

Cloudflare account যুক্ত এবং Worker প্রকাশের অনুমতি পাওয়ার পর `IPINFO_API_TOKEN`-কে Worker secret হিসেবে যোগ করতে হবে—উদাহরণ: `npx wrangler secret put IPINFO_API_TOKEN`। Supabase URL ও publishable key ইতিমধ্যে project-এর public configuration-এ আছে; service-role key বা payment secret browser/static assets-এ যোগ করবেন না।

`npm run cloudflare:deploy` Worker-টি Cloudflare-এ public `workers.dev` URL-এ প্রকাশ করবে। এই repository/config কেবল প্রস্তুত; অনুমোদন ছাড়া deploy, DNS পরিবর্তন বা paid plan নির্বাচন করা হবে না। Custom domain যোগ করতে আলাদা DNS পরিবর্তন লাগতে পারে এবং সেটি এই সেটআপের অংশ নয়।

Cloudflare-এর প্রকাশিত Free plan-এ Worker execution-এর সীমা বর্তমানে দিনে 100,000 request এবং প্রতি invocation-এ 10 ms CPU; static-asset request বিনামূল্যে ও সীমাহীন। Paid Workers plan-এ যাওয়া স্বয়ংক্রিয়ভাবে এই সেটআপের অংশ নয়। সীমার বাইরে গেলে আগে খরচ/plan যাচাই করতে হবে।

## গুরুত্বপূর্ণ কার্যকরী সীমা

Cloudflare hosting নিজে থেকে Supabase-এর অনুপস্থিত `dynamic-action` payment verification function বা fulfillment/admin RPC তৈরি করে না। তাই hosting preview সফল হলেও order → payment → admin fulfillment-এর সম্পূর্ণ end-to-end flow আলাদাভাবে Supabase-এ implement ও test করতে হবে। বর্তমান deployment যাচাইয়ের সময় production data-তে write করা যাবে না।
