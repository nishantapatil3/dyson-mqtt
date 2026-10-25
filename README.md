# dyson-mqtt

A cloud MQTT bridge for Wi-Fi Dyson fans, purifiers, heaters, and humidifiers. It connects to Dyson's AWS IoT MQTT gateway and republishes state to your broker, including Home Assistant MQTT discovery. Device IP addresses are not needed.

## Setup

Requires Docker and an MQTT broker such as Mosquitto. Run:

```sh
docker compose up -d
```

Compose pulls the published multi-architecture image from [`ghcr.io/nishantapatil3/dyson-mqtt`](https://github.com/nishantapatil3/dyson-mqtt/pkgs/container/dyson-mqtt). To pull it manually, run `docker pull ghcr.io/nishantapatil3/dyson-mqtt:latest`.

Open **http://localhost:3100**. Enter your MyDyson email, the code Dyson sends, and your account password. Select your devices and enter your MQTT broker URL, then save. The setup page stores the MyDyson access token in the Docker volume and retrieves fresh cloud MQTT credentials on each connection; it does not save your account password. The setup page is published only on the host's loopback interface. The container needs Internet access to Dyson and network access to your MQTT broker. If your broker runs on the Docker host, use `host.docker.internal` in `mqttUrl`.

For manual setup, copy `config.example.json` to `config.json`, fill in the values, and run `DYSON_MQTT_CONFIG=./config.json npm start` with Node.js 20+. Keep the account token private. [opendyson](https://github.com/libdyson-wg/opendyson) can retrieve an account token if you prefer terminal setup.

Configuration keys:

| Key | Meaning |
| --- | --- |
| `mqttUrl` | Your MQTT broker URL, including credentials if required |
| `topicPrefix` | Published topic root; defaults to `dyson` |
| `discoveryPrefix` | Home Assistant discovery root; defaults to `homeassistant` |
| `pollIntervalSeconds` | Request state periodically; `0` disables polling |
| `mode` | `cloud` for the Dyson AWS IoT gateway |
| `dysonCloud` | MyDyson `token` and optional `china` flag |
| `devices` | Array of `name`, `serial`, and `productType` |

Set `DYSON_MQTT_CONFIG` to use another config file path.

## Topics

For serial `AB1-CD` and default prefix:

| Topic | Direction | Description |
| --- | --- | --- |
| `dyson/AB1-CD/availability` | bridge → broker | Retained `online` or `offline` |
| `dyson/AB1-CD/state` | bridge → broker | Retained normalized JSON plus `product_state` and `sensor_data` |
| `dyson/AB1-CD/faults` | bridge → broker | Retained Dyson fault JSON |
| `dyson/AB1-CD/raw/<message-type>` | bridge → broker | Unretained Dyson JSON messages |
| `dyson/AB1-CD/set/<command>` | broker → bridge | Command payloads described below |

Commands: `power`, `auto`, `oscillation`, `night_mode`, `direction`, `continuous_monitoring`, `heating`, and `humidification` accept `ON` or `OFF`. `speed` accepts `1`–`10`; `percentage` accepts `0`–`100` (`0` turns the fan off). `preset_mode` accepts `Auto` or `Manual`. `target_temperature` accepts Celsius `1`–`37`; `humidity_target` accepts `30`–`70`. `request` with payload `STATE` requests a fresh product state. Unsupported controls are ignored by the device; capabilities vary by model.

Home Assistant discovery publishes a fan and environmental sensors. The bridge publishes measured VOC and NO₂ values as **indices**, not concentrations. Raw Dyson values are preserved in `product_state` and `sensor_data` for model-specific automations.

## Scope and protocol notes

This release bridges Dyson air treatment devices through Dyson's cloud MQTT gateway. It does not bridge robot vacuums. If the MyDyson access token expires, log in again through the setup page. Device protocol behavior is based on [ha-dyson](https://github.com/libdyson-wg/ha-dyson), [ioBroker.dysonairpurifier](https://github.com/Grizzelbee/ioBroker.dysonairpurifier), and [matterbridge-dyson-robot](https://github.com/thoukydides/matterbridge-dyson-robot). The Dyson protocol is unofficial and model behavior may differ.
