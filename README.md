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

For convenience, this repo includes `scripts/setup-dante.sh` to install a matching Dante proxy on an Ubuntu/Debian VPS. The helper script is kept outside the extension package build, so users can grab it from the repo and use the latest extension release separately.

To install a matching Dante proxy:

```bash
sudo bash scripts/setup-dante.sh 24861
```

The script installs `danted`, opens the port in `ufw` when enabled, and writes a passwordless config with:

```conf
socksmethod: none
clientmethod: none
```

After it finishes, copy the printed `IP:Port` value into the `ProxyHop` Chrome extension popup.

To validate the proxy from the server setup side:

```bash
curl --proxy socks5h://SERVER_IP:24861 https://ifconfig.me
```

## Install the extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Download and extract the latest release zip
4. Click `Load unpacked`
5. Select the extracted folder from the zip, for example `proxyhop-chrome-1.0.0`
