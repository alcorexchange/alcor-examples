# Alcor examples

Small, runnable scripts for building on [Alcor](https://alcor.exchange): deposit addresses (crypto payments
and top-ups from any wallet or exchange), sign-up by deposit, addresses that swap, transfer streams and the bridge's light clients. Each one is a single file
you can read in a minute, hand to an AI agent, or copy into your project.

None of them holds a key or sends a transaction: they talk to the public API and read the chain. Money
only moves when somebody sends it to an address they print.

```bash
npm install
node examples/01-deposit-address.ts wax yourproject user-42
```

Node 22.18 or later runs the `.ts` files as they are. `npm run typecheck` checks them.

## The examples

| Script | What it does |
| --- | --- |
| [`01-deposit-address.ts`](examples/01-deposit-address.ts) | A deposit address for one of your users: whatever they send, on any listed network and straight from an exchange too, is paid out to your account with your memo |
| [`02-follow-address.ts`](examples/02-follow-address.ts) | Follow a deposit address live: the money at the address, then the crossing to the payout (server-sent events) |
| [`03-create-account.ts`](examples/03-create-account.ts) | Sign up a user with no wallet: an address whose first deposit creates `<nick>.ac` on Telos with keys made locally |
| [`04-account-status.ts`](examples/04-account-status.ts) | Where a sign-up address stands: account created, money waiting, the name taken |
| [`05-credit-users.ts`](examples/05-credit-users.ts) | A backend following every deposit paid out to your account, for all your users at once |
| [`06-swap-address.ts`](examples/06-swap-address.ts) | An address that swaps on the way (beta): USDC on Polygon in, GRAM on TON out, with a live estimate |
| [`07-light-clients.ts`](examples/07-light-clients.ts) | The bridge's light clients as your contract would read them: proved blocks on Telos, trusted Telos roots on EVM chains |
| [`08-invoice.ts`](examples/08-invoice.ts) | Crypto payments for an order: an address per invoice with the order id as memo, then wait until it is paid |
| [`contract/payments.cpp`](contract/payments.cpp) | The merchant contract on Telos, WAX, XPR or Vaulta that receives those payments: `on_notify`, the checks, never failing the transfer |

[`src/alcor.ts`](src/alcor.ts) holds what they share: the API calls, the event-stream reader, a Telos table
read, and printing an address the way a user should see it.

## Settings

| Variable | Default |
| --- | --- |
| `ALCOR_BRIDGE_API` | `https://telos.alcor.exchange/api/bridge` |
| `TELOS_RPC` | `https://telos.greymass.com` |

## Read more

* [Bridge](https://docs.alcor.exchange/api/bridge): the integration guide: deposit addresses, link, widget, API, contracts
* [Account factory](https://docs.alcor.exchange/developers-api/account-factory): accounts on Telos, WAX and XPR from one transfer
* [Light clients](https://docs.alcor.exchange/developers-api/light-clients): checking other chains in your own contract
* [Full API reference](https://telos.alcor.exchange/api/bridge/docs), [signing on every chain](https://telos.alcor.exchange/api/bridge/docs/bot), [OpenAPI](https://telos.alcor.exchange/api/bridge/openapi.yaml)
* [AGENTS.md](AGENTS.md): the rules for an AI agent using these

## License

MIT
