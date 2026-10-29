# Apple RC status

Current integration branch: `release/apple-rc-v1`.

This branch intentionally starts from the latest `staging` feature baseline and is the only branch intended for the first iOS App Store release-candidate work.

Before promotion to Production/main:

- merge current `main` into this branch so the Production security history is represented;
- require all existing CI jobs plus `iOS App Store Release Candidate` to pass;
- run one manual TestFlight upload from this exact branch after Apple secrets are configured;
- complete physical iPhone acceptance from that exact TestFlight build;
- do not enable iOS native push in V1;
- do not submit while the review trip/departure/payment flow is unavailable.

Promotion to `main` is a separate explicit action and is not performed by the RC workflow.