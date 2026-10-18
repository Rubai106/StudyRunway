# Wise quote preview setup

StudyRunway can request an unauthenticated Wise quote for display, including
the rate, Wise fee/price information, payout method, and estimated delivery.
The quote is illustrative: it has no locked rate or usable transfer ID, and
StudyRunway never creates or funds a transfer.

## Enable locally

1. Confirm the current Wise Platform terms allow your application to display
   unauthenticated quotes. Wise describes these as illustrative quotes for
   partner interfaces. If StudyRunway is not onboarded, contact Wise Platform
   before enabling the production endpoint.
2. In the repository's ignored `.env.local`, set:

   ```dotenv
   WISE_QUOTES_ENABLED=true
   WISE_QUOTES_ENV=production
   ```

3. Restart `npm run dev`, open a transfer-comparison result, enter an amount
   and currency pair, then select **Fetch Wise quote**. Production responses
   are labelled **Wise live indicative estimate**. The UI fetches a new quote
   on demand and does not cache it.

No API secret is needed for standard unauthenticated quotes. `WISE_QUOTES_ENV=sandbox`
uses `https://api.wise-sandbox.com` and returns non-live test quotes. The
default API version is currently `2026Q4`.

## Enable on Cloud Run

For an approved deployment, open the Cloud Run service, choose **Edit and deploy
new revision**, and add these environment variables under **Variables & secrets**:

```text
WISE_QUOTES_ENABLED=true
WISE_QUOTES_ENV=production
```

Deploy the revision. Keep the flag `false` until Wise Platform confirms the
production integration is permitted. If you want sandbox verification first,
set `WISE_QUOTES_ENV=sandbox`; sandbox responses are clearly labelled as not
live.

## What the comparison does

- **Fetch Wise quote** calls the server route `/api/transfers/wise-quote`.
  Only the amount and currency pair are sent to Wise; no student identity or
  account details are sent.
- The quote displays each enabled pay-in/payout option with the rate, fees,
  amount Wise estimates the recipient will get, and delivery estimate.
- **Add option to comparison** fills a provider row. The recipient/intermediary
  charge remains blank; enter it only from a reliable source. An unknown charge
  keeps that quote out of the confident ranking.
- Other providers still need their actual quote details entered manually. The
  chat `compare_transfers` tool remains reference-data-only.
- A quote is not a guaranteed offer. Refresh it and confirm all charges,
  recipient details, delivery, and university receipt requirements with Wise
  and the receiving institution before deciding.

## Partner-specific pricing and public deployment

The current integration uses the unauthenticated display-quote endpoint and
standard Wise pricing. Wise partner-specific pricing requires its OAuth
client-credentials flow; Wise's current partner OAuth setup also requires
mTLS. This repository does not yet implement token issuance, token renewal, or
mTLS, so do not paste a Wise client secret or private certificate into a chat,
browser variable, or source file. A production partner integration needs a
separate server-side credential and certificate design approved by Wise.

The route applies a small per-process request limit, but that limit is not
shared across Cloud Run instances. Before exposing this endpoint to unrestricted
public traffic, add an edge/shared rate limit or authenticated access. The
feature flag defaults off.
