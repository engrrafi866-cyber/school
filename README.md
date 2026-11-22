# আলোকিত প্রাথমিক বিদ্যালয় — School Management

বাংলা ভাষার paperless school management web app। Admin login দিয়ে শিক্ষার্থী, শিক্ষক, শ্রেণি, উপস্থিতি, ফি, নোটিশ, স্কুলের পরিচিতি এবং ব্যক্তিগত নথি পরিচালনা করা যায়। রেকর্ড Supabase database-এ এবং ফাইল private Supabase Storage-এ থাকে।

## Backend

এই আলাদা school project-এর Supabase backend ইতিমধ্যে তৈরি ও configure করা আছে। Browser-এ শুধু Supabase publishable key ব্যবহার হয়; private service-role key কখনো frontend-এ রাখা হয়নি। সব private school table Row Level Security (RLS) দিয়ে সুরক্ষিত।

Database schema ও পরবর্তী index/policy পরিবর্তনগুলো supabase/migrations/ ফোল্ডারে আছে। Storage bucket private এবং প্রতি ফাইলের সীমা ১০ MB।

## চালানো

Hosted static server ব্যবহার করুন, অথবা repository root-এ local server চালান:

    python -m http.server 8000

তারপর http://localhost:8000 খুলুন। সরাসরি file:// দিয়ে খুললে Supabase authentication redirect কাজ নাও করতে পারে।

## প্রথম অ্যাডমিন অ্যাকাউন্ট

1. সাইটে Admin Login খুলুন এবং “প্রথমবার? অ্যাডমিন অ্যাকাউন্ট তৈরি করুন” নির্বাচন করুন।
2. নিজের নাম, ইমেইল ও অন্তত ৮ অক্ষরের পাসওয়ার্ড দিয়ে account তৈরি করুন।
3. Supabase-এ email confirmation চালু থাকলে ইমেইলের link খুলে account নিশ্চিত করুন, তারপর login করুন।
4. login-এর পর একবারের Admin Setup Key দিয়ে প্রথম অ্যাডমিন setup সম্পন্ন করুন। এই key শুধু একবার কাজ করে এবং সফল setup-এর পর server থেকে মুছে যায়।
5. Setup Key ব্যক্তিগতভাবে সংরক্ষণ করুন; এটি GitHub repository বা browser source-এ রাখা হয়নি।

কোনো demo password বা পূর্বভরা শিক্ষার্থী/শিক্ষক তথ্য নেই। Admin password Supabase Auth-এ সংরক্ষিত হয়। Login পাতা থেকে password recovery email চাওয়া যায়।

## Supabase Auth redirect configuration

Supabase Dashboard → Authentication → URL Configuration-এ local development-এর জন্য http://localhost:8000 যোগ করুন। GitHub Pages ব্যবহার করলে আপনার নির্দিষ্ট Pages URL-ও Site URL এবং allowed redirect URLs-এ যোগ করুন। Email confirmation ও password recovery link সঠিক host-এ ফেরার জন্য এটি দরকার।

## GitHub Pages

GitHub Actions workflow-টি হাতে চালিয়ে Pages প্রকাশ করা যায়, তবে public site URL তৈরি হয়। বিদ্যালয়ের ব্যক্তিগত তথ্য ব্যবহারের আগে প্রকল্পের GitHub Pages visibility ও Supabase Auth redirect URL ঠিক করে নিতে হবে। Deployment workflow শুধু workflow_dispatch-এ চলে; প্রতি push-এ নিজে deploy করে না।

## পরিচালনা ও backup

- শিক্ষার্থী, শিক্ষক, শ্রেণি, উপস্থিতি, ফি, নোটিশ ও স্কুল পরিচিতি তৈরি, সম্পাদনা এবং মুছে ফেলা যায়।
- CSV report এবং JSON school-data backup download করা যায়; backup থেকে records যোগ/হালনাগাদ করা যায়।
- Documents private storage-এ upload/download/delete হয়। JSON backup-এ document file bytes থাকে না; নথি আলাদাভাবে download করতে হবে।
- নতুন তথ্য cloud database-এ save হয়, তাই একই অ্যাডমিন account দিয়ে অন্য ডিভাইস থেকেও দেখা যায়।

## নিরাপত্তা

Supabase RLS admin-কে তার school-এর records-এ সীমাবদ্ধ রাখে। প্রথম admin claim-এর জন্য authenticated session ও one-time setup key লাগে। Browser configuration-এ project URL, school ID এবং publishable key আছে; এগুলো client-side use-এর জন্য। service-role key কখনো repository বা frontend-এ যোগ করবেন না।
