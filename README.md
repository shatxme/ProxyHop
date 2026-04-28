# ProxyHop

Chrome extension that switches Chrome to a remote passwordless SOCKS5 proxy with a compact saved-profile popup.

## Scope

- Save multiple SOCKS5 proxy profiles
- One-click connect / disconnect from the popup
- Delete saved proxy profiles
- Show proxy control conflicts and proxy errors
- Work with passwordless SOCKS5 proxies configured as `IP:Port`

## Proxy server setup

`ProxyHop` supports passwordless SOCKS5 endpoints only.

Chrome proxy extensions do not handle SOCKS5 username/password setup well in a simple reusable way, so `ProxyHop` is built for passwordless SOCKS5 proxies only.

For convenience, this repo includes:

- `scripts/setup-dante.sh` to install a matching Dante SOCKS5 proxy on an Ubuntu/Debian VPS
- `scripts/setup-mtproto.sh` to install Telegram MTProto on the same VPS if you also want a Telegram-specific proxy


To install a Dante proxy:

```bash
wget -qO- https://raw.githubusercontent.com/shatxme/ProxyHop/main/scripts/setup-dante.sh | sudo bash -s -- 24861
```

The script installs `danted`, opens the port in `ufw` when enabled, and writes a passwordless config with:

```conf
socksmethod: none
clientmethod: none
```

After it finishes, copy the printed `IP:Port` value into the `ProxyHop` Chrome extension popup.

To install MTProto for Telegram on the same server:

```bash
wget -qO- https://raw.githubusercontent.com/shatxme/ProxyHop/main/scripts/setup-mtproto.sh | sudo bash -s -- 443 8888
```

This installs Telegram's official `MTProxy`, creates a `systemd` service, opens the MTProto port in `ufw` when enabled, and prints a `tg://proxy?...` link you can open in Telegram.

## Running Both On One VPS

`Dante` and `MTProto` can run on the same server at the same time as long as they use different ports.

Example:

- `SOCKS5` via Dante on `24861`
- `MTProto` for Telegram on `443`

Use the SOCKS5 `IP:Port` in the `ProxyHop` extension.

Use the printed `tg://proxy?...` link or the MTProto server, port, and secret inside Telegram.

`ProxyHop` itself does not use MTProto; MTProto is only for Telegram clients.


## Install the extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Download and extract the latest release zip
4. Click `Load unpacked`
5. Select the extracted folder from the zip, for example `proxyhop-chrome-1.0.0`
