# Brand assets for brands.home-assistant.io

Home Assistant shows integration icons from its central brands CDN
(`https://brands.home-assistant.io/_/<domain>/icon.png`) — there is no way to ship the
icon inside the integration itself. Until the brand is merged upstream, HA shows a
generic placeholder; HACS uses the same CDN.

The files in `meteorocks/` are ready for submission (site triangle mark, generated from
`s/pix/logo.png`):

| File | Size | Content |
|---|---|---|
| `icon.png` | 256×256 | triangle mark (square icon) |
| `icon@2x.png` | 512×512 | hDPI variant |
| `logo.png` | 256×256 | full logo with wordmark |
| `logo@2x.png` | 512×512 | hDPI variant |

## How to submit

1. Fork <https://github.com/home-assistant/brands>.
2. Copy the `meteorocks/` directory into `custom_integrations/` of the fork
   (result: `custom_integrations/meteorocks/icon.png` etc.).
3. Open a PR titled "Add meteorocks brand". The checks verify sizes/format
   automatically; custom-integration brand PRs are usually merged quickly.
4. After the merge the CDN caches aggressively — allow up to a day (plus a
   browser hard-refresh) before the icon appears in your HA.
