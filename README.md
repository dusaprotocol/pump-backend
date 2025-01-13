# Duser Pump backend

## Fill environment variables

Create `.env` file following `.env.example` schema:

- `DATABASE_URL` is a read/write access to your PostgreSQL database
- `WS_API_URL1` & `WS_API_URL2 (optional)` are the URLs of the API so that the indexer communicates when a new token/swap occurs
- `JWT_SECRET` is for authenticating users. It can be whatever you want (do not share it)
- `DISCORD_WEBHOOK` is the URL of the Discord webhook to send notifications when a new token is created (optional)

## Running

Install dependencies

```sh
pnpm install
```

Run API

```sh
pnpm start:api
````

Run indexer
```sh
pnpm start:indexer
```
