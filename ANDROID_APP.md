# Android app and Google Play publishing

The live school management site is an installable Progressive Web App (PWA): https://engrrafi866-cyber.github.io/school/

## Install on Android now (without Play Store)

Open the live URL in Chrome, open the three-dot menu, and choose **Install app** or **Add to Home screen**. The app opens in a standalone window. It needs an internet connection for login and school records. Never store student/teacher personal records in public GitHub files or the service-worker cache.

## Google Play release (not yet published)

A PWA manifest does not itself produce an Android App Bundle (AAB) or publish an app. An adult developer account holder must complete Play Console registration, app ownership verification, app signing, store listing, Data safety form, privacy policy, testing requirements, and review. A Trusted Web Activity (TWA) Android wrapper can package this PWA as an AAB, but requires Android Digital Asset Links verification for the hosted domain. Because this app uses a github.io subdomain, carefully configure and verify the relationship; a dedicated domain may simplify this.

Before any Play release, verify the role-based user approvals, Supabase auth redirect configuration, and protection of student information with test accounts. Do not enter an IPEMIS credential into this app; it has independent Supabase authentication.
