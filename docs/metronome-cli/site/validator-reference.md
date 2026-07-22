# validator-reference
- schemaVersion: `metro.docs.validator-reference.v1`
## Validator rules

| id | severity | message |
| --- | --- | --- |
| MTR-TENANT-001 | error | Choose exactly one tenant with --sandbox, --prod, or a profile that resolves to one tenant. |
| MTR-TENANT-002 | error | Bind production approval to the exact reviewed preview hash before apply can proceed. |
| MTR-TENANT-003 | error | Configure the profile with one explicit tenant and a matching tenant-scoped Metronome key environment variable name. |
| MTR-TENANT-004 | error | Re-run preview and preflight with the current tenant key or restart approval after confirming the key change. |
| MTR-ENDPOINT-001 | error | Cite endpoint-matrix and a reviewed endpoint source such as an official Metronome doc or local skill before treating the endpoint as apply evidence. |
| MTR-ENDPOINT-002 | error | Use the exact method and path from the local endpoint matrix and cite the reviewed source ID that supports it. |
| MTR-APIREQ-001 | error | Add the required endpoint request field or policy evidence before any preview or future live runner can use this endpoint. |
| MTR-APIREQ-002 | error | Remove fields forbidden by the reviewed endpoint contract and use the endpoint-specific workflow shape when the operation needs richer policy evidence. |
| MTR-APIREQ-003 | error | Remove API keys, bearer tokens, passwords, and secret-shaped fields. The CLI should reference tenant profiles and env var names, never inline secrets. |
| MTR-APIREQ-004 | error | Adjust the request to match the reviewed endpoint contract and required local policy gates before any preview or future apply is considered. |
| MTR-PKG-001 | error | Provide packageAlias for package-based workflows. |
| MTR-PKG-002 | error | Provide a stable uniquenessKey of 128 characters or fewer. |
| MTR-PKG-003 | error | Use the restricted package contract-create shape: customer_id, starting_at, package_alias or package_id, uniqueness_key, and transition only. |
| MTR-PKG-004 | error | Verify the package alias resolves to the intended package at the workflow timestamp before previewing package moves or old-version archive. |
| MTR-PKG-010 | error | Set creditGrantMode to monthly-drip for 1/12 credit grants or lump-sum only when finance explicitly requires legacy behavior. |
| MTR-PKG-011 | error | Provide annualCreditsTotal, fixedProductId, accessCreditTypeId, and commitName for recurring_commits credit modeling. |
| MTR-PKG-012 | error | Provide creditAmount (positive integer), trialDurationDays (1-365 integer), rolloverFraction (0 to 1), and accessCreditTypeId. The shape generates commit_duration.unit PERIODS, duration.value as a string, starting_at_offset, and proration automatically. |
| MTR-PKG-013 | error | Set noStripeConfirmed: true to confirm this package has no billing_provider and no invoice_amount on the commit - no Stripe invoice will be generated. |
| MTR-RATE-001 | error | State the current entitlement evidence and close retired product rates with entitled:false. |
| MTR-RATE-002 | error | Set billingFrequency to the frequency required by the shape. |
| MTR-RATE-003 | error | Close every affected rate-card entry with entitled:false and price:0 before archiving the product. |
| MTR-RATE-004 | error | Provide startingAt as a UTC hour-boundary timestamp. |
| MTR-RATE-005 | error | Prove the USAGE product pricing and presentation group keys are backed by one compound billable-metric group key, and provide reviewed per-dimension rate rows. |
| MTR-TIME-001 | error | Use an ISO timestamp ending in :00:00Z or :00:00.000Z. |
| MTR-TIME-002 | error | Use a future UTC hour-boundary timestamp for no-immediate-invoice workflows. |
| MTR-TIME-004 | error | Archive an old package version only after the replacement package alias is live and verified by package read-back evidence. |
| MTR-BILL-001 | error | Attach or plan a Stripe billing provider config before an invoice-producing workflow. |
| MTR-BILL-002 | error | Provide exactly one of deliveryMethodId or deliveryMethod. Use deliveryMethodId for multi-entity Stripe billing, or direct_to_billing_provider for the single-entity shorthand. |
| MTR-BILL-003 | error | Choose an existingConfigPolicy such as fail_if_exists or reuse_if_matching before planning attachment. |
| MTR-BILL-004 | error | Set the shape-specific Stripe draft behavior field explicitly before preview. |
| MTR-BILL-005 | error | Set deliveryMethodScope explicitly. For multi_entity delivery, provide matching deliveryMethodId evidence, targetStripeAccountId, accountBillingProviderReviewed: true, and endpointFieldsReviewed: true. |
| MTR-SUB-001 | error | Provide an explicit subscriptions[] plan with subscription_rate, collection schedule, proration, and quantity management mode before preview. |
| MTR-SUB-002 | error | Make subscription_rate.billing_frequency match the verified rate-card subscription rate frequency. |
| MTR-SUB-003 | error | Use the same SubscriptionProductListItem product_id in the rate-card evidence, subscription_rate, and override specifiers. |
| MTR-SUB-004 | error | For QUANTITY_ONLY provide initialQuantity. For SEAT_BASED direct contracts provide seatConfig.seatGroupKey and seatConfig.initialSeatIds. |
| MTR-CUSTOM-001 | error | Provide an existing metronomeCustomerId or explicitly request createMetronomeCustomer with externalCustomerId (externalId accepted as a customer lookup key) before preview. |
| MTR-CUSTOM-002 | error | Use the local direct enterprise custom-contract shape with contractType direct, explicitStartingAt, and no package fields. |
| MTR-CUSTOM-003 | error | Provide explicit rate card, recurring commit, invoice, seat-limit, verification, and remediation terms before preview. |
| MTR-CUST-001 | error | Provide companyName, externalCustomerId, primaryIngestAlias, and the full ingestAliases list before planning customer setup. |
| MTR-CUST-002 | error | Plan customer lookup by ingest alias, review archived-customer collisions, and choose fail_if_exists or reuse_if_exact_match before customer create. |
| MTR-CUST-003 | error | Declare the hierarchy mode and provide contract-level hierarchy review evidence before previewing non-standalone customer setup. |
| MTR-CUST-004 | error | Approve every custom field key for the Metronome customer entity and keep each value within Metronome custom-field limits. |
| MTR-INV-001 | warning | Use a future UTC hour boundary or explicitly confirm immediate invoice behavior in a later preview/apply workflow. |
| MTR-INV-002 | error | Only void a reviewed invoice after proving invoice status, Stripe payment/refund handling, reconciliation plan, read-back checks, and remediation ownership. |
| MTR-INV-003 | error | Use updateEndDate rather than archive for this shape and inspect current invoices before planning the move. |
| MTR-INV-004 | error | Only update DRAFT invoice issue dates after invoice read-back, contract-end evidence, billing-provider review, explicit Stripe behavior, and remediation planning exist. |
| MTR-INV-005 | error | Regenerate only a reviewed VOID invoice after proving correction inputs, billing-provider distribution behavior, replacement invoice read-back, and reconciliation/remediation plans. |
| MTR-PAY-001 | error | Review that the invoice is FINALIZED, PLG invoicing is enabled, a billing provider is attached, and the customer payment method path is ready before attempting payment. |
| MTR-PAY-002 | error | List payment attempts first and prove there is no successful payment, no conflicting in-flight attempt, and a read-back plan before retrying or canceling payment. |
| MTR-PAY-003 | error | Cancel only a reviewed pending payment attempt and document customer communication, retry/remediation, and payment read-back evidence before future live execution. |
| MTR-IDEMP-001 | error | Provide a deterministic contractUniquenessKey of 128 characters or fewer for successor contract creation. |
| MTR-IDEMP-002 | error | Provide one stable transaction_id per event and reuse the same transaction_id for retries. |
| MTR-IDEMP-003 | error | Review existing objects by stable business key before future create workflows so retries or re-runs do not create duplicate catalog objects. |
| MTR-VERIFY-001 | error | Provide read-back verification for each endpoint or business effect that a future apply would change. |
| MTR-VERIFY-002 | error | Provide a specific rollbackPlan describing how to recover if the move preview or future apply is wrong. |
| MTR-VERIFY-003 | error | Provide a one-customer or one-event canary plan, read-back checks, and resume criteria before bulk execution. |
| MTR-USAGE-001 | error | State the invoice period target, finalized-period status, preview-events requirement, and remediation path before any ingest workflow. |
| MTR-USAGE-002 | error | Provide customer_id, event_type, timestamp, transaction_id, and required dimensional properties for each usage event. |
| MTR-USAGE-003 | error | Provide explicit invoicePeriodTarget, canaryEventCount, and post-ingest read-back plan before bulk ingest. |
| MTR-CREDIT-001 | error | Provide accessCreditTypeId for the product or access credit type. |
| MTR-CREDIT-002 | error | Omit invoiceSchedule for a pure access grant, or use a fiat credit type such as USD cents for a zero-dollar audit line. |
| MTR-CREDIT-003 | error | Omit invoiceSchedule, or set invoiceSchedule.auditLineIntentConfirmed to true and keep unitPriceCents at 0. |
| MTR-CREDIT-004 | error | For paid credit workflows, provide a positive fiat amount in cents. Complimentary grants must use 0 when an audit line is intended. |
| MTR-CREDIT-005 | error | Approve every custom field key for the target Metronome object type before including custom_fields in a preview payload. |
| MTR-CREDIT-006 | error | State paid_topup_invoice_expected, paymentGateType STRIPE, explicit stripeBehavior, duplicate-name review, read-back checks, and rollback/remediation before preview. |
| MTR-REPO-001 | error | Extract reusable logic into tested metronome-cli modules and leave old one-off or quarantined scripts as evidence only. |
| MTR-REPO-002 | error | Use generated artifacts only as evidence with a boundary document; cite current source files for workflow behavior. |
| MTR-REPO-003 | error | Keep Hyperline evidence historical unless the user explicitly asks for legacy migration work. |


## Agent notes

- Prefer `--json` when scripting parsers; use `--markdown` when loading context into an agent.
- Never treat HTML as the source of truth — regenerate from `metro docs <ref> --markdown`.
- Live reads/writes still require tenant flags + confirmation tokens.

