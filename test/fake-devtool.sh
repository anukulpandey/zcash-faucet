#!/bin/sh
# Stand-in for zcash-devtool so the server can be tested without a real wallet or TAZ.
case "$*" in
  *" init "*) mkdir -p "$3" && touch "$3/data.sqlite" ;;
  *list-addresses*) echo "Account 1"; echo "     Default Address: utest1fakedonationaddress000000000000000000" ;;
  *sync*) ;;
  *"balance --json"*) echo '{"total":50000000,"sapling_spendable":0,"orchard_spendable":0,"ironwood_spendable":50000000,"transparent_spendable":0,"chain_tip_height":3700000}' ;;
  *send*) read ans; [ "$ans" = y ] || exit 1; case "$*" in *utest1fail*) echo "SendFailed: boom" >&2; exit 1;; esac
          echo "Creating transaction..."; echo "Sending transaction..."; echo "ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34" ;;
esac
