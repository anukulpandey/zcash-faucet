# Demo GIF for the README and launch posts. Record with:  vhs docs/demo.tape
#
# Before recording:
#   1. The faucet is funded (npx zcash-faucet --status shows claims left > 0).
#   2. You've claimed once yourself, so the GitHub login is cached and no device code shows up.
#   3. Replace TESTNET_ADDRESS below with a testnet address that hasn't claimed in the last 24h.

Output docs/demo.gif

Require npx

Set Shell zsh
Set FontSize 16
Set Width 1280
Set Height 760
Set Padding 28
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set TypingSpeed 45ms

# Off camera: quiet npm warnings, warm the npx cache, wake the Render server (cold start ~2 min).
Hide
Type "export npm_config_loglevel=error PS1='%F{green}❯%f ' && npx -y zcash-faucet --version >/dev/null && curl -s -o /dev/null -m 180 https://zcash-faucet.onrender.com/api/status && clear"
Enter
Wait@240s /❯$/
Show

Sleep 500ms
Type "npx zcash-faucet --status"
Sleep 400ms
Enter
Wait@60s /❯$/
Sleep 3s

Type "clear" Enter
Sleep 300ms

Type "npx zcash-faucet TESTNET_ADDRESS"
Sleep 400ms
Enter
# Building a shielded transaction takes ~10-60s on the free server.
Wait@180s /❯$/
Sleep 5s
