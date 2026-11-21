/**
 * Sign-In with Antelope, checked on chain: a proof that account@permission signed a
 * message in the Alcor Signer (`session.walletPlugin.proveAccount`).
 *
 * The message is CAIP-122 (the fields of Sign-In with Ethereum) and the signature covers
 *   sha256("\x19Antelope Signed Message:\n" + byte length of the text + text)
 * The contract rebuilds the text from the fields byte for byte (src/proof.ts does the same
 * off chain), recovers the key with `recover_key` (passkey SIG_WA_ signatures included: the
 * chain itself checks that the WebAuthn challenge is the digest) and asks
 * `check_permission_authorization` whether that key alone satisfies the permission now.
 * A key taken off the account stops proving it at once.
 *
 *   init(chain_id)                    the chain this deployment runs on; CDT cannot read it
 *   verify(message, sig) -> key       read-only: call it with send_read_only_transaction,
 *                                     no signature and no resources needed
 *   consume(payer, message, sig)      verify, then burn (domain, nonce) for the account until
 *                                     the proof expires: the same proof passes once
 *
 * `verify` does not know your site: compare `domain` with your own and the nonce with the
 * one you issued. A proof says who controls the account. It is not permission to move
 * anything on their behalf.
 *
 * Build: cdt-cpp -abigen -o msgproof.wasm msgproof.cpp
 */
#include <eosio/crypto.hpp>
#include <eosio/eosio.hpp>
#include <eosio/permission.hpp>
#include <eosio/singleton.hpp>
#include <eosio/system.hpp>
#include <eosio/time.hpp>

#include <string>

using namespace eosio;

class [[eosio::contract("msgproof")]] msgproof : public contract {
public:
   using contract::contract;

   static constexpr uint32_t max_lifetime_s = 3600;
   static constexpr uint32_t clock_skew_s = 60;
   /// 300 characters in the Signer, at most 4 UTF-8 bytes each.
   static constexpr size_t max_statement_bytes = 1200;
   static constexpr size_t max_host_bytes = 253;
   static constexpr size_t max_uri_bytes = 512;
   static constexpr size_t expired_per_consume = 8;

   struct proof {
      name           account;
      name           permission;
      std::string    domain;
      std::string    uri;
      std::string    statement;
      std::string    nonce;
      time_point_sec issued_at;
      time_point_sec expires_at;
   };

   /// The chain this deployment runs on: CDT has no intrinsic for it.
   [[eosio::action]] void init(checksum256 chain_id);

   /// Checks a proof and returns the key that signed it. Read-only: call it with
   /// `send_read_only_transaction`, no signature and no resources needed.
   /// The caller still compares `domain` with its own and `nonce` with the one it issued.
   [[eosio::action, eosio::read_only]] public_key verify(const proof& message, const signature& sig);

   /// `verify`, then burns the nonce for message.account and message.domain: a second
   /// consume of the same proof fails. `payer` pays the RAM until the proof expires.
   [[eosio::action]] void consume(name payer, const proof& message, const signature& sig);

   /// The text the signature covers, for clients that want to show it.
   static std::string text_of(const proof& message, const checksum256& chain_id);
   static checksum256 digest_of(const std::string& text);

   struct [[eosio::table("config")]] config_row {
      checksum256 chain_id;
   };
   using config_table = singleton<"config"_n, config_row>;

   /// Scope: account. One row per (domain, nonce) until the proof expires.
   struct [[eosio::table("used")]] used_row {
      uint64_t       id;
      checksum256    key;
      time_point_sec expires_at;

      uint64_t primary_key() const { return id; }
      uint64_t by_expiry() const { return expires_at.utc_seconds; }
   };
   using used_table = multi_index<
      "used"_n,
      used_row,
      indexed_by<"byexpiry"_n, const_mem_fun<used_row, uint64_t, &used_row::by_expiry>>
   >;

private:
   checksum256 chain_id() const;
   public_key check_proof(const proof& message, const signature& sig) const;
};

namespace {

constexpr char prefix[] = "\x19" "Antelope Signed Message:\n";

std::string decimal(uint64_t value) {
   if (value == 0) return "0";
   std::string out;
   for (; value > 0; value /= 10) out.insert(out.begin(), char('0' + value % 10));
   return out;
}

std::string two(uint32_t value) { return std::string(1, char('0' + value / 10)) + char('0' + value % 10); }

/// "2026-11-21T12:00:00Z": days to a civil date (H. Hinnant), as JS `toISOString` without ms.
std::string iso(time_point_sec time) {
   const int64_t seconds = time.utc_seconds;
   const int64_t days = seconds / 86400;
   const uint32_t rest = seconds % 86400;

   const int64_t z = days + 719468;
   const int64_t era = z / 146097;
   const uint32_t doe = static_cast<uint32_t>(z - era * 146097);
   const uint32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
   const uint32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
   const uint32_t mp = (5 * doy + 2) / 153;
   const uint32_t day = doy - (153 * mp + 2) / 5 + 1;
   const uint32_t month = mp < 10 ? mp + 3 : mp - 9;
   const int64_t year = static_cast<int64_t>(yoe) + era * 400 + (month <= 2 ? 1 : 0);

   check(year >= 1970 && year <= 9999, "time is out of range");
   return decimal(year) + "-" + two(month) + "-" + two(day) + "T" + two(rest / 3600) + ":" + two(rest / 60 % 60) +
          ":" + two(rest % 60) + "Z";
}

std::string hex(const checksum256& value) {
   static constexpr char digits[] = "0123456789abcdef";
   const auto bytes = value.extract_as_byte_array();
   std::string out;
   for (const auto byte : bytes) {
      out += digits[byte >> 4];
      out += digits[byte & 0x0f];
   }
   return out;
}

/// One line of the text: a newline or any control byte inside a field would let two
/// different proofs share one text.
void check_line(const std::string& value, size_t max, const char* what) {
   check(!value.empty(), std::string(what) + " is empty");
   check(value.size() <= max, std::string(what) + " is too long");
   for (const unsigned char c : value) check(c >= 0x20 && c != 0x7f, std::string(what) + " has a control character");
}

void check_nonce(const std::string& nonce) {
   check(nonce.size() >= 16 && nonce.size() <= 64, "nonce must be 16 to 64 characters");
   for (const char c : nonce) {
      const bool alnum = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
      check(alnum, "nonce must be letters and digits");
   }
}

} // namespace

std::string msgproof::text_of(const proof& message, const checksum256& chain_id) {
   return message.domain + " wants you to sign in with your Antelope account:\n" +
          message.account.to_string() + "@" + message.permission.to_string() + "\n" +
          "\n" +
          message.statement + "\n" +
          "\n" +
          "URI: " + message.uri + "\n" +
          "Version: 1\n" +
          "Chain ID: " + hex(chain_id) + "\n" +
          "Nonce: " + message.nonce + "\n" +
          "Issued At: " + iso(message.issued_at) + "\n" +
          "Expiration Time: " + iso(message.expires_at);
}

checksum256 msgproof::digest_of(const std::string& text) {
   const std::string preimage = std::string(prefix) + decimal(text.size()) + text;
   return sha256(preimage.data(), preimage.size());
}

checksum256 msgproof::chain_id() const {
   config_table config(get_self(), get_self().value);
   check(config.exists(), "contract is not initialized");
   return config.get().chain_id;
}

public_key msgproof::check_proof(const proof& message, const signature& sig) const {
   check(message.account != name{}, "account is empty");
   check(message.permission != name{}, "permission is empty");
   check_line(message.domain, max_host_bytes, "domain");
   check_line(message.uri, max_uri_bytes, "uri");
   check_line(message.statement, max_statement_bytes, "statement");
   check_nonce(message.nonce);

   const uint32_t now = current_time_point().sec_since_epoch();
   const uint32_t issued = message.issued_at.utc_seconds;
   const uint32_t expires = message.expires_at.utc_seconds;
   check(expires > issued, "proof expires before it is issued");
   check(expires - issued <= max_lifetime_s, "proof lives longer than an hour");
   check(issued <= now + clock_skew_s, "proof is issued in the future");
   check(now < expires, "proof has expired");

   const public_key key = recover_key(digest_of(text_of(message, chain_id())), sig);
   check(check_permission_authorization(message.account, message.permission, std::set<public_key>{key}),
         "the signing key does not satisfy " + message.account.to_string() + "@" + message.permission.to_string());
   return key;
}

void msgproof::init(checksum256 chain_id) {
   require_auth(get_self());
   config_table(get_self(), get_self().value).set(config_row{chain_id}, get_self());
}

public_key msgproof::verify(const proof& message, const signature& sig) { return check_proof(message, sig); }

void msgproof::consume(name payer, const proof& message, const signature& sig) {
   require_auth(payer);
   check_proof(message, sig);

   used_table used(get_self(), message.account.value);
   const uint32_t now = current_time_point().sec_since_epoch();

   auto by_expiry = used.get_index<"byexpiry"_n>();
   size_t erased = 0;
   for (auto it = by_expiry.begin(); it != by_expiry.end() && it->expires_at.utc_seconds <= now && erased < expired_per_consume;
        ++erased) {
      it = by_expiry.erase(it);
   }

   const std::string id = message.domain + "\n" + message.nonce;
   const checksum256 key = sha256(id.data(), id.size());
   const auto bytes = key.extract_as_byte_array();
   uint64_t row_id = 0;
   for (size_t i = 0; i < 8; ++i) row_id = (row_id << 8) | bytes[i];

   // A row with the same id, even for another nonce, counts as used: never a second pass.
   check(used.find(row_id) == used.end(), "this proof was already used");
   used.emplace(payer, [&](auto& row) {
      row.id = row_id;
      row.key = key;
      row.expires_at = message.expires_at;
   });
}
