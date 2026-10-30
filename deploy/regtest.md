# Local regtest faucet

Test without anyone's faucet: run a local Zebra + Zaino regtest network
([zcash_local_net](https://github.com/zingolabs/infrastructure/tree/dev/zcash_local_net) launches the pair),
mine some blocks to an address of the faucet wallet, then:

```bash
docker run --rm -p 8080:8080 --network host -v $PWD/regtest-data:/data \
  -e NETWORK=regtest -e LWD_SERVER=127.0.0.1:8137 -e AUTH=none \
  ghcr.io/anukulpandey/zcash-faucet-server:latest

npx zcash-faucet uregtest1... --faucet http://localhost:8080
```

`AUTH=none` turns off GitHub login. Only use it on your own machine.
