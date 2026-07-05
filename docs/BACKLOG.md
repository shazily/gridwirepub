# Product backlog

## Completed (2026-07-05)

- [x] Alerts & feedback in main nav (all members); admin review on Feedback tab
- [x] Gmail-style storage usage bar in sidebar + `/storage` page for everyone
- [x] Email ingest: upload Excel/CSV template → column schema validation on attachments
- [x] Email ingest audit trail (accept/reject logged to `audit_events`)
- [x] Email ingest Test panel (simulate inbound without external mail gateway)
- [x] Platform test suite: unit + HTTP feature checks (`npm test`)
- [x] Marketing "What's new" section, Help manual & FAQ updates
- [x] Admin console submenu, portal security, help tips, PageNav

## Follow-up

- [ ] Full ClamAV sidecar + INSTREAM scan for email attachments
- [ ] Email ingest → dataset publish worker (accepted emails → Minio → dataset)
- [ ] Fix smoke-test.ps1 false positives (404 portal API, 401 metrics treated as errors)
