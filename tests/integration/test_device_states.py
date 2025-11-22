import asyncio
import json
import logging
import os
import re
import sys
from typing import Any, Dict, List, Optional, Set
from datetime import datetime
from pathlib import Path

import pytest
import websockets

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=os.getenv("REACTHOME_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    stream=sys.stderr,
    force=True,
)

# Функция для немедленного вывода в stderr (pytest не перехватывает stderr)
def log_now(*args, **kwargs):
    msg = ' '.join(str(arg) for arg in args) + '\n'
    sys.stderr.write(msg)
    sys.stderr.flush()


ACTION_SET = "ACTION_SET"
GET = "get"
LIST = "list"


def is_significant_change(payload: Dict[str, Any]) -> bool:
    """Определяет, является ли изменение состояния значимым для вывода в консоль."""
    # Сначала проверяем, не является ли это сенсором
    if is_sensor_device(payload):
        return False
    
    # Список служебных полей, которые НЕ должны выводиться
    service_fields = {"initialized", "online", "timestamp", "type", "ready", "version", "master", "bind", "site", "code", "title", "modified", "last"}
    
    # Если payload содержит ТОЛЬКО служебные поля - это не значимое изменение
    if set(payload.keys()).issubset(service_fields):
        return False
    
    # Список управляющих полей, которые важны для вывода
    significant_fields = ["value", "fan_speed", "fan_speed_", "state", "active", "script", "time"]
    
    # Если есть значимые поля И есть хотя бы одно неслужебное поле - это важное изменение
    if any(key in payload for key in significant_fields):
        # Проверяем, что есть хотя бы одно поле, которое не является служебным
        non_service_keys = set(payload.keys()) - service_fields
        if non_service_keys:
            return True
    
    return False


def is_sensor_device(payload: Dict[str, Any]) -> bool:
    """Определяет, является ли устройство сенсором (температура, влажность, CO2 и т.д.)."""
    # Список полей, которые указывают на сенсор
    sensor_fields = ["temperature", "humidity", "co2", "co2_raw", 
                     "humidity_raw", "temperature_raw", "humidity_absolute"]
    
    # Список управляющих полей (если есть - это не сенсор)
    control_fields = ["value", "fan_speed", "fan_speed_", "state", "active", "script", "time"]
    
    # Список служебных полей (не влияют на определение сенсора)
    service_fields = {"initialized", "online", "timestamp", "type", "ready", "version", "master", "bind", "site", "code", "title", "modified", "last"}
    
    # Проверяем наличие управляющих полей ПЕРВЫМ - если есть, это точно не сенсор
    has_control_fields = any(key in payload for key in control_fields)
    if has_control_fields:
        return False
    
    # Проверяем наличие сенсорных полей
    has_sensor_fields = any(key in payload for key in sensor_fields)
    
    # Если есть сенсорные поля и нет управляющих - это сенсор
    # (даже если значение null или есть служебные поля - это всё равно сенсорное обновление)
    if has_sensor_fields:
        return True
    
    # Если обновление содержит только служебные поля - это не сенсор
    if set(payload.keys()).issubset(service_fields):
        return False
    
    # Если нет ни сенсорных, ни управляющих полей - это не сенсор
    return False


def matches_device_filter(device_id: str, device_name: Optional[str], device_filter: Optional[str]) -> bool:
    """
    Проверяет, соответствует ли устройство фильтру.
    
    Фильтр может быть:
    - Список имён или ID через запятую: "Бра,Приточный блок,40:64:06:c0:5d:b5"
    - Регулярное выражение: "Бра|Приточный"
    - Если фильтр не задан (None или пустая строка) - все устройства проходят
    
    Args:
        device_id: ID устройства
        device_name: Имя устройства (может быть None)
        device_filter: Строка фильтра или None
        
    Returns:
        True если устройство соответствует фильтру или фильтр не задан
    """
    if not device_filter or not device_filter.strip():
        return True  # Нет фильтра - пропускаем все устройства
    
    filter_str = device_filter.strip()
    
    # Проверяем, является ли фильтр регулярным выражением (содержит специальные символы)
    if any(char in filter_str for char in ['|', '*', '+', '?', '(', '[', '{']):
        try:
            # Пробуем как регулярное выражение
            pattern = re.compile(filter_str, re.IGNORECASE)
            if pattern.search(device_id) or (device_name and pattern.search(device_name)):
                return True
        except re.error:
            # Если не получилось как regex, обрабатываем как простой список
            pass
    
    # Обрабатываем как список значений через запятую
    filter_items = [item.strip() for item in filter_str.split(',')]
    
    for item in filter_items:
        if not item:
            continue
        
        # Проверяем по ID (точное совпадение или вхождение)
        if item.lower() in device_id.lower():
            return True
        
        # Проверяем по имени (точное совпадение или вхождение)
        if device_name and item.lower() in device_name.lower():
            return True
    
    return False


def format_device_update(device_id: str, payload: Dict[str, Any], timestamp: float, device_name: str = None) -> str:
    """Форматирует обновление состояния устройства для вывода."""
    lines = []
    # Показываем имя устройства, если оно есть
    if device_name:
        lines.append(f"📥 [{device_id}] {device_name}")
    else:
        lines.append(f"📥 [{device_id}]")
    
    # Основные поля состояния
    if "value" in payload:
        lines.append(f"   value: {payload['value']}")
    if "online" in payload:
        lines.append(f"   online: {payload['online']}")
    if "initialized" in payload:
        lines.append(f"   initialized: {payload['initialized']}")
    if "type" in payload:
        lines.append(f"   type: {payload['type']}")
    
    # Температура и влажность
    if "temperature" in payload:
        lines.append(f"   temperature: {payload['temperature']}")
    if "humidity" in payload:
        lines.append(f"   humidity: {payload['humidity']}")
    
    # CO2
    if "co2" in payload:
        lines.append(f"   co2: {payload['co2']}")
    
    # Другие поля
    other_fields = {k: v for k, v in payload.items() 
                    if k not in ["value", "online", "initialized", "type", 
                                "temperature", "humidity", "co2", "timestamp"]}
    if other_fields:
        for key, value in other_fields.items():
            if isinstance(value, (str, int, float, bool, type(None))):
                lines.append(f"   {key}: {value}")
            else:
                lines.append(f"   {key}: {json.dumps(value)[:50]}")
    
    return "\n".join(lines)


async def get_device_name(websocket: websockets.WebSocketClientProtocol, device_id: str, timeout: float = 1.0) -> str:
    """Получает имя устройства через GET запрос (для UUID объектов с полем title)."""
    # Если это MAC-адрес, а не UUID - имя не получить таким способом
    if ":" in device_id and len(device_id.split(":")) == 6:
        return None
    
    try:
        await websocket.send(json.dumps({"type": GET, "state": [device_id]}))
        deadline = asyncio.get_running_loop().time() + timeout
        
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                raw = await asyncio.wait_for(websocket.recv(), min(remaining, 0.3))
                message = json.loads(raw)
                if message.get("type") == ACTION_SET and message.get("id") == device_id:
                    payload = message.get("payload", {})
                    # Ищем поле title в payload
                    if "title" in payload:
                        return payload.get("title")
                    break
            except asyncio.TimeoutError:
                continue
            except json.JSONDecodeError:
                continue
    except Exception as e:
        logger.debug(f"Ошибка при получении имени устройства {device_id}: {e}")
    
    return None


async def get_all_device_ids(websocket: websockets.WebSocketClientProtocol, timeout: float = 3.0) -> List[str]:
    """Получает список всех ID устройств через LIST."""
    log_now("📋 Запрашиваем список всех устройств (LIST)...")
    await websocket.send(json.dumps({"type": LIST}))
    
    device_ids = []
    deadline = asyncio.get_running_loop().time() + timeout
    
    while asyncio.get_running_loop().time() < deadline:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        try:
            raw = await asyncio.wait_for(websocket.recv(), min(remaining, 0.5))
            message = json.loads(raw)
            if message.get("type") == LIST and message.get("state"):
                # state - это список списков: [["id1", timestamp1], ["id2", timestamp2], ...]
                for item in message.get("state", []):
                    if isinstance(item, list) and len(item) > 0:
                        device_ids.append(item[0])
                log_now(f"✅ Получено устройств: {len(device_ids)}")
                return device_ids
        except asyncio.TimeoutError:
            continue
        except json.JSONDecodeError:
            continue
        except Exception as e:
            logger.debug(f"Ошибка при получении LIST: {e}")
            continue
    
    log_now(f"⚠️  Получено устройств: {len(device_ids)} (таймаут)")
    return device_ids


async def get_device_states(websocket: websockets.WebSocketClientProtocol, device_ids: List[str], timeout: float = 5.0) -> Dict[str, Dict[str, Any]]:
    """Получает состояния устройств через GET."""
    if not device_ids:
        return {}
    
    log_now(f"📥 Запрашиваем состояния {len(device_ids)} устройств (GET)...")
    
    # Разбиваем на батчи по 100 устройств, чтобы не перегружать
    batch_size = 100
    all_states = {}
    
    for i in range(0, len(device_ids), batch_size):
        batch = device_ids[i:i + batch_size]
        log_now(f"   Батч {i // batch_size + 1}: {len(batch)} устройств")
        
        await websocket.send(json.dumps({"type": GET, "state": batch}))
        
        deadline = asyncio.get_running_loop().time() + timeout
        received_ids = set()
        
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            
            try:
                raw = await asyncio.wait_for(websocket.recv(), min(remaining, 0.3))
                message = json.loads(raw)
                if message.get("type") == ACTION_SET:
                    device_id = message.get("id")
                    if device_id in batch:
                        all_states[device_id] = message.get("payload", {})
                        received_ids.add(device_id)
                        if len(received_ids) == len(batch):
                            break
            except asyncio.TimeoutError:
                continue
            except json.JSONDecodeError:
                continue
            except Exception as e:
                logger.debug(f"Ошибка при получении GET: {e}")
                continue
        
        log_now(f"   ✅ Получено состояний: {len(received_ids)}/{len(batch)}")
    
    log_now(f"✅ Всего получено состояний: {len(all_states)}")
    return all_states


async def monitor_device_changes(
    websocket: websockets.WebSocketClientProtocol,
    initial_states: Dict[str, Dict[str, Any]],
    duration: float = 30.0,
    log_file: str = None,
    device_names: Dict[str, str] = None,
    device_filter: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Мониторит изменения состояния устройств и выводит их в консоль."""
    log_now(f"\n🔍 Мониторинг изменений состояния устройств (длительность: {duration} сек)")
    if device_filter:
        log_now(f"📌 Фильтр устройств: {device_filter}")
    log_now("=" * 80)
    
    changes = []
    start_time = asyncio.get_running_loop().time()
    deadline = start_time + duration
    last_states = initial_states.copy()
    device_names_cache = device_names or {}
    
    # Открываем файл для записи всех сообщений
    log_file_handle = None
    if log_file:
        log_file_handle = open(log_file, 'w', encoding='utf-8')
        log_file_handle.write(f"# Лог всех сообщений WebSocket\n")
        log_file_handle.write(f"# Начало: {datetime.now().isoformat()}\n")
        log_file_handle.write(f"# Длительность: {duration} сек\n\n")
    
    try:
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            
            try:
                raw = await asyncio.wait_for(websocket.recv(), min(remaining, 0.2))
                message = json.loads(raw)
                timestamp = asyncio.get_running_loop().time()
                elapsed = timestamp - start_time
                
                if message.get("type") == ACTION_SET:
                    device_id = message.get("id")
                    payload = message.get("payload", {})
                    
                    # Обновляем кэш имён устройств, если в payload есть title
                    if "title" in payload:
                        device_name = payload.get("title")
                        if device_name:
                            device_names_cache[device_id] = device_name
                    
                    # Получаем имя устройства из кэша для записи в лог
                    device_name = device_names_cache.get(device_id)
                    
                    # Записываем все сообщения в файл лога с именем устройства
                    if log_file_handle:
                        if device_name:
                            log_file_handle.write(f"[+{elapsed:.3f}с] [{device_id}] {device_name} | {json.dumps(message, ensure_ascii=False)}\n")
                        else:
                            log_file_handle.write(f"[+{elapsed:.3f}с] [{device_id}] | {json.dumps(message, ensure_ascii=False)}\n")
                        log_file_handle.flush()
                    
                    # Пропускаем сенсоры
                    if is_sensor_device(payload):
                        continue
                    
                    # Сравниваем состояния без timestamp (он всегда разный)
                    payload_without_timestamp = {k: v for k, v in payload.items() if k != "timestamp"}
                    previous_state = last_states.get(device_id, {})
                    previous_without_timestamp = {k: v for k, v in previous_state.items() if k != "timestamp"}
                    
                    # Проверяем, изменилось ли состояние
                    if payload_without_timestamp != previous_without_timestamp:
                        change_info = {
                            "device_id": device_id,
                            "timestamp": timestamp,
                            "elapsed": elapsed,
                            "previous": previous_state,
                            "current": payload,
                        }
                        changes.append(change_info)
                        last_states[device_id] = payload.copy()
                        
                        # Выводим в консоль только значимые изменения
                        if is_significant_change(payload):
                            # Получаем имя устройства из кэша (уже обновлён выше)
                            device_name = device_names_cache.get(device_id)
                            
                            # Проверяем фильтр устройств
                            if not matches_device_filter(device_id, device_name, device_filter):
                                continue  # Пропускаем устройства, не соответствующие фильтру
                            
                            # Форматируем вывод более компактно
                            device_label = device_name if device_name else device_id
                            
                            # Формируем краткое описание изменений
                            changes_desc = []
                            if "value" in payload:
                                changes_desc.append(f"value: {payload['value']}")
                            if "fan_speed" in payload:
                                changes_desc.append(f"fan_speed: {payload['fan_speed']}")
                            if "state" in payload:
                                changes_desc.append(f"state: {payload['state']}")
                            if "active" in payload:
                                changes_desc.append(f"active: {payload['active']}")
                            
                            changes_str = ", ".join(changes_desc) if changes_desc else "изменение состояния"
                            
                            log_now(f"⏱️  +{elapsed:.2f}с | {device_label} | {changes_str}")
                else:
                    # Записываем сообщения других типов в лог (без имени устройства)
                    if log_file_handle:
                        log_file_handle.write(f"[+{elapsed:.3f}с] | {json.dumps(message, ensure_ascii=False)}\n")
                        log_file_handle.flush()
            
            except asyncio.TimeoutError:
                continue
            except json.JSONDecodeError:
                # Записываем невалидный JSON в лог
                if log_file_handle:
                    log_file_handle.write(f"[+{elapsed:.3f}с] INVALID_JSON: {raw[:200]}\n")
                    log_file_handle.flush()
                continue
            except Exception as e:
                logger.debug(f"Ошибка при мониторинге: {e}")
                if log_file_handle:
                    log_file_handle.write(f"[+{elapsed:.3f}с] ERROR: {str(e)}\n")
                    log_file_handle.flush()
                continue
    finally:
        if log_file_handle:
            log_file_handle.write(f"\n# Конец: {datetime.now().isoformat()}\n")
            log_file_handle.write(f"# Всего сообщений записано в лог\n")
            log_file_handle.close()
    
    log_now(f"\n✅ Мониторинг завершён")
    log_now(f"📊 Всего изменений: {len(changes)}")
    if log_file:
        log_now(f"📄 Полный лог сохранён: {log_file}")
    
    return changes


@pytest.mark.integration
@pytest.mark.asyncio
async def test_device_states_monitoring() -> None:
    """Тест состояний устройств: получает начальные состояния через GET и мониторит изменения."""
    server_uri = os.getenv("REACTHOME_WS_URI", "ws://192.168.88.4:3000")
    monitoring_duration = float(os.getenv("REACTHOME_MONITORING_DURATION", "30.0"))
    get_timeout = float(os.getenv("REACTHOME_GET_TIMEOUT", "5.0"))
    device_filter = os.getenv("REACTHOME_DEVICE_FILTER", "").strip() or None
    
    log_now("=" * 80)
    log_now("ТЕСТ СОСТОЯНИЙ УСТРОЙСТВ")
    log_now("=" * 80)
    log_now(f"Подключение к серверу: {server_uri}")
    log_now(f"Длительность мониторинга: {monitoring_duration} сек")
    if device_filter:
        log_now(f"🔍 Фильтр устройств: {device_filter}")
        log_now("   (в консоль выводятся только устройства, соответствующие фильтру)")
    else:
        log_now("🔍 Фильтр устройств: не задан (выводятся все устройства)")
    log_now("")
    
    async with websockets.connect(server_uri) as websocket:
        log_now("✅ Подключение установлено\n")
        
        # Шаг 1: Получаем список всех устройств
        log_now("┌─ ШАГ 1: Получение списка устройств")
        device_ids = await get_all_device_ids(websocket, timeout=3.0)
        if not device_ids:
            pytest.fail("Не удалось получить список устройств")
        log_now(f"└─ Найдено устройств: {len(device_ids)}\n")
        
        # Шаг 2: Получаем начальные состояния всех устройств
        log_now("┌─ ШАГ 2: Получение начальных состояний устройств")
        initial_states = await get_device_states(websocket, device_ids, timeout=get_timeout)
        
        # Собираем имена устройств из начальных состояний (для объектов с title)
        device_names = {}
        for device_id, state in initial_states.items():
            if "title" in state:
                device_names[device_id] = state.get("title")
        
        log_now(f"└─ Получено состояний: {len(initial_states)} (имен: {len(device_names)})\n")
        
        if initial_states:
            log_now("📊 Примеры начальных состояний:")
            for i, (device_id, state) in enumerate(list(initial_states.items())[:5]):
                log_now(f"  {device_id}: {json.dumps(state, ensure_ascii=False)[:100]}")
            log_now("")
        
        # Шаг 3: Мониторим изменения состояния устройств
        log_now("┌─ ШАГ 3: Мониторинг изменений состояния")
        log_now("   ⚠️  Сенсоры (температура, влажность, CO2) фильтруются")
        log_now("   📝 Все сообщения записываются в файл лога")
        if device_filter:
            log_now(f"   🔍 Фильтр устройств активен: {device_filter}")
        
        # Создаём файл лога
        report_dir = Path(__file__).parent.parent.parent / 'reports'
        report_dir.mkdir(exist_ok=True)
        log_file = str(report_dir / f"device-states-log-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log")
        
        changes = await monitor_device_changes(
            websocket, 
            initial_states, 
            duration=monitoring_duration, 
            log_file=log_file, 
            device_names=device_names,
            device_filter=device_filter
        )
        log_now(f"└─ Зафиксировано изменений: {len(changes)}\n")
        
        # Итоговая статистика
        log_now("=" * 80)
        log_now("ИТОГОВАЯ СТАТИСТИКА")
        log_now("=" * 80)
        log_now(f"Всего устройств: {len(device_ids)}")
        log_now(f"Получено начальных состояний: {len(initial_states)}")
        log_now(f"Зафиксировано изменений: {len(changes)}")
        
        if changes:
            # Группируем по устройствам
            devices_with_changes = {}
            for change in changes:
                device_id = change["device_id"]
                if device_id not in devices_with_changes:
                    devices_with_changes[device_id] = 0
                devices_with_changes[device_id] += 1
            
            log_now(f"Устройств с изменениями: {len(devices_with_changes)}")
            log_now("\nТоп-10 устройств по количеству изменений:")
            sorted_devices = sorted(devices_with_changes.items(), key=lambda x: x[1], reverse=True)
            for device_id, count in sorted_devices[:10]:
                log_now(f"  {device_id}: {count} изменений")
        
        log_now("=" * 80)
        log_now("✅ Тест завершён")
        log_now("=" * 80)
        
        # Проверка, что мы получили хотя бы список устройств
        assert len(device_ids) > 0, "Не получен список устройств"
        assert len(initial_states) > 0, "Не получены начальные состояния устройств"

