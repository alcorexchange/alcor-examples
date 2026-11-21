/**
 * A merchant contract that takes payments through Alcor deposit addresses.
 *
 * Give each order (or each user) a deposit address paid out to this contract
 * with the order's id as the memo:
 *
 *   POST /v1/deposit-addresses { "chain": "wax", "to": "<this contract>", "memo": "order-1001" }
 *
 * Whatever the customer sends to that address, from Ethereum, BNB Smart Chain,
 * Polygon, TON, NEAR, Sui or Solana, straight from an exchange too, arrives
 * here as an ordinary `transfer` from `bridge.alcor` with that memo. This
 * contract records it in `payments`; your backend reads the table, or reacts
 * to the notification.
 *
 * Two rules matter:
 *   - Credit only a real payout: the token contract you expect, sent by
 *     `bridge.alcor`. Anyone can notify you of a fake token with any memo.
 *   - Never fail the bridge's transfer. A refused payout goes back to the
 *     deposit address and waits there for support. What you do not expect
 *     (another token, an unknown memo) is let through and settled with the
 *     customer your own way.
 *
 * Build: cdt-cpp -abigen -o payments.wasm payments.cpp
 */
#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/system.hpp>

using namespace eosio;

class [[eosio::contract("payments")]] payments : public contract {
public:
   using contract::contract;

   [[eosio::on_notify("*::transfer")]]
   void on_transfer(name from, name to, asset quantity, std::string memo) {
      if (to != get_self()) return;              // our own outgoing transfer
      if (from != BRIDGE) return;                // not a bridge payout: not ours to credit
      if (!accepted(get_first_receiver(), quantity.symbol)) return;

      // On WAX, XPR and Vaulta the memo is exactly yours. On Telos it is
      // `<your memo>|<network>:<deposit address>`: keep the part before '|'.
      const std::string ref = memo.substr(0, memo.find('|'));

      payments_table t(get_self(), get_self().value);
      t.emplace(get_self(), [&](auto& p) {
         p.id       = t.available_primary_key();
         p.ref      = ref;
         p.quantity = quantity;
         p.token    = get_first_receiver();
         p.at       = current_time_point();
      });
   }

   /** Your backend marks a payment as handled once it has credited the order, freeing the row. */
   [[eosio::action]] void handled(uint64_t id) {
      require_auth(get_self());
      payments_table t(get_self(), get_self().value);
      t.erase(t.require_find(id, "no such payment"));
   }

private:
   static constexpr name BRIDGE = "bridge.alcor"_n;

   /**
    * The tokens a payout can be in. Bridged tokens (USDC, USDT, ETH, BNB, POL,
    * SOL…) are `wrap.alcor`; a chain's own coin is its own token contract
    * (`eosio.token` on Telos, WAX and XPR; `core.vaulta` on Vaulta). List only
    * what you sell for, with the symbol and precision you expect.
    */
   static bool accepted(name token, symbol sym) {
      if (token == "wrap.alcor"_n) return sym == symbol("USDC", 6) || sym == symbol("USDT", 6);
      return false;
   }

   struct [[eosio::table]] payment {
      uint64_t    id;
      std::string ref;       // the memo: your order or user id
      asset       quantity;  // what arrived, after the forward's gas
      name        token;
      time_point  at;
      uint64_t primary_key() const { return id; }
   };
   typedef multi_index<"payments"_n, payment> payments_table;
};
