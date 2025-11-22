# Быстрый старт: Управление освещением в "Лоджия"

**Дата создания:** 2025-11-22  
**Версия:** 1.0

## 🚀 За 30 секунд

```bash
# 1. Установите переменные окружения
export REACTHOME_WS_URI="ws://192.168.88.4:3000"
export REACTHOME_LOCATION_ID="6b1afa99-9c1e-496e-8bd4-be7e90b71c8d"

# 2. Запустите тест
python3 -m pytest tests/integration/test_lodgia_lighting.py::test_lodgia_lighting_can_be_switched_on -v
```

## 📋 Ключевая информация

- **UUID локации:** `6b1afa99-9c1e-496e-8bd4-be7e90b71c8d`
- **WebSocket сервер:** `ws://192.168.88.4:3000`
- **Каналы освещения:** 2 (`light_220`)

## 💡 Команды

### Включить свет
```json
{"type": "ACTION_SITE_LIGHT_ON", "id": "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d"}
```

### Выключить свет
```json
{"type": "ACTION_SITE_LIGHT_OFF", "id": "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d"}
```

## 🔧 Диагностика

```bash
# Проверить ID локации
node scripts/check-lodgia-id.js

# Проверить каналы освещения
node scripts/check-light-channel.js

# Проверить привязку к устройству
node scripts/check-device-bind.js
```

## 📚 Полная документация

См. [LODGIA_LIGHT_CONTROL_GUIDE.md](./LODGIA_LIGHT_CONTROL_GUIDE.md) для подробной информации.

---

## См. также

- **[LODGIA_LIGHT_CONTROL_GUIDE.md](./LODGIA_LIGHT_CONTROL_GUIDE.md)** - полное руководство по управлению освещением в Лоджии
- **[WEBSOCKET_API_REFERENCE.md](./WEBSOCKET_API_REFERENCE.md)** - описание WebSocket API
- **[WEBSOCKET_PORT_3000_GUIDE.md](./WEBSOCKET_PORT_3000_GUIDE.md)** - руководство по WebSocket на порту 3000
- `tests/integration/test_lodgia_lighting.py` - интеграционные тесты управления освещением
- `scripts/check-lodgia-id.js` - утилита проверки ID локации

---

**Версия документа:** 1.0  
**Последнее обновление:** 2025-11-22

